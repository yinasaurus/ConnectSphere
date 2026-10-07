/**
 * SCRUM-19: Booking Conflict Detection
 *
 * Acceptance criteria covered:
 *   AC1  The system checks a booking request against existing bookings for the requested venue.
 *   AC2  A booking's occupied window runs from event start minus venue setup time to event end plus turnaround time.
 *        Example: event 10:00 to 12:00 with 30m setup and 45m turnaround occupies 09:30 to 12:45.
 *   AC3  The system identifies a conflict when a booking's occupied window overlaps the occupied window of an existing confirmed booking at the same venue.
 *   AC4  Two bookings are not in conflict if one occupied window ends exactly when the other starts.
 *   AC5  A confirmed booking makes the venue unavailable for its full occupied window.
 *   AC6  A venue with a conflicting confirmed booking cannot be incorrectly approved for another event during the same period.
 *   AC7  Venue Staff are informed when a booking conflict is detected.
 *   AC8  When an event has several venue bookings, each booking is checked separately against its own venue.
 *   AC9  An active tentative hold counts as occupying the venue. An expired hold does not.
 */

const request = require('supertest');
const { ROLES } = require('../src/constants/roles');
const { BOOKING_STATUS } = require('../src/constants/statuses');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  throwIf: jest.fn(),
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  fetchCount: jest.fn(),
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  updateById: jest.fn(),
}));

let mockUser;
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    requireAuth: (req, res, next) => {
      if (!mockUser) return res.status(401).json({ error: 'UNAUTHENTICATED' });
      req.user = mockUser;
      return next();
    },
  };
});

const { supabase, fetchOne, fetchMany, insertOne, updateById } = require('../src/config/db');
const venuesService = require('../src/services/venues.service');
const { createApp } = require('../src/app');

const STAFF = { id: 40, roles: [ROLES.VENUE_STAFF] };

describe('SCRUM-19 Venue Booking Conflict Detection', () => {
  const app = createApp();
  let query;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchOne.mockReset();
    fetchMany.mockReset();
    query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    };
    supabase.from.mockReturnValue(query);
    updateById.mockImplementation(async (_table, id, patch) => ({ id, ...patch }));
    insertOne.mockImplementation(async (_table, row) => ({ id: 999, ...row }));
  });

  describe('AC2: Occupied window computation', () => {
    it('computes occupied window from event start minus setup to event end plus turnaround', () => {
      // User requirement example:
      // event 10:00 to 12:00 with 30m setup and 45m turnaround occupies 09:30 to 12:45
      const { occupiedStart, occupiedEnd } = venuesService.computeOccupiedWindow(
        '2026-10-20T10:00:00.000Z',
        '2026-10-20T12:00:00.000Z',
        30,
        45
      );
      expect(occupiedStart.toISOString()).toBe('2026-10-20T09:30:00.000Z');
      expect(occupiedEnd.toISOString()).toBe('2026-10-20T12:45:00.000Z');
    });
  });

  describe('AC3, AC4 & AC5: Overlapping occupied windows & boundary abutment', () => {
    it('AC3 & AC5: identifies a conflict when new occupied window overlaps an existing confirmed booking occupied window', async () => {
      // Existing confirmed booking: 10:00 to 12:00 with 30m setup, 45m turnaround -> 09:30 to 12:45
      const confirmedBooking = {
        id: 1,
        venue_id: 10,
        status: BOOKING_STATUS.APPROVED,
        start_at: '2026-10-20T10:00:00.000Z',
        end_at: '2026-10-20T12:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 45,
      };

      fetchMany.mockResolvedValueOnce([confirmedBooking]);

      // New request: 13:00 to 15:00 with 30m setup -> occupied window starts at 12:30 (before 12:45)
      const conflict = await venuesService.findConflict(
        10,
        '2026-10-20T13:00:00.000Z',
        '2026-10-20T15:00:00.000Z',
        30,
        30
      );

      expect(conflict).toBeTruthy();
      expect(conflict.id).toBe(1);
    });

    it('AC4: two bookings are not in conflict if one occupied window ends exactly when the other starts', async () => {
      // Existing confirmed booking: 10:00 to 12:00 with 30m setup, 45m turnaround -> occupied 09:30 to 12:45
      const confirmedBooking = {
        id: 1,
        venue_id: 10,
        status: BOOKING_STATUS.APPROVED,
        start_at: '2026-10-20T10:00:00.000Z',
        end_at: '2026-10-20T12:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 45,
      };

      fetchMany.mockResolvedValueOnce([confirmedBooking]);

      // New request: event 13:00 to 15:00 with 15m setup -> occupied window starts at 12:45:00.000Z exactly
      const conflict = await venuesService.findConflict(
        10,
        '2026-10-20T13:00:00.000Z',
        '2026-10-20T15:00:00.000Z',
        15,
        30
      );

      expect(conflict).toBeNull();
    });
  });

  describe('AC1 & AC6: Refusing booking approval when conflict exists with confirmed booking', () => {
    it('AC6: prevents Venue Staff from approving a booking that conflicts with a confirmed booking (409 Conflict)', async () => {
      mockUser = STAFF;

      // The pending booking being reviewed
      const pendingBooking = {
        id: 5,
        event_id: 50,
        venue_id: 10,
        status: BOOKING_STATUS.PENDING,
        start_at: '2026-10-20T13:00:00.000Z',
        end_at: '2026-10-20T15:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 30,
      };

      // Confirmed booking for the same venue overlapping (ends at 12:45, pending starts setup at 12:30)
      const confirmedBooking = {
        id: 1,
        event_id: 40,
        venue_id: 10,
        status: BOOKING_STATUS.APPROVED,
        start_at: '2026-10-20T10:00:00.000Z',
        end_at: '2026-10-20T12:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 45,
      };

      // 1. fetchOne loads the pending booking
      fetchOne.mockResolvedValueOnce(pendingBooking);
      // 2. findConflict fetchMany returns existing confirmed booking
      fetchMany.mockResolvedValueOnce([confirmedBooking]);

      const res = await request(app)
        .post('/api/venues/bookings/5/decision')
        .send({ approve: true });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('BOOKING_CONFLICT');
      expect(res.body.message).toMatch(/Cannot approve booking: venue has an overlapping confirmed booking/i);
      expect(updateById).not.toHaveBeenCalled();
    });

    it('allows approval of a pending booking when no conflict exists', async () => {
      mockUser = STAFF;

      const pendingBooking = {
        id: 5,
        event_id: 50,
        venue_id: 10,
        status: BOOKING_STATUS.PENDING,
        start_at: '2026-10-20T14:00:00.000Z',
        end_at: '2026-10-20T16:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 30,
      };

      fetchOne
        .mockResolvedValueOnce(pendingBooking)
        .mockResolvedValueOnce({ id: 50, name: 'AI Summit', coordinator_id: 21 })
        .mockResolvedValueOnce({ id: 10, name: 'Auditorium' });

      // No overlapping bookings found
      fetchMany.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/venues/bookings/5/decision')
        .send({ approve: true });

      expect(res.status).toBe(200);
      expect(res.body.booking.status).toBe(BOOKING_STATUS.APPROVED);
      expect(updateById).toHaveBeenCalledWith(
        'venue_bookings',
        '5',
        expect.objectContaining({ status: BOOKING_STATUS.APPROVED })
      );
    });
  });

  describe('AC7: Informing Venue Staff about detected conflicts in booking list', () => {
    it('AC7: listBookings flags pending bookings that conflict with confirmed bookings', async () => {
      mockUser = STAFF;

      const confirmedBooking = {
        id: 1,
        event_id: 40,
        venue_id: 10,
        status: BOOKING_STATUS.APPROVED,
        start_at: '2026-10-20T10:00:00.000Z',
        end_at: '2026-10-20T12:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 45,
        events: { name: 'Confirmed Gala' },
        venues: { name: 'Grand Ballroom' },
      };

      const conflictingPending = {
        id: 2,
        event_id: 50,
        venue_id: 10,
        status: BOOKING_STATUS.PENDING,
        start_at: '2026-10-20T12:30:00.000Z',
        end_at: '2026-10-20T14:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 30,
        events: { name: 'Conflicting Workshop' },
        venues: { name: 'Grand Ballroom' },
      };

      const nonConflictingPending = {
        id: 3,
        event_id: 60,
        venue_id: 10,
        status: BOOKING_STATUS.PENDING,
        start_at: '2026-10-20T16:00:00.000Z',
        end_at: '2026-10-20T18:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 30,
        events: { name: 'Evening Reception' },
        venues: { name: 'Grand Ballroom' },
      };

      fetchMany.mockResolvedValueOnce([confirmedBooking, conflictingPending, nonConflictingPending]);

      const res = await request(app).get('/api/venues/bookings');
      expect(res.status).toBe(200);

      const items = res.body.bookings;
      const conflictItem = items.find((b) => b.id === 2);
      const cleanItem = items.find((b) => b.id === 3);

      expect(conflictItem.has_conflict).toBe(true);
      expect(conflictItem.conflict_details.eventName).toBe('Confirmed Gala');

      expect(cleanItem.has_conflict).toBe(false);
      expect(cleanItem.conflict_details).toBeNull();
    });
  });

  describe('AC8: Multi-booking events checked separately per venue', () => {
    it('checks each booking separately against its own venue and allows non-conflicting venue booking to be approved', async () => {
      mockUser = STAFF;

      // Event 50 has two bookings: Booking 101 at Venue 1 and Booking 102 at Venue 2
      // Venue 1 has a confirmed booking that conflicts
      // Venue 2 is free

      const bookingVenue2 = {
        id: 102,
        event_id: 50,
        venue_id: 2, // Venue 2
        status: BOOKING_STATUS.PENDING,
        start_at: '2026-10-20T10:00:00.000Z',
        end_at: '2026-10-20T12:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 30,
      };

      fetchOne
        .mockResolvedValueOnce(bookingVenue2)
        .mockResolvedValueOnce({ id: 50, name: 'Campus Fest', coordinator_id: 21 })
        .mockResolvedValueOnce({ id: 2, name: 'Seminar Room B' });

      // Venue 2 query returns no overlapping bookings
      fetchMany.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/venues/bookings/102/decision')
        .send({ approve: true });

      expect(res.status).toBe(200);
      expect(res.body.booking.status).toBe(BOOKING_STATUS.APPROVED);
      // Venue 2 was queried with venue_id = 2
      expect(query.eq).toHaveBeenCalledWith('venue_id', 2);
    });
  });

  describe('AC9: Active vs Expired tentative holds', () => {
    const now = new Date('2026-10-20T08:00:00.000Z');

    it('identifies an ACTIVE tentative hold as occupying the venue (conflict detected)', async () => {
      // Tentative hold expires in the future (09:00:00)
      const activeHold = {
        id: 7,
        venue_id: 10,
        status: BOOKING_STATUS.TENTATIVE,
        start_at: '2026-10-20T10:00:00.000Z',
        end_at: '2026-10-20T12:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 30,
        expires_at: '2026-10-20T09:00:00.000Z',
      };

      fetchMany.mockResolvedValueOnce([activeHold]);

      const conflict = await venuesService.findConflict(
        10,
        '2026-10-20T10:30:00.000Z',
        '2026-10-20T11:30:00.000Z',
        30,
        30,
        { now }
      );

      expect(conflict).toBeTruthy();
      expect(conflict.id).toBe(7);
    });

    it('ignores an EXPIRED tentative hold (no conflict detected)', async () => {
      // Tentative hold expired in the past (07:00:00 vs now 08:00:00)
      const expiredHold = {
        id: 8,
        venue_id: 10,
        status: BOOKING_STATUS.TENTATIVE,
        start_at: '2026-10-20T10:00:00.000Z',
        end_at: '2026-10-20T12:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 30,
        expires_at: '2026-10-20T07:00:00.000Z',
      };

      fetchMany.mockResolvedValueOnce([expiredHold]);

      const conflict = await venuesService.findConflict(
        10,
        '2026-10-20T10:30:00.000Z',
        '2026-10-20T11:30:00.000Z',
        30,
        30,
        { now }
      );

      expect(conflict).toBeNull();
    });
  });
});

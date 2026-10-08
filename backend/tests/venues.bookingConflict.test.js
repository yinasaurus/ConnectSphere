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
  writeAudit: jest.fn(),
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

const { supabase, fetchOne, fetchMany, insertOne, updateById, writeAudit } = require('../src/config/db');
const venuesService = require('../src/services/venues.service');
const { createApp } = require('../src/app');

const STAFF = { id: 40, roles: [ROLES.VENUE_STAFF] };
const COORDINATOR = { id: 21, roles: [ROLES.EVENT_COORDINATOR] };

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
    writeAudit.mockResolvedValue();
  });

  describe('AC1: Booking request conflict checking', () => {
    /*
     * AC:       AC1 & AC3
     * Scenario: Coordinator requests a booking that overlaps an existing confirmed booking
     * Setup:    POST /api/venues/bookings with occupied window overlapping confirmed booking at same venue
     * Expected: HTTP 409 BOOKING_CONFLICT returned, booking is not created
     * Type:     negative
     */
    it('returns 409 BOOKING_CONFLICT when a booking request overlaps an existing confirmed booking', async () => {
      mockUser = COORDINATOR;

      const confirmedBooking = {
        id: 1,
        event_id: 10,
        venue_id: 5,
        status: BOOKING_STATUS.APPROVED,
        start_at: '2026-10-20T10:00:00.000Z',
        end_at: '2026-10-20T12:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 45,
      };

      fetchMany.mockResolvedValueOnce([confirmedBooking]);

      const res = await request(app)
        .post('/api/venues/bookings')
        .send({
          eventId: 50,
          venueId: 5,
          startAt: '2026-10-20T11:30:00.000Z',
          endAt: '2026-10-20T13:30:00.000Z',
          setupMinutes: 30,
          teardownMinutes: 30,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('BOOKING_CONFLICT');
      expect(res.body.message).toMatch(/already has a confirmed booking/i);
      expect(insertOne).not.toHaveBeenCalled();
    });

    /*
     * AC:       AC1
     * Scenario: Coordinator requests a booking for a free slot
     * Setup:    POST /api/venues/bookings when no confirmed bookings overlap
     * Expected: HTTP 201 Created, booking saved as PENDING
     * Type:     normal
     */
    it('creates a pending booking when no confirmed bookings conflict', async () => {
      mockUser = COORDINATOR;
      fetchMany.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/venues/bookings')
        .send({
          eventId: 50,
          venueId: 5,
          startAt: '2026-10-20T14:00:00.000Z',
          endAt: '2026-10-20T16:00:00.000Z',
          setupMinutes: 30,
          teardownMinutes: 30,
        });

      expect(res.status).toBe(201);
      expect(res.body.booking.status).toBe(BOOKING_STATUS.PENDING);
      expect(insertOne).toHaveBeenCalledWith(
        'venue_bookings',
        expect.objectContaining({
          event_id: 50,
          venue_id: 5,
          status: BOOKING_STATUS.PENDING,
        })
      );
    });
  });

  describe('AC2: Occupied window computation', () => {
    /*
     * AC:       AC2
     * Scenario: Compute occupied window given start, end, setup, and turnaround minutes
     * Setup:    Event 10:00 to 12:00 with 30m setup and 45m turnaround
     * Expected: Occupied window is 09:30 to 12:45
     * Type:     normal
     */
    it('computes occupied window from event start minus setup to event end plus turnaround', () => {
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
    /*
     * AC:       AC3 & AC5
     * Scenario: New booking occupied window overlaps existing confirmed booking occupied window
     * Setup:    Confirmed booking occupied 09:30-12:45; new request 13:00-15:00 with 30m setup (occupied 12:30-15:30)
     * Expected: findConflict returns the conflicting confirmed booking
     * Type:     normal
     */
    it('AC3 & AC5: identifies a conflict when new occupied window overlaps an existing confirmed booking occupied window', async () => {
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

    /*
     * AC:       AC4
     * Scenario: One occupied window ends exactly when the other begins (abutting boundaries)
     * Setup:    Confirmed booking occupied 09:30-12:45; new request 13:00-15:00 with 15m setup (occupied 12:45-15:30)
     * Expected: findConflict returns null (no conflict for abutting windows)
     * Type:     boundary
     */
    it('AC4: two bookings are not in conflict if one occupied window ends exactly when the other starts', async () => {
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

  describe('AC6: Refusing booking approval when conflict exists with confirmed booking', () => {
    /*
     * AC:       AC6
     * Scenario: Venue Staff attempts to approve a pending booking that conflicts with a confirmed booking
     * Setup:    POST /api/venues/bookings/:id/decision with approve: true on conflicting pending booking
     * Expected: HTTP 409 BOOKING_CONFLICT returned, status not updated to APPROVED
     * Type:     negative
     */
    it('AC6: prevents Venue Staff from approving a booking that conflicts with a confirmed booking (409 Conflict)', async () => {
      mockUser = STAFF;

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

      fetchOne.mockResolvedValueOnce(pendingBooking);
      fetchMany.mockResolvedValueOnce([confirmedBooking]);

      const res = await request(app)
        .post('/api/venues/bookings/5/decision')
        .send({ approve: true });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('BOOKING_CONFLICT');
      expect(res.body.message).toMatch(/Cannot approve booking: venue has an overlapping confirmed booking/i);
      expect(updateById).not.toHaveBeenCalled();
    });

    /*
     * AC:       AC6
     * Scenario: Venue Staff approves a pending booking that does not conflict with any confirmed booking
     * Setup:    POST /api/venues/bookings/:id/decision with approve: true on non-conflicting booking
     * Expected: HTTP 200 OK, status updated to APPROVED
     * Type:     normal
     */
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
    /*
     * AC:       AC7
     * Scenario: Venue Staff fetches booking list containing both conflicting and non-conflicting pending requests
     * Setup:    GET /api/venues/bookings returns list with confirmed booking and two pending requests
     * Expected: Items annotated with has_conflict and conflict_details
     * Type:     normal
     */
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
    /*
     * AC:       AC8
     * Scenario: Event has bookings on Venue 1 and Venue 2; Venue 1 has a conflict, Venue 2 is free
     * Setup:    Seed conflict on Venue 1 and empty bookings on Venue 2
     * Expected: Approving booking 102 (Venue 2) succeeds with 200, approving booking 101 (Venue 1) returns 409
     * Type:     normal
     */
    it('AC8: checks each booking separately against its own venue — proves 102 approves and 101 fails with 409', async () => {
      mockUser = STAFF;

      // Event 50 has two bookings: 101 at Venue 1 and 102 at Venue 2
      const bookingVenue1 = {
        id: 101,
        event_id: 50,
        venue_id: 1,
        status: BOOKING_STATUS.PENDING,
        start_at: '2026-10-20T10:00:00.000Z',
        end_at: '2026-10-20T12:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 30,
      };

      const bookingVenue2 = {
        id: 102,
        event_id: 50,
        venue_id: 2,
        status: BOOKING_STATUS.PENDING,
        start_at: '2026-10-20T10:00:00.000Z',
        end_at: '2026-10-20T12:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 30,
      };

      const venue1ConfirmedConflict = {
        id: 99,
        event_id: 40,
        venue_id: 1,
        status: BOOKING_STATUS.APPROVED,
        start_at: '2026-10-20T10:00:00.000Z',
        end_at: '2026-10-20T12:00:00.000Z',
        setup_minutes: 30,
        teardown_minutes: 30,
      };

      // Part A: Approving booking 102 on Venue 2 (which has no overlapping bookings) succeeds
      fetchOne
        .mockResolvedValueOnce(bookingVenue2)
        .mockResolvedValueOnce({ id: 50, name: 'Campus Fest', coordinator_id: 21 })
        .mockResolvedValueOnce({ id: 2, name: 'Seminar Room B' });
      fetchMany.mockResolvedValueOnce([]); // Venue 2 free

      const res2 = await request(app)
        .post('/api/venues/bookings/102/decision')
        .send({ approve: true });

      expect(res2.status).toBe(200);
      expect(res2.body.booking.status).toBe(BOOKING_STATUS.APPROVED);
      expect(query.eq).toHaveBeenCalledWith('venue_id', 2);

      // Part B: Approving booking 101 on Venue 1 (which conflicts with booking 99) fails with 409
      fetchOne.mockResolvedValueOnce(bookingVenue1);
      fetchMany.mockResolvedValueOnce([venue1ConfirmedConflict]);

      const res1 = await request(app)
        .post('/api/venues/bookings/101/decision')
        .send({ approve: true });

      expect(res1.status).toBe(409);
      expect(res1.body.error).toBe('BOOKING_CONFLICT');
      expect(query.eq).toHaveBeenCalledWith('venue_id', 1);
    });
  });

  describe('AC9: Active vs Expired tentative holds', () => {
    const now = new Date('2026-10-20T08:00:00.000Z');

    /*
     * AC:       AC9
     * Scenario: Active tentative hold occupies venue
     * Setup:    Hold expires at 09:00:00 (future relative to 08:00:00)
     * Expected: findConflict returns the active tentative hold
     * Type:     normal
     */
    it('identifies an ACTIVE tentative hold as occupying the venue (conflict detected)', async () => {
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

    /*
     * AC:       AC9
     * Scenario: Expired tentative hold does not occupy venue
     * Setup:    Hold expired at 07:00:00 (past relative to 08:00:00)
     * Expected: findConflict returns null
     * Type:     boundary
     */
    it('ignores an EXPIRED tentative hold (no conflict detected)', async () => {
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

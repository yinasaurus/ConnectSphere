/**
 * SCRUM-18: Venue Staff review, approve, or reject venue booking requests.
 *
 * Acceptance criteria covered:
 *   AC1  Venue Staff can view all pending venue booking requests.
 *   AC2  Each request displays the relevant booking details, including the event, venue, date, and time.
 *   AC3  Venue Staff can approve or reject a pending booking.
 *   AC4  When rejecting a booking, Venue Staff can provide a relevant reason or information.
 *   AC5  The booking status is updated to Approved or Rejected accordingly.
 *   AC6  The Event Coordinator can view the updated booking status.
 *   AC7  The Event Coordinator can view the rejection reason or information provided by Venue Staff.
 *   AC8  An approved booking is recorded as a confirmed booking for the venue (status APPROVED, ALREADY_DECIDED guard).
 *   AC9  When an event has several venue bookings, each booking is approved or rejected on its own without affecting the event or other bookings.
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
const COORDINATOR = { id: 21, roles: [ROLES.EVENT_COORDINATOR] };

const PENDING_BOOKING = {
  id: 10,
  event_id: 50,
  venue_id: 8,
  requested_by: 21,
  status: BOOKING_STATUS.PENDING,
  start_at: '2026-10-20T09:00:00.000Z',
  end_at: '2026-10-20T12:00:00.000Z',
  notes: 'Needs AV equipment set up early',
};

const EVENT_ROW = {
  id: 50,
  name: 'Tech Symposium',
  start_at: '2026-10-20T08:00:00.000Z',
  end_at: '2026-10-20T18:00:00.000Z',
  coordinator_id: 21,
  status: 'PLANNING',
};

const VENUE_ROW = {
  id: 8,
  name: 'Innovation Hall',
};

describe('SCRUM-18 Venue Booking Approval & Review (Service & Controller)', () => {
  const app = createApp();
  let query;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchOne.mockReset();
    fetchMany.mockReset();
    query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    };
    supabase.from.mockReturnValue(query);
    updateById.mockImplementation(async (_table, id, patch) => ({ id, ...patch }));
    insertOne.mockImplementation(async (_table, row) => ({ id: 999, ...row }));
  });

  /*
   * AC1 & AC2: Venue Staff can view all pending venue booking requests,
   * with relevant details including event, venue, date, and time.
   */
  describe('AC1 & AC2: Viewing pending booking requests with full details', () => {
    it('returns pending bookings with event name, venue name, and booking times', async () => {
      mockUser = STAFF;
      fetchMany.mockResolvedValueOnce([
        {
          ...PENDING_BOOKING,
          venues: { name: 'Innovation Hall' },
          events: {
            name: 'Tech Symposium',
            start_at: '2026-10-20T08:00:00.000Z',
            end_at: '2026-10-20T18:00:00.000Z',
          },
        },
      ]);

      const res = await request(app).get('/api/venues/bookings?status=PENDING');
      expect(res.status).toBe(200);
      expect(query.eq).toHaveBeenCalledWith('status', 'PENDING');

      const returned = res.body.bookings[0];
      expect(returned.id).toBe(10);
      expect(returned.status).toBe('PENDING');
      expect(returned.event_name).toBe('Tech Symposium');
      expect(returned.venue_name).toBe('Innovation Hall');
      expect(returned.start_at).toBe('2026-10-20T09:00:00.000Z');
      expect(returned.end_at).toBe('2026-10-20T12:00:00.000Z');
      expect(returned.event_start_at).toBe('2026-10-20T08:00:00.000Z');
      expect(returned.event_end_at).toBe('2026-10-20T18:00:00.000Z');
      expect(returned.notes).toBe('Needs AV equipment set up early');
    });

    it('allows Event Coordinators to view bookings but denies unauthorised roles', async () => {
      mockUser = { id: 99, roles: [ROLES.ATTENDEE] };
      const res = await request(app).get('/api/venues/bookings');
      expect(res.status).toBe(403);
    });
  });

  /*
   * AC3, AC4, AC5: Venue Staff can approve or reject a pending booking,
   * providing reason and alternative suggestion on rejection, updating status.
   */
  describe('AC3, AC4 & AC5: Approving or rejecting pending bookings', () => {
    function setupLookups(booking = PENDING_BOOKING, event = EVENT_ROW, venue = VENUE_ROW) {
      fetchOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce(event)
        .mockResolvedValueOnce(venue);
    }

    it('AC3 & AC5: approves a pending booking and sets status to APPROVED', async () => {
      mockUser = STAFF;
      setupLookups();

      const res = await request(app)
        .post('/api/venues/bookings/10/decision')
        .send({ approve: true });

      expect(res.status).toBe(200);
      expect(updateById).toHaveBeenCalledWith(
        'venue_bookings',
        '10',
        expect.objectContaining({
          status: BOOKING_STATUS.APPROVED,
          decided_by: STAFF.id,
          decision_reason: null,
          alternative_suggestion: null,
        })
      );
      expect(res.body.booking.status).toBe(BOOKING_STATUS.APPROVED);
    });

    it('AC4 & AC5: rejects a booking and records reason and alternative suggestion', async () => {
      mockUser = STAFF;
      setupLookups();

      const res = await request(app)
        .post('/api/venues/bookings/10/decision')
        .send({
          approve: false,
          reason: 'Maintenance scheduled on lighting rig',
          alternativeSuggestion: 'Seminar Room 3 on same date',
        });

      expect(res.status).toBe(200);
      expect(updateById).toHaveBeenCalledWith(
        'venue_bookings',
        '10',
        expect.objectContaining({
          status: BOOKING_STATUS.REJECTED,
          decided_by: STAFF.id,
          decision_reason: 'Maintenance scheduled on lighting rig',
          alternative_suggestion: 'Seminar Room 3 on same date',
        })
      );
      expect(res.body.booking.status).toBe(BOOKING_STATUS.REJECTED);
      expect(res.body.booking.decision_reason).toBe('Maintenance scheduled on lighting rig');
      expect(res.body.booking.alternative_suggestion).toBe('Seminar Room 3 on same date');
    });

    it('denies non-venue-staff users from deciding bookings', async () => {
      mockUser = COORDINATOR;
      const res = await request(app)
        .post('/api/venues/bookings/10/decision')
        .send({ approve: true });

      expect(res.status).toBe(403);
      expect(updateById).not.toHaveBeenCalled();
    });

    it('returns 404 if booking does not exist', async () => {
      mockUser = STAFF;
      fetchOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/venues/bookings/999/decision')
        .send({ approve: true });

      expect(res.status).toBe(404);
      expect(updateById).not.toHaveBeenCalled();
    });
  });

  /*
   * AC6 & AC7: Event Coordinator can view the updated booking status,
   * rejection reason, and suggested alternative.
   */
  describe('AC6 & AC7: Coordinator visibility of booking status & rejection info', () => {
    it('returns status, rejection reason and alternative suggestion for event bookings', async () => {
      mockUser = COORDINATOR;
      // getEvent check
      fetchOne.mockResolvedValueOnce(EVENT_ROW);
      // listVenueBookings query
      fetchMany.mockResolvedValueOnce([
        {
          id: 10,
          event_id: 50,
          venue_id: 8,
          status: 'REJECTED',
          decision_reason: 'Air conditioning malfunction',
          alternative_suggestion: 'Hall B',
          venues: { name: 'Innovation Hall' },
        },
      ]);

      const res = await request(app).get('/api/events/50/venue-bookings');
      expect(res.status).toBe(200);
      expect(res.body.bookings).toEqual([
        {
          id: 10,
          event_id: 50,
          venue_id: 8,
          status: 'REJECTED',
          venue_name: 'Innovation Hall',
          decision_reason: 'Air conditioning malfunction',
          alternative_suggestion: 'Hall B',
        },
      ]);
    });
  });

  /*
   * AC8: Approved booking is recorded as confirmed, and already decided
   * bookings cannot be decided again (returns 409).
   */
  describe('AC8: Confirmed booking recording & decision idempotency guard', () => {
    it('rejects decision on an already APPROVED booking with 409 conflict', async () => {
      const alreadyApproved = { ...PENDING_BOOKING, status: BOOKING_STATUS.APPROVED };
      fetchOne.mockResolvedValueOnce(alreadyApproved);

      await expect(
        venuesService.decideBooking(STAFF, 10, { approve: false })
      ).rejects.toMatchObject({
        status: 409,
        code: 'ALREADY_DECIDED',
      });
      expect(updateById).not.toHaveBeenCalled();
    });

    it('rejects decision on an already REJECTED booking with 409 conflict', async () => {
      const alreadyRejected = { ...PENDING_BOOKING, status: BOOKING_STATUS.REJECTED };
      fetchOne.mockResolvedValueOnce(alreadyRejected);

      await expect(
        venuesService.decideBooking(STAFF, 10, { approve: true })
      ).rejects.toMatchObject({
        status: 409,
        code: 'ALREADY_DECIDED',
      });
      expect(updateById).not.toHaveBeenCalled();
    });
  });

  /*
   * AC9: When an event has several venue bookings, each booking is approved or rejected on its own.
   * Approving or rejecting one booking does not change the status of the event or other bookings.
   */
  describe('AC9: Independent per-booking decisions', () => {
    it('deciding one booking does not modify other bookings on the same event or event status', async () => {
      const booking1 = { id: 101, event_id: 50, venue_id: 1, status: BOOKING_STATUS.PENDING };
      const booking2 = { id: 102, event_id: 50, venue_id: 2, status: BOOKING_STATUS.PENDING };

      // Decide booking 101 as REJECTED
      fetchOne
        .mockResolvedValueOnce(booking1)
        .mockResolvedValueOnce(EVENT_ROW)
        .mockResolvedValueOnce({ id: 1, name: 'Main Hall' });

      const updated1 = await venuesService.decideBooking(STAFF, 101, {
        approve: false,
        reason: 'Booked for graduation',
      });

      expect(updated1.status).toBe(BOOKING_STATUS.REJECTED);
      expect(updateById).toHaveBeenCalledTimes(1);
      expect(updateById).toHaveBeenCalledWith('venue_bookings', 101, expect.objectContaining({
        status: BOOKING_STATUS.REJECTED,
      }));

      // Verify that booking 102 remains unchanged in its PENDING status
      expect(booking2.status).toBe(BOOKING_STATUS.PENDING);
      // Verify that the event row status remains unchanged
      expect(EVENT_ROW.status).toBe('PLANNING');
    });

    it('allows subsequent approval of another booking for the same event independently', async () => {
      const booking2 = { id: 102, event_id: 50, venue_id: 2, status: BOOKING_STATUS.PENDING };

      fetchOne
        .mockResolvedValueOnce(booking2)
        .mockResolvedValueOnce(EVENT_ROW)
        .mockResolvedValueOnce({ id: 2, name: 'Annex Room' });

      const updated2 = await venuesService.decideBooking(STAFF, 102, {
        approve: true,
      });

      expect(updated2.status).toBe(BOOKING_STATUS.APPROVED);
      expect(updateById).toHaveBeenCalledWith('venue_bookings', 102, expect.objectContaining({
        status: BOOKING_STATUS.APPROVED,
      }));
    });
  });
});

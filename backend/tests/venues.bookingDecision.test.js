/**
 * SCRUM-18: Venue Staff review, approve, or reject venue booking requests.
 *
 * Acceptance criteria covered:
 *   AC1  Venue Staff can view all pending venue booking requests.
 *   AC2  Each request displays the relevant booking details, including the event, venue, date, and time.
 *   AC3  Venue Staff can approve or reject a pending booking.
 *   AC4  When rejecting a booking, Venue Staff can provide a relevant reason or information.
 *   AC5  The booking status is updated to Approved or Rejected accordingly, and decided_at is recorded.
 *   AC6  The Event Coordinator can view the updated booking status.
 *   AC7  The Event Coordinator can view the rejection reason or information provided by Venue Staff.
 *   AC8  An approved booking is recorded as a confirmed booking for the venue (status APPROVED, ALREADY_DECIDED 409 guard).
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
      // decideBooking calls findConflict, which chains .in('status', ...)
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    };
    supabase.from.mockReturnValue(query);
    updateById.mockImplementation(async (_table, id, patch) => ({ id, ...patch }));
    insertOne.mockImplementation(async (_table, row) => ({ id: 999, ...row }));
  });

  describe('AC1 & AC2: Viewing pending booking requests with full details', () => {
    /*
     * AC:       SCRUM-18 AC1 & AC2
     * Scenario: Venue Staff retrieves pending venue booking requests
     * Setup:    Database contains a pending booking with linked venue and event records
     * Expected: Response 200 contains pending bookings with event_name, venue_name, start_at, end_at, event_start_at, event_end_at
     * Type:     normal
     */
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

    /*
     * AC:       SCRUM-18 AC1
     * Scenario: Non-authorized role (Attendee) attempts to view booking requests
     * Setup:    User has ATTENDEE role
     * Expected: Request is rejected with 403 Forbidden
     * Type:     error
     */
    it('allows Event Coordinators to view bookings but denies unauthorised roles', async () => {
      mockUser = { id: 99, roles: [ROLES.ATTENDEE] };
      const res = await request(app).get('/api/venues/bookings');
      expect(res.status).toBe(403);
    });
  });

  describe('AC3, AC4 & AC5: Approving or rejecting pending bookings', () => {
    function setupLookups(booking = PENDING_BOOKING, event = EVENT_ROW, venue = VENUE_ROW) {
      fetchOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce(event)
        .mockResolvedValueOnce(venue);
    }

    /*
     * AC:       SCRUM-18 AC3 & AC5
     * Scenario: Venue Staff approves a pending booking request
     * Setup:    Signed in as Venue Staff; booking 10 is PENDING
     * Expected: Booking status is updated to APPROVED, decided_by and decided_at are saved
     * Type:     normal
     */
    it('AC3 & AC5: approves a pending booking and sets status to APPROVED and records decided_at', async () => {
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
          decided_at: expect.any(String),
        })
      );
      expect(res.body.booking.status).toBe(BOOKING_STATUS.APPROVED);
    });

    /*
     * AC:       SCRUM-18 AC4 & AC5
     * Scenario: Venue Staff rejects a booking with a reason and alternative suggestion
     * Setup:    Signed in as Venue Staff; booking 10 is PENDING
     * Expected: Booking status is updated to REJECTED, reason, alternative, and decided_at are saved
     * Type:     normal
     */
    it('AC4 & AC5: rejects a booking and records reason, alternative suggestion, and decided_at', async () => {
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
          decided_at: expect.any(String),
        })
      );
      expect(res.body.booking.status).toBe(BOOKING_STATUS.REJECTED);
      expect(res.body.booking.decision_reason).toBe('Maintenance scheduled on lighting rig');
      expect(res.body.booking.alternative_suggestion).toBe('Seminar Room 3 on same date');
    });

    /*
     * AC:       SCRUM-18 AC5
     * Scenario: Deciding a booking records the decided_at timestamp in ISO format
     * Setup:    Signed in as Venue Staff; booking 10 is PENDING
     * Expected: decided_at is recorded as an ISO date string in database update
     * Type:     normal
     */
    it('AC5: sets decided_at timestamp when decision is made', async () => {
      mockUser = STAFF;
      setupLookups();

      const before = new Date().toISOString();
      await request(app)
        .post('/api/venues/bookings/10/decision')
        .send({ approve: true });
      const after = new Date().toISOString();

      const patch = updateById.mock.calls[0][2];
      expect(patch.decided_at).toBeDefined();
      expect(Date.parse(patch.decided_at)).not.toBeNaN();
      expect(patch.decided_at >= before).toBe(true);
      expect(patch.decided_at <= after).toBe(true);
    });

    /*
     * AC:       SCRUM-18 AC3
     * Scenario: User without VENUE_STAFF role attempts to decide a booking
     * Setup:    Signed in as Event Coordinator
     * Expected: Request is rejected with 403 Forbidden
     * Type:     error
     */
    it('denies non-venue-staff users from deciding bookings', async () => {
      mockUser = COORDINATOR;
      const res = await request(app)
        .post('/api/venues/bookings/10/decision')
        .send({ approve: true });

      expect(res.status).toBe(403);
      expect(updateById).not.toHaveBeenCalled();
    });

    /*
     * AC:       SCRUM-18 AC3
     * Scenario: Venue Staff attempts to decide a non-existent booking
     * Setup:    fetchOne returns null for the requested booking ID
     * Expected: Request returns 404 Not Found
     * Type:     error
     */
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

  describe('AC6 & AC7: Coordinator visibility of booking status & rejection info', () => {
    /*
     * AC:       SCRUM-18 AC6 & AC7
     * Scenario: Event Coordinator views venue bookings for an event
     * Setup:    Coordinator loads event 50 with a REJECTED booking containing reason and alternative
     * Expected: Response 200 includes booking status, venue name, decision_reason, and alternative_suggestion
     * Type:     normal
     */
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
        expect.objectContaining({
          id: 10,
          event_id: 50,
          venue_id: 8,
          status: 'REJECTED',
          venue_name: 'Innovation Hall',
          decision_reason: 'Air conditioning malfunction',
          alternative_suggestion: 'Hall B',
        }),
      ]);
    });
  });

  describe('AC8: Confirmed booking recording & decision idempotency guard', () => {
    /*
     * AC:       SCRUM-18 AC8
     * Scenario: Venue Staff attempts to decide an already APPROVED booking via HTTP route
     * Setup:    POST /api/venues/bookings/10/decision where booking 10 is already APPROVED
     * Expected: HTTP route returns 409 Conflict with ALREADY_DECIDED error code
     * Type:     error
     */
    it('HTTP route: rejects decision on an already APPROVED booking with 409 conflict', async () => {
      mockUser = STAFF;
      const alreadyApproved = { ...PENDING_BOOKING, status: BOOKING_STATUS.APPROVED };
      fetchOne.mockResolvedValueOnce(alreadyApproved);

      const res = await request(app)
        .post('/api/venues/bookings/10/decision')
        .send({ approve: false });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('ALREADY_DECIDED');
      expect(updateById).not.toHaveBeenCalled();
    });

    /*
     * AC:       SCRUM-18 AC8
     * Scenario: Venue Staff attempts to decide an already REJECTED booking via HTTP route
     * Setup:    POST /api/venues/bookings/10/decision where booking 10 is already REJECTED
     * Expected: HTTP route returns 409 Conflict with ALREADY_DECIDED error code
     * Type:     error
     */
    it('HTTP route: rejects decision on an already REJECTED booking with 409 conflict', async () => {
      mockUser = STAFF;
      const alreadyRejected = { ...PENDING_BOOKING, status: BOOKING_STATUS.REJECTED };
      fetchOne.mockResolvedValueOnce(alreadyRejected);

      const res = await request(app)
        .post('/api/venues/bookings/10/decision')
        .send({ approve: true });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('ALREADY_DECIDED');
      expect(updateById).not.toHaveBeenCalled();
    });

    /*
     * AC:       SCRUM-18 AC8
     * Scenario: Service rejects decision on an already APPROVED booking
     * Setup:    Booking in database is already APPROVED
     * Expected: venuesService.decideBooking throws 409 ALREADY_DECIDED error
     * Type:     error
     */
    it('service: rejects decision on an already APPROVED booking with 409 conflict', async () => {
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

    /*
     * AC:       SCRUM-18 AC8
     * Scenario: Service rejects decision on an already REJECTED booking
     * Setup:    Booking in database is already REJECTED
     * Expected: venuesService.decideBooking throws 409 ALREADY_DECIDED error
     * Type:     error
     */
    it('service: rejects decision on an already REJECTED booking with 409 conflict', async () => {
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

  describe('AC9: Independent per-booking decisions', () => {
    /*
     * AC:       SCRUM-18 AC9
     * Scenario: Multiple venue bookings exist for the same event; deciding one booking does not modify others or the event
     * Setup:    Event 50 is in PLANNING with booking 101 and booking 102 both PENDING in simulated database.
     * Expected: Deciding booking 101 updates only booking 101 in the database. Loading both bookings and the event after the decision confirms only booking 101 changed.
     * Type:     normal
     */
    it('deciding one booking modifies only that booking; other bookings and the event remain unchanged', async () => {
      const dbBookings = [
        { id: 101, event_id: 50, venue_id: 1, requested_by: 21, status: BOOKING_STATUS.PENDING },
        { id: 102, event_id: 50, venue_id: 2, requested_by: 21, status: BOOKING_STATUS.PENDING },
      ];
      const dbEvent = { id: 50, name: 'Tech Symposium', coordinator_id: 21, status: 'PLANNING' };

      updateById.mockImplementation(async (table, id, patch) => {
        if (table === 'venue_bookings') {
          const booking = dbBookings.find((b) => b.id === Number(id));
          if (booking) {
            Object.assign(booking, patch);
            return { ...booking };
          }
        }
        if (table === 'events') {
          if (dbEvent.id === Number(id)) {
            Object.assign(dbEvent, patch);
            return { ...dbEvent };
          }
        }
        return { id, ...patch };
      });

      // Sequential fetchOne calls during decideBooking(101):
      // 1. fetchOne booking 101
      // 2. fetchOne event 50
      // 3. fetchOne venue 1
      fetchOne
        .mockResolvedValueOnce({ ...dbBookings[0] })
        .mockResolvedValueOnce({ ...dbEvent })
        .mockResolvedValueOnce({ id: 1, name: 'Main Hall' });

      const updated1 = await venuesService.decideBooking(STAFF, 101, {
        approve: false,
        reason: 'Booked for graduation',
      });

      expect(updated1.status).toBe(BOOKING_STATUS.REJECTED);

      // Verify simulated database state:
      // Only booking 101 changed to REJECTED with decision info
      const loadedBooking1 = dbBookings.find((b) => b.id === 101);
      const loadedBooking2 = dbBookings.find((b) => b.id === 102);

      expect(loadedBooking1.status).toBe(BOOKING_STATUS.REJECTED);
      expect(loadedBooking1.decision_reason).toBe('Booked for graduation');
      expect(loadedBooking1.decided_by).toBe(STAFF.id);

      // Booking 102 was NOT modified and remains PENDING
      expect(loadedBooking2.status).toBe(BOOKING_STATUS.PENDING);
      expect(loadedBooking2.decision_reason).toBeUndefined();

      // Event status was NOT modified and remains PLANNING
      expect(dbEvent.status).toBe('PLANNING');

      // Assert updateById was strictly called for booking 101 and never for booking 102 or events
      expect(updateById).toHaveBeenCalledTimes(1);
      expect(updateById).toHaveBeenCalledWith('venue_bookings', 101, expect.objectContaining({
        status: BOOKING_STATUS.REJECTED,
      }));
      expect(updateById).not.toHaveBeenCalledWith('venue_bookings', 102, expect.anything());
      expect(updateById).not.toHaveBeenCalledWith('events', expect.anything(), expect.anything());
    });

    /*
     * AC:       SCRUM-18 AC9
     * Scenario: After deciding one booking, subsequent decision on another booking for the same event succeeds independently
     * Setup:    Booking 101 is already decided (REJECTED); booking 102 is PENDING for the same event.
     * Expected: Deciding booking 102 updates only booking 102 to APPROVED without altering booking 101 or the event.
     * Type:     normal
     */
    it('allows subsequent approval of another booking for the same event independently', async () => {
      const dbBookings = [
        { id: 101, event_id: 50, venue_id: 1, requested_by: 21, status: BOOKING_STATUS.REJECTED, decision_reason: 'Booked for graduation' },
        { id: 102, event_id: 50, venue_id: 2, requested_by: 21, status: BOOKING_STATUS.PENDING },
      ];
      const dbEvent = { id: 50, name: 'Tech Symposium', coordinator_id: 21, status: 'PLANNING' };

      updateById.mockImplementation(async (table, id, patch) => {
        if (table === 'venue_bookings') {
          const booking = dbBookings.find((b) => b.id === Number(id));
          if (booking) {
            Object.assign(booking, patch);
            return { ...booking };
          }
        }
        return { id, ...patch };
      });

      fetchOne
        .mockResolvedValueOnce({ ...dbBookings[1] })
        .mockResolvedValueOnce({ ...dbEvent })
        .mockResolvedValueOnce({ id: 2, name: 'Annex Room' });

      const updated2 = await venuesService.decideBooking(STAFF, 102, {
        approve: true,
      });

      expect(updated2.status).toBe(BOOKING_STATUS.APPROVED);

      // Verify loaded states:
      const loadedBooking1 = dbBookings.find((b) => b.id === 101);
      const loadedBooking2 = dbBookings.find((b) => b.id === 102);

      expect(loadedBooking1.status).toBe(BOOKING_STATUS.REJECTED);
      expect(loadedBooking2.status).toBe(BOOKING_STATUS.APPROVED);
      expect(dbEvent.status).toBe('PLANNING');

      expect(updateById).toHaveBeenCalledTimes(1);
      expect(updateById).toHaveBeenCalledWith('venue_bookings', 102, expect.objectContaining({
        status: BOOKING_STATUS.APPROVED,
      }));
    });
  });
});

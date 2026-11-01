/*
 * Purpose: verify venue-booking rescheduling service behavior and its HTTP authorization boundary.
 * AC: SCRUM-62 AC1–AC8 — assigned Coordinators may safely change one non-cancelled venue booking.
 * Inputs: mocked booking/event rows, database helpers, and authenticated request users.
 * Output: passing assertions for successful changes, audit data, event status, conflicts, and authorization.
 * Failure: Jest reports any incorrect response, mutation, or audit side effect.
 */
const request = require('supertest');
const { ROLES } = require('../src/constants/roles');
const { BOOKING_STATUS } = require('../src/constants/statuses');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  throwIf: jest.fn(),
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  updateById: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn(),
  notifyUser: jest.fn(),
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

const { supabase, fetchOne, fetchMany, updateById } = require('../src/config/db');
const { writeAudit } = require('../src/services/audit.service');
const venuesService = require('../src/services/venues.service');
const { createApp } = require('../src/app');

const COORDINATOR = { id: 21, roles: [ROLES.EVENT_COORDINATOR] };
const OTHER_COORD = { id: 99, roles: [ROLES.EVENT_COORDINATOR] };
const ORGANISER = { id: 5, roles: [ROLES.EVENT_ORGANISER] };
const STAFF = { id: 40, roles: [ROLES.VENUE_STAFF] };
const EVENT_ROW = { id: 50, name: 'Tech Symposium', status: 'PLANNING', coordinator_id: 21 };
const CONFIRMED_EVENT_ROW = { ...EVENT_ROW, status: 'CONFIRMED' };
const PENDING_BOOKING = {
  id: 10,
  event_id: 50,
  venue_id: 8,
  status: BOOKING_STATUS.PENDING,
  start_at: '2026-10-20T09:00:00.000Z',
  end_at: '2026-10-20T12:00:00.000Z',
  setup_minutes: 30,
  teardown_minutes: 30,
};
/*
 * Purpose: provide rejected-booking and terminal-event fixtures for the new change guards.
 * AC: SCRUM-62 AC10–AC12 — rejected bookings and bookings for completed/cancelled events are locked.
 * Inputs: existing baseline booking and event fixtures. Output: fixtures representing locked records.
 * Failure: incorrect fixture statuses cause the guard assertions to fail.
 */
const REJECTED_BOOKING = { ...PENDING_BOOKING, id: 12, status: BOOKING_STATUS.REJECTED };
const COMPLETED_EVENT_ROW = { ...EVENT_ROW, status: 'COMPLETED' };
const CANCELLED_EVENT_ROW = { ...EVENT_ROW, status: 'CANCELLED' };
const APPROVED_BOOKING = { ...PENDING_BOOKING, id: 11, status: BOOKING_STATUS.APPROVED };
const CANCELLED_BOOKING = { ...PENDING_BOOKING, id: 13, status: BOOKING_STATUS.CANCELLED };
const NEW_PAYLOAD = {
  startAt: '2026-10-21T10:00:00.000Z',
  endAt: '2026-10-21T13:00:00.000Z',
};

/*
 * Purpose: reset mocked database operations and configure the fluent query used by findConflict.
 * AC: SCRUM-62 AC2 — conflict checks use the repository's existing query-based helper.
 * Inputs: none. Output: clean mocks whose default conflict query returns no bookings.
 * Failure: Jest assertions reveal unexpected database calls or mock state leakage.
 */
function resetDatabaseMocks() {
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  };
  supabase.from.mockReturnValue(query);
  fetchOne.mockReset();
  fetchMany.mockReset().mockResolvedValue([]);
  updateById.mockReset().mockImplementation(async (_table, id, patch) => ({ id, ...patch }));
  writeAudit.mockReset().mockResolvedValue(undefined);
  return query;
}

/*
 * Purpose: supply the booking and its event to one rescheduling service call.
 * AC: SCRUM-62 AC1 and AC7 — ownership is checked against the event assignment.
 * Inputs: optional booking and event fixtures. Output: queued fetchOne results.
 * Failure: a missing lookup result is handled by the service's error path.
 */
function setupChange(booking = PENDING_BOOKING, event = EVENT_ROW) {
  fetchOne.mockResolvedValueOnce(booking).mockResolvedValueOnce(event);
}

const app = createApp();

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  resetDatabaseMocks();
});

describe('SCRUM-62 change one venue booking', () => {
  /*
   * AC: SCRUM-62 AC1, AC3
   * Scenario: Assigned Coordinator changes the date and time of a PENDING booking.
   * Setup: fetchOne returns PENDING_BOOKING then EVENT_ROW; fetchMany returns no conflicts.
   * Expected: The booking is updated with new times and PENDING status, and an audit entry is written.
   * Type: normal
   */
  it('changes a PENDING booking and records an audit entry', async () => {
    setupChange();

    const result = await venuesService.changeBooking(COORDINATOR, PENDING_BOOKING.id, NEW_PAYLOAD);

    expect(result.status).toBe(BOOKING_STATUS.PENDING);
    expect(updateById).toHaveBeenCalledWith(
      'venue_bookings',
      PENDING_BOOKING.id,
      expect.objectContaining({
        status: BOOKING_STATUS.PENDING,
        start_at: NEW_PAYLOAD.startAt,
        end_at: NEW_PAYLOAD.endAt,
      })
    );
    expect(writeAudit).toHaveBeenCalledWith(
      COORDINATOR.id,
      'BOOKING_RESCHEDULED',
      'venue_booking',
      PENDING_BOOKING.id,
      expect.any(Object)
    );
  });

  /*
   * AC: SCRUM-62 AC1, AC3
   * Scenario: Assigned Coordinator changes the date and time of an APPROVED booking.
   * Setup: fetchOne returns APPROVED_BOOKING then EVENT_ROW; the conflict lookup is empty.
   * Expected: The changed booking is reset to PENDING for Venue Staff approval.
   * Type: normal
   */
  it('resets an APPROVED booking to PENDING after changing its time', async () => {
    setupChange(APPROVED_BOOKING);

    await venuesService.changeBooking(COORDINATOR, APPROVED_BOOKING.id, NEW_PAYLOAD);

    expect(updateById).toHaveBeenCalledWith(
      'venue_bookings',
      APPROVED_BOOKING.id,
      expect.objectContaining({ status: BOOKING_STATUS.PENDING })
    );
  });

  /*
   * AC: SCRUM-62 AC4
   * Scenario: Changing one booking leaves all sibling bookings untouched.
   * Setup: The event has a second booking, but the service receives only the target booking id.
   * Expected: Exactly one venue_bookings row is updated and the sibling fixture stays unchanged.
   * Type: boundary
   */
  it('updates only the targeted booking when sibling bookings exist', async () => {
    const siblingBooking = { ...PENDING_BOOKING, id: 15, venue_id: 9 };
    setupChange();

    await venuesService.changeBooking(COORDINATOR, PENDING_BOOKING.id, NEW_PAYLOAD);

    expect(updateById).toHaveBeenCalledTimes(1);
    expect(updateById).toHaveBeenCalledWith(
      'venue_bookings',
      PENDING_BOOKING.id,
      expect.any(Object)
    );
    expect(siblingBooking).toEqual({ ...PENDING_BOOKING, id: 15, venue_id: 9 });
  });

  /*
   * AC: SCRUM-62 AC8
   * Scenario: A booking change on a PLANNING event does not update the event row.
   * Setup: EVENT_ROW has PLANNING status and the requested time has no venue conflict.
   * Expected: Only the target venue booking is passed to updateById.
   * Type: boundary
   */
  it('does not update an event that is already PLANNING', async () => {
    setupChange(PENDING_BOOKING, EVENT_ROW);

    await venuesService.changeBooking(COORDINATOR, PENDING_BOOKING.id, NEW_PAYLOAD);

    expect(updateById).toHaveBeenCalledTimes(1);
    expect(updateById).not.toHaveBeenCalledWith('events', EVENT_ROW.id, expect.anything());
  });

  /*
   * AC: SCRUM-62 AC8
   * Scenario: Changing a booking on a CONFIRMED event returns that event to PLANNING.
   * Setup: The assigned Coordinator reschedules PENDING_BOOKING on CONFIRMED_EVENT_ROW.
   * Expected: updateById updates the event status to PLANNING with an updated_at timestamp.
   * Type: normal
   */
  it('reverts a CONFIRMED event to PLANNING', async () => {
    setupChange(PENDING_BOOKING, CONFIRMED_EVENT_ROW);

    await venuesService.changeBooking(COORDINATOR, PENDING_BOOKING.id, NEW_PAYLOAD);

    expect(updateById).toHaveBeenCalledWith(
      'events',
      CONFIRMED_EVENT_ROW.id,
      expect.objectContaining({ status: 'PLANNING', updated_at: expect.any(String) })
    );
  });

  /*
   * AC: SCRUM-62 AC5
   * Scenario: The reschedule audit entry retains the previous and requested date/time.
   * Setup: The booking has known old start_at/end_at values and NEW_PAYLOAD supplies new values.
   * Expected: writeAudit metadata contains both previous and new timestamps.
   * Type: normal
   */
  it('records previous and new date/time values in the audit metadata', async () => {
    setupChange();

    await venuesService.changeBooking(COORDINATOR, PENDING_BOOKING.id, NEW_PAYLOAD);

    expect(writeAudit).toHaveBeenCalledWith(
      COORDINATOR.id,
      'BOOKING_RESCHEDULED',
      'venue_booking',
      PENDING_BOOKING.id,
      {
        eventId: PENDING_BOOKING.event_id,
        venueId: PENDING_BOOKING.venue_id,
        previousStartAt: PENDING_BOOKING.start_at,
        previousEndAt: PENDING_BOOKING.end_at,
        newStartAt: NEW_PAYLOAD.startAt,
        newEndAt: NEW_PAYLOAD.endAt,
      }
    );
  });

  /*
   * AC: SCRUM-62 AC6
   * Scenario: A Coordinator attempts to change a booking that does not exist.
   * Setup: The booking lookup returns null.
   * Expected: The service rejects with 404 NOT_FOUND and performs no update.
   * Type: error
   */
  it('returns 404 when the booking is missing', async () => {
    fetchOne.mockResolvedValueOnce(null);

    await expect(
      venuesService.changeBooking(COORDINATOR, 999, NEW_PAYLOAD)
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-62 AC6
   * Scenario: A cancelled booking cannot be changed.
   * Setup: The booking lookup returns CANCELLED_BOOKING.
   * Expected: The service rejects with 409 BOOKING_CANCELLED before any write.
   * Type: error
   */
  it('rejects a CANCELLED booking with 409', async () => {
    fetchOne.mockResolvedValueOnce(CANCELLED_BOOKING);

    await expect(
      venuesService.changeBooking(COORDINATOR, CANCELLED_BOOKING.id, NEW_PAYLOAD)
    ).rejects.toMatchObject({ status: 409, code: 'BOOKING_CANCELLED' });
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-62 AC2
   * Scenario: The caller provides an endAt that is earlier than startAt.
   * Setup: No fetchOne is called because the guard runs before any database read.
   * Expected: 400 with error code INVALID_TIME_RANGE; updateById and fetchOne are never called.
   * Type: error
   */
  it('rejects a payload where endAt is before startAt with 400', async () => {
    const invalidPayload = {
      startAt: '2026-10-21T13:00:00.000Z',
      endAt:   '2026-10-21T10:00:00.000Z',
    };

    await expect(
      venuesService.changeBooking(COORDINATOR, PENDING_BOOKING.id, invalidPayload)
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_TIME_RANGE' });
    expect(fetchOne).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-62 AC7
   * Scenario: An Organiser attempts to change a venue booking.
   * Setup: The caller has EVENT_ORGANISER but not EVENT_COORDINATOR role.
   * Expected: The service rejects with 403 FORBIDDEN before reading or writing booking data.
   * Type: security
   */
  it('rejects Organisers before reading booking data', async () => {
    await expect(
      venuesService.changeBooking(ORGANISER, PENDING_BOOKING.id, NEW_PAYLOAD)
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(fetchOne).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-62 AC7
   * Scenario: Venue Staff attempts to change a venue booking.
   * Setup: The caller has VENUE_STAFF but not EVENT_COORDINATOR role.
   * Expected: The service rejects with 403 FORBIDDEN before reading or writing booking data.
   * Type: security
   */
  it('rejects Venue Staff before reading booking data', async () => {
    await expect(
      venuesService.changeBooking(STAFF, PENDING_BOOKING.id, NEW_PAYLOAD)
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(fetchOne).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-62 AC7
   * Scenario: A Coordinator who is not assigned to the event attempts to change its booking.
   * Setup: The event is assigned to Coordinator 99 while the caller is Coordinator 21.
   * Expected: The service rejects with 403 FORBIDDEN without updating the booking.
   * Type: security
   */
  it('rejects a Coordinator who is not assigned to the event', async () => {
    setupChange(PENDING_BOOKING, { ...EVENT_ROW, coordinator_id: OTHER_COORD.id });

    await expect(
      venuesService.changeBooking(COORDINATOR, PENDING_BOOKING.id, NEW_PAYLOAD)
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-62 AC2
   * Scenario: A new occupied window conflicts with another booking at the same venue.
   * Setup: The conflict query returns an overlapping PENDING booking at venue 8.
   * Expected: The service rejects with 409 BOOKING_CONFLICT and does not update any row.
   * Type: error
   */
  it('rejects a conflicting occupied window without changing the booking', async () => {
    setupChange();
    fetchMany.mockResolvedValueOnce([{
      ...PENDING_BOOKING,
      id: 22,
      start_at: '2026-10-21T09:30:00.000Z',
      end_at: '2026-10-21T11:30:00.000Z',
    }]);

    await expect(
      venuesService.changeBooking(COORDINATOR, PENDING_BOOKING.id, NEW_PAYLOAD)
    ).rejects.toMatchObject({ status: 409, code: 'BOOKING_CONFLICT' });
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-62 AC2
   * Scenario: The conflict lookup excludes the booking being changed to prevent self-conflict.
   * Setup: The conflict query includes the target booking with exactly the requested time.
   * Expected: The service succeeds and updates the target booking rather than reporting a conflict.
   * Type: boundary
   */
  it('excludes the target booking from the conflict query', async () => {
    const sameSlotBooking = {
      ...PENDING_BOOKING,
      start_at: NEW_PAYLOAD.startAt,
      end_at: NEW_PAYLOAD.endAt,
    };
    setupChange(sameSlotBooking);
    fetchMany.mockResolvedValueOnce([sameSlotBooking]);

    await expect(
      venuesService.changeBooking(COORDINATOR, sameSlotBooking.id, NEW_PAYLOAD)
    ).resolves.toEqual(expect.objectContaining({ status: BOOKING_STATUS.PENDING }));
    expect(updateById).toHaveBeenCalledWith(
      'venue_bookings',
      sameSlotBooking.id,
      expect.objectContaining({ start_at: NEW_PAYLOAD.startAt })
    );
  });

  /*
   * AC: SCRUM-62 AC3
   * Scenario: The new booking status is PENDING regardless of the previous eligible status.
   * Setup: Run the operation for both PENDING and APPROVED booking fixtures.
   * Expected: Both update patches contain status PENDING.
   * Type: boundary
   */
  it.each([
    ['PENDING', PENDING_BOOKING],
    ['APPROVED', APPROVED_BOOKING],
  ])('resets a %s booking to PENDING', async (_label, booking) => {
    setupChange(booking);

    await venuesService.changeBooking(COORDINATOR, booking.id, NEW_PAYLOAD);

    expect(updateById).toHaveBeenCalledWith(
      'venue_bookings',
      booking.id,
      expect.objectContaining({ status: BOOKING_STATUS.PENDING })
    );
  });

  /*
   * AC: SCRUM-62 AC8
   * Scenario: Event status is reverted only when its current status is CONFIRMED.
   * Setup: Exercise a PLANNING event and a CONFIRMED event in separate service calls.
   * Expected: Only the CONFIRMED event receives an events-table update.
   * Type: boundary
   */
  it('reverts the event only when its status is CONFIRMED', async () => {
    setupChange(PENDING_BOOKING, EVENT_ROW);
    await venuesService.changeBooking(COORDINATOR, PENDING_BOOKING.id, NEW_PAYLOAD);
    expect(updateById).not.toHaveBeenCalledWith('events', EVENT_ROW.id, expect.anything());

    resetDatabaseMocks();
    setupChange(PENDING_BOOKING, CONFIRMED_EVENT_ROW);
    await venuesService.changeBooking(COORDINATOR, PENDING_BOOKING.id, NEW_PAYLOAD);
    expect(updateById).toHaveBeenCalledWith(
      'events',
      CONFIRMED_EVENT_ROW.id,
      expect.objectContaining({ status: 'PLANNING' })
    );
  });

  /*
   * AC: SCRUM-62 AC10
   * Scenario: Attempting to modify a rejected venue booking is rejected.
   * Setup: fetchOne returns REJECTED_BOOKING.
   * Expected: 409 with error code BOOKING_REJECTED; updateById is never called.
   * Type: error
   */
  it('rejects modifying a REJECTED booking with 409', async () => {
    fetchOne.mockResolvedValueOnce(REJECTED_BOOKING);

    await expect(
      venuesService.changeBooking(COORDINATOR, REJECTED_BOOKING.id, NEW_PAYLOAD)
    ).rejects.toMatchObject({ status: 409, code: 'BOOKING_REJECTED' });
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-62 AC11
   * Scenario: Attempting to modify a venue booking on a COMPLETED event is rejected.
   * Setup: fetchOne returns PENDING_BOOKING then COMPLETED_EVENT_ROW.
   * Expected: 409 with error code EVENT_COMPLETED; updateById is never called.
   * Type: error
   */
  it('rejects modifying a booking when event is COMPLETED with 409', async () => {
    setupChange(PENDING_BOOKING, COMPLETED_EVENT_ROW);

    await expect(
      venuesService.changeBooking(COORDINATOR, PENDING_BOOKING.id, NEW_PAYLOAD)
    ).rejects.toMatchObject({ status: 409, code: 'EVENT_COMPLETED' });
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-62 AC12
   * Scenario: Attempting to modify a venue booking on a CANCELLED event is rejected.
   * Setup: fetchOne returns PENDING_BOOKING then CANCELLED_EVENT_ROW.
   * Expected: 409 with error code EVENT_CANCELLED; updateById is never called.
   * Type: error
   */
  it('rejects modifying a booking when event is CANCELLED with 409', async () => {
    setupChange(PENDING_BOOKING, CANCELLED_EVENT_ROW);

    await expect(
      venuesService.changeBooking(COORDINATOR, PENDING_BOOKING.id, NEW_PAYLOAD)
    ).rejects.toMatchObject({ status: 409, code: 'EVENT_CANCELLED' });
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-62 AC7
   * Scenario: An unauthenticated request attempts to PATCH a venue booking.
   * Setup: No authenticated user is supplied to requireAuth.
   * Expected: The route returns 401 UNAUTHENTICATED and reads or writes no booking data.
   * Type: security
   */
  it('rejects unauthenticated PATCH requests with 401', async () => {
    const result = await request(app).patch('/api/venues/bookings/10').send(NEW_PAYLOAD);

    expect(result.status).toBe(401);
    expect(result.body.error).toBe('UNAUTHENTICATED');
    expect(fetchOne).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-62 AC7
   * Scenario: An Organiser attempts to PATCH a venue booking through the HTTP route.
   * Setup: The authenticated request user has only the EVENT_ORGANISER role.
   * Expected: The route returns 403 before calling the service or reading booking data.
   * Type: security
   */
  it('rejects non-Coordinator roles at the HTTP route', async () => {
    mockUser = ORGANISER;

    const result = await request(app).patch('/api/venues/bookings/10').send(NEW_PAYLOAD);

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('FORBIDDEN');
    expect(fetchOne).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-62 AC7
   * Scenario: A Coordinator who is not assigned to the event attempts the HTTP reschedule route.
   * Setup: The caller is Coordinator 21 and the looked-up event belongs to Coordinator 99.
   * Expected: The route returns 403 and makes no database write.
   * Type: security
   */
  it('rejects an unassigned Coordinator at the HTTP route without writing', async () => {
    mockUser = COORDINATOR;
    setupChange(PENDING_BOOKING, { ...EVENT_ROW, coordinator_id: OTHER_COORD.id });

    const result = await request(app).patch('/api/venues/bookings/10').send(NEW_PAYLOAD);

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('FORBIDDEN');
    expect(updateById).not.toHaveBeenCalled();
  });
});

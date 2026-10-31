/*
 * - AC: SCRUM-61 AC1–AC7.
 * - Scenario: The assigned Coordinator cancels one venue booking.
 * - Setup: Requests use mocked users, venue bookings, events, and database helpers.
 * - Expected: Eligible bookings are cancelled independently; invalid or unauthorized requests
 *   fail without changing booking or event data.
 * - Type: normal and error.
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

const { supabase, fetchOne, fetchMany, insertOne, updateById } = require('../src/config/db');
const { writeAudit } = require('../src/services/audit.service');
const venuesService = require('../src/services/venues.service');
const { createApp } = require('../src/app');

const COORDINATOR = { id: 21, roles: [ROLES.EVENT_COORDINATOR] };
const OTHER_COORD = { id: 99, roles: [ROLES.EVENT_COORDINATOR] };
const ORGANISER = { id: 5, roles: [ROLES.EVENT_ORGANISER] };
const STAFF = { id: 40, roles: [ROLES.VENUE_STAFF] };
const EVENT_ROW = { id: 50, name: 'Tech Symposium', status: 'PLANNING', coordinator_id: 21 };
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
const APPROVED_BOOKING = { ...PENDING_BOOKING, id: 11, status: BOOKING_STATUS.APPROVED };
const TENTATIVE_BOOKING = { ...PENDING_BOOKING, id: 12, status: BOOKING_STATUS.TENTATIVE };
const CANCELLED_BOOKING = { ...PENDING_BOOKING, id: 13, status: BOOKING_STATUS.CANCELLED };
const REJECTED_BOOKING = { ...PENDING_BOOKING, id: 14, status: BOOKING_STATUS.REJECTED };

function resetDatabaseMocks() {
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  };
  supabase.from.mockReturnValue(query);
  fetchOne.mockReset();
  fetchMany.mockReset();
  updateById.mockReset().mockImplementation(async (_table, id, patch) => ({ id, ...patch }));
  writeAudit.mockReset().mockResolvedValue(undefined);
  return query;
}

function setupCancellation(booking = PENDING_BOOKING, event = EVENT_ROW) {
  fetchOne.mockResolvedValueOnce(booking).mockResolvedValueOnce(event);
}

const app = createApp();

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  resetDatabaseMocks();
});

describe('SCRUM-61 cancel one venue booking', () => {
  /*
   * - AC: SCRUM-61 AC1, AC2, AC3, AC5.
   * - Scenario: The assigned Coordinator cancels a PENDING, APPROVED, or TENTATIVE booking.
   * - Setup: The booking belongs to an event assigned to the signed-in Coordinator.
   * - Expected: The selected booking becomes CANCELLED and an audit entry records the event
   *   and venue; the event remains unchanged.
   * - Type: normal.
   */
  it.each([
    ['PENDING', PENDING_BOOKING],
    ['APPROVED', APPROVED_BOOKING],
    ['TENTATIVE', TENTATIVE_BOOKING],
  ])('cancels a %s booking and records an audit entry', async (_label, booking) => {
    mockUser = COORDINATOR;
    setupCancellation(booking);

    const result = await request(app).post(`/api/venues/bookings/${booking.id}/cancel`);

    expect(result.status).toBe(200);
    expect(updateById).toHaveBeenCalledWith(
      'venue_bookings',
      String(booking.id),
      expect.objectContaining({ status: BOOKING_STATUS.CANCELLED, updated_at: expect.any(String) })
    );
    expect(result.body.booking.status).toBe(BOOKING_STATUS.CANCELLED);
    expect(writeAudit).toHaveBeenCalledWith(
      COORDINATOR.id,
      'BOOKING_CANCELLED',
      'venue_booking',
      String(booking.id),
      { eventId: booking.event_id, venueId: booking.venue_id }
    );
  });

  /*
   * - AC: SCRUM-61 AC2, AC3.
   * - Scenario: One booking is cancelled when the event has multiple bookings.
   * - Setup: Two bookings share an event in PLANNING; one is selected for cancellation.
   * - Expected: Only the selected booking row is updated. Its sibling and the event status
   *   remain unchanged.
   * - Type: boundary.
   */
  it('updates only the selected booking and leaves event status untouched', async () => {
    mockUser = COORDINATOR;
    setupCancellation(PENDING_BOOKING);
    const siblingBooking = { ...PENDING_BOOKING, id: 15, venue_id: 9 };

    const result = await venuesService.cancelBooking(COORDINATOR, PENDING_BOOKING.id);

    expect(result.status).toBe(BOOKING_STATUS.CANCELLED);
    expect(siblingBooking.status).toBe(BOOKING_STATUS.PENDING);
    expect(updateById).toHaveBeenCalledTimes(1);
    expect(updateById).toHaveBeenCalledWith(
      'venue_bookings',
      PENDING_BOOKING.id,
      expect.objectContaining({ status: BOOKING_STATUS.CANCELLED })
    );
    expect(updateById).not.toHaveBeenCalledWith('events', EVENT_ROW.id, expect.anything());
    expect(EVENT_ROW.status).toBe('PLANNING');
  });

  /*
   * - AC: SCRUM-61 AC8.
   * - Scenario: Cancelling an approved booking on a Confirmed event returns the event to Planning.
   * - Setup: The booking belongs to a Confirmed event assigned to the signed-in Coordinator.
   * - Expected: The booking is cancelled, the event is updated to PLANNING, and audit records
   *   both the booking cancellation and automatic status transition.
   * - Type: normal.
   */
  it('transitions a Confirmed event to Planning when a booking is cancelled', async () => {
    const confirmedEvent = { ...EVENT_ROW, status: 'CONFIRMED' };
    setupCancellation(APPROVED_BOOKING, confirmedEvent);

    const result = await venuesService.cancelBooking(COORDINATOR, APPROVED_BOOKING.id);

    expect(result.status).toBe(BOOKING_STATUS.CANCELLED);
    expect(updateById).toHaveBeenNthCalledWith(
      1,
      'venue_bookings',
      APPROVED_BOOKING.id,
      expect.objectContaining({ status: BOOKING_STATUS.CANCELLED })
    );
    expect(updateById).toHaveBeenNthCalledWith(
      2,
      'events',
      confirmedEvent.id,
      expect.objectContaining({ status: 'PLANNING', updated_at: expect.any(String) })
    );
    expect(insertOne).toHaveBeenCalledWith(
      'event_status_history',
      expect.objectContaining({
        event_id: confirmedEvent.id,
        actor_id: COORDINATOR.id,
        from_status: 'CONFIRMED',
        to_status: 'PLANNING',
        note: 'Venue booking cancelled',
      })
    );
    expect(writeAudit).toHaveBeenCalledTimes(2);
    expect(writeAudit).toHaveBeenNthCalledWith(
      1,
      COORDINATOR.id,
      'BOOKING_CANCELLED',
      'venue_booking',
      APPROVED_BOOKING.id,
      { eventId: APPROVED_BOOKING.event_id, venueId: APPROVED_BOOKING.venue_id }
    );
    expect(writeAudit).toHaveBeenCalledWith(
      COORDINATOR.id,
      'EVENT_STATUS_AUTO_CHANGED',
      'event',
      confirmedEvent.id,
      {
        from_status: 'CONFIRMED',
        to_status: 'PLANNING',
        reason: 'venue_booking_cancelled',
        cancelled_booking_id: APPROVED_BOOKING.id,
      }
    );
  });

  /*
   * - AC: SCRUM-61 AC8 edge case.
   * - Scenario: Cancelling a booking on a Planning event leaves the event in Planning.
   * - Setup: The assigned Coordinator cancels an approved booking for a PLANNING event.
   * - Expected: Only the booking is updated; no event status update or transition audit occurs.
   * - Type: boundary.
   */
  it('keeps a Planning event in Planning when a booking is cancelled', async () => {
    setupCancellation(APPROVED_BOOKING, EVENT_ROW);

    await venuesService.cancelBooking(COORDINATOR, APPROVED_BOOKING.id);

    expect(updateById).toHaveBeenCalledTimes(1);
    expect(updateById).toHaveBeenCalledWith(
      'venue_bookings',
      APPROVED_BOOKING.id,
      expect.objectContaining({ status: BOOKING_STATUS.CANCELLED })
    );
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(
      COORDINATOR.id,
      'BOOKING_CANCELLED',
      'venue_booking',
      APPROVED_BOOKING.id,
      { eventId: APPROVED_BOOKING.event_id, venueId: APPROVED_BOOKING.venue_id }
    );
  });

  /*
   * - AC: SCRUM-61 AC9.
   * - Scenario: A Confirmed event permits cancellation of one of its approved venue bookings.
   * - Setup: The assigned Coordinator cancels an approved booking on a CONFIRMED event.
   * - Expected: Cancellation succeeds without a status-based 409 response.
   * - Type: normal.
   */
  it('allows cancellation of a booking for a Confirmed event', async () => {
    setupCancellation(APPROVED_BOOKING, { ...EVENT_ROW, status: 'CONFIRMED' });

    await expect(
      venuesService.cancelBooking(COORDINATOR, APPROVED_BOOKING.id)
    ).resolves.toMatchObject({ status: BOOKING_STATUS.CANCELLED });
  });

  /*
   * - AC: SCRUM-61 AC10.
   * - Scenario: Cancellation of a booking for a Completed event is rejected.
   * - Setup: The assigned Coordinator attempts to cancel an approved booking belonging to a COMPLETED event.
   * - Expected: The service returns 409 with the completed-event message and changes neither
   *   the booking nor audit records.
   * - Type: error.
   */
  it('rejects cancellation of bookings for Completed events', async () => {
    setupCancellation(APPROVED_BOOKING, { ...EVENT_ROW, status: 'COMPLETED' });

    await expect(
      venuesService.cancelBooking(COORDINATOR, APPROVED_BOOKING.id)
    ).rejects.toMatchObject({
      status: 409,
      message: 'Cannot cancel bookings for completed events',
      code: 'EVENT_COMPLETED',
    });
    expect(updateById).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  /*
   * - AC: SCRUM-61 AC10 boundary.
   * - Scenario: Completed-event validation takes precedence over duplicate cancellation validation.
   * - Setup: The event is COMPLETED and its selected booking is already CANCELLED.
   * - Expected: The service returns the completed-event 409 message, not ALREADY_CANCELLED.
   * - Type: boundary.
   */
  it('prioritizes Completed event validation over duplicate cancellation check', async () => {
    setupCancellation(CANCELLED_BOOKING, { ...EVENT_ROW, status: 'COMPLETED' });

    await expect(
      venuesService.cancelBooking(COORDINATOR, CANCELLED_BOOKING.id)
    ).rejects.toMatchObject({
      status: 409,
      message: 'Cannot cancel bookings for completed events',
      code: 'EVENT_COMPLETED',
    });
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * - AC: SCRUM-61 AC11.
   * - Scenario: Cancellation of a booking for a Cancelled event is rejected.
   * - Setup: The assigned Coordinator attempts to cancel an approved or pending booking belonging to a CANCELLED event.
   * - Expected: The service returns 409 with the cancelled-event message and changes neither the booking nor audit records.
   * - Type: error.
   */
  it.each([
    ['APPROVED', APPROVED_BOOKING],
    ['PENDING', PENDING_BOOKING],
  ])('rejects cancellation of %s bookings for Cancelled events', async (_status, booking) => {
    setupCancellation(booking, { ...EVENT_ROW, status: 'CANCELLED' });

    await expect(
      venuesService.cancelBooking(COORDINATOR, booking.id)
    ).rejects.toMatchObject({
      status: 409,
      message: 'Cannot cancel bookings for cancelled events',
      code: 'EVENT_CANCELLED',
    });
    expect(updateById).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  /*
   * - AC: SCRUM-61 AC11 boundary.
   * - Scenario: Cancelled-event validation takes precedence over duplicate cancellation validation.
   * - Setup: The event is CANCELLED and its selected booking is already CANCELLED.
   * - Expected: The service returns the cancelled-event 409 message, not ALREADY_CANCELLED.
   * - Type: boundary.
   */
  it('prioritizes Cancelled event validation over duplicate cancellation check', async () => {
    setupCancellation(CANCELLED_BOOKING, { ...EVENT_ROW, status: 'CANCELLED' });

    await expect(
      venuesService.cancelBooking(COORDINATOR, CANCELLED_BOOKING.id)
    ).rejects.toMatchObject({
      status: 409,
      message: 'Cannot cancel bookings for cancelled events',
      code: 'EVENT_CANCELLED',
    });
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * - AC: SCRUM-61 AC8 partial-success handling.
   * - Scenario: The event status update fails after a venue booking is cancelled.
   * - Setup: The event is CONFIRMED and the event update helper rejects with a database error.
   * - Expected: The booking remains committed as cancelled and the caller receives an explicit
   *   partial-success error.
   * - Type: error.
   */
  it('reports partial success when the Confirmed event status update fails', async () => {
    setupCancellation(APPROVED_BOOKING, { ...EVENT_ROW, status: 'CONFIRMED' });
    updateById
      .mockResolvedValueOnce({ id: APPROVED_BOOKING.id, status: BOOKING_STATUS.CANCELLED })
      .mockRejectedValueOnce(new Error('database unavailable'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        venuesService.cancelBooking(COORDINATOR, APPROVED_BOOKING.id)
      ).rejects.toMatchObject({
        status: 500,
        code: 'EVENT_STATUS_UPDATE_FAILED',
        message: expect.stringContaining('booking was cancelled'),
      });
      expect(updateById).toHaveBeenCalledTimes(2);
      expect(writeAudit).toHaveBeenCalledWith(
        COORDINATOR.id,
        'BOOKING_CANCELLED',
        'venue_booking',
        APPROVED_BOOKING.id,
        { eventId: APPROVED_BOOKING.event_id, venueId: APPROVED_BOOKING.venue_id }
      );
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to move event'),
        expect.any(Error)
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  /*
   * - AC: SCRUM-61 AC4.
   * - Scenario: A cancelled booking overlaps a venue availability search window.
   * - Setup: The conflict query returns a booking with status CANCELLED at the requested venue
   *   and time.
   * - Expected: The search reports no conflict because the cancelled booking no longer
   *   occupies the venue.
   * - Type: boundary.
   */
  it('does not treat a cancelled booking as a venue conflict', async () => {
    fetchMany.mockResolvedValueOnce([{ ...PENDING_BOOKING, status: BOOKING_STATUS.CANCELLED }]);

    const conflict = await venuesService.findConflict(
      PENDING_BOOKING.venue_id,
      PENDING_BOOKING.start_at,
      PENDING_BOOKING.end_at
    );

    expect(conflict).toBeNull();
  });

  /*
   * - AC: SCRUM-61 cancellation error contract.
   * - Scenario: The Coordinator attempts to cancel a booking that does not exist.
   * - Setup: The booking lookup returns no row.
   * - Expected: The request returns 404 NOT_FOUND and no booking is updated.
   * - Type: error.
   */
  it('returns 404 when the booking is missing', async () => {
    mockUser = COORDINATOR;
    fetchOne.mockResolvedValueOnce(null);

    const result = await request(app).post('/api/venues/bookings/999/cancel');

    expect(result.status).toBe(404);
    expect(result.body.error).toBe('NOT_FOUND');
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * - AC: SCRUM-61 AC6 and invalid-status handling.
   * - Scenario: The Coordinator attempts to cancel a CANCELLED or REJECTED booking.
   * - Setup: The booking lookup returns the selected terminal status.
   * - Expected: A CANCELLED booking returns 409 ALREADY_CANCELLED; a REJECTED booking returns
   *   409 INVALID_STATUS. Neither booking is updated.
   * - Type: error.
   */
  it.each([
    ['CANCELLED', CANCELLED_BOOKING, 'ALREADY_CANCELLED'],
    ['REJECTED', REJECTED_BOOKING, 'INVALID_STATUS'],
  ])('rejects a %s booking with 409', async (_label, booking, code) => {
    mockUser = COORDINATOR;
    fetchOne.mockResolvedValueOnce(booking).mockResolvedValueOnce(EVENT_ROW);

    const result = await request(app).post(`/api/venues/bookings/${booking.id}/cancel`);

    expect(result.status).toBe(409);
    expect(result.body.error).toBe(code);
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * - AC: SCRUM-61 AC7.
   * - Scenario: An Organiser or Venue Staff member attempts to cancel a booking.
   * - Setup: The caller lacks the Event Coordinator role.
   * - Expected: The route returns 403 FORBIDDEN before the booking is read or changed.
   * - Type: error.
   */
  it.each([ORGANISER, STAFF])('forbids users without Coordinator role', async (user) => {
    mockUser = user;

    const result = await request(app).post('/api/venues/bookings/10/cancel');

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('FORBIDDEN');
    expect(fetchOne).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * - AC: SCRUM-61 AC7.
   * - Scenario: A Coordinator attempts to cancel a booking for an event assigned to another Coordinator.
   * - Setup: The event belongs to Coordinator 99; the caller is Coordinator 21.
   * - Expected: The request returns 403 FORBIDDEN and leaves the booking unchanged.
   * - Type: error.
   */
  it('forbids a Coordinator who is not assigned to the event', async () => {
    mockUser = COORDINATOR;
    setupCancellation(PENDING_BOOKING, { ...EVENT_ROW, coordinator_id: OTHER_COORD.id });

    const result = await request(app).post('/api/venues/bookings/10/cancel');

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('FORBIDDEN');
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * - AC: SCRUM-61 cross-cutting authentication.
   * - Scenario: An unauthenticated caller posts to the booking cancellation route.
   * - Setup: The request has no authenticated user session.
   * - Expected: The route returns 401 UNAUTHENTICATED before reading or changing the booking.
   * - Type: error.
   */
  it('rejects unauthenticated cancellation requests with 401', async () => {
    const result = await request(app).post('/api/venues/bookings/10/cancel');

    expect(result.status).toBe(401);
    expect(result.body.error).toBe('UNAUTHENTICATED');
    expect(fetchOne).not.toHaveBeenCalled();
  });
});

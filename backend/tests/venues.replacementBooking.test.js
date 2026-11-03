/*
 * SCRUM-68: request a replacement venue for a booking needing alternative arrangements.
 *
 *   AC1  Only bookings currently marked needs_review can be replaced.
 *   AC2  The replacement uses the regular conflict-checked booking request path.
 *   AC3  Event details and the event schedule are not changed.
 *   AC4  The event is not cancelled when a replacement is requested.
 *   AC5  The replacement is created as PENDING for Venue Staff review.
 *   AC6  Only the event's assigned Coordinator may submit the request.
 */
const request = require('supertest');
const { ROLES } = require('../src/constants/roles');
const { BOOKING_STATUS } = require('../src/constants/statuses');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  updateById: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/notifications.service', () => ({
  notifyVenueStaff: jest.fn().mockResolvedValue(undefined),
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
const { createApp } = require('../src/app');

const COORDINATOR = { id: 21, roles: [ROLES.EVENT_COORDINATOR] };
const OTHER_COORDINATOR = { id: 99, roles: [ROLES.EVENT_COORDINATOR] };
const STAFF = { id: 40, roles: [ROLES.VENUE_STAFF] };
const EVENT = {
  id: 50,
  name: 'Tech Symposium',
  purpose: 'Showcase new technology',
  status: 'CONFIRMED',
  coordinator_id: COORDINATOR.id,
  start_at: '2026-11-20T08:00:00.000Z',
  end_at: '2026-11-20T18:00:00.000Z',
  expected_attendance: 120,
};
const AFFECTED_BOOKING = {
  id: 10,
  event_id: EVENT.id,
  venue_id: 8,
  status: BOOKING_STATUS.APPROVED,
  needs_review: true,
  start_at: '2026-11-20T08:00:00.000Z',
  end_at: '2026-11-20T18:00:00.000Z',
};
const REPLACEMENT_VENUE = {
  id: 9,
  name: 'Innovation Hall',
  is_active: true,
  setup_minutes: 20,
  teardown_minutes: 40,
};

const app = createApp();

function resetMocks() {
  jest.clearAllMocks();
  fetchOne.mockReset();
  fetchMany.mockReset();
  mockUser = COORDINATOR;
  supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  });
  insertOne.mockImplementation(async (_table, row) => ({ id: 99, ...row }));
  updateById.mockResolvedValue(null);
}

function setupReplacement({ booking = AFFECTED_BOOKING, event = EVENT, venue = REPLACEMENT_VENUE } = {}) {
  fetchOne
    .mockResolvedValueOnce(booking)
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce(venue)
    // The standard request path reads event and venue again for the staff notification.
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce(venue);
}

beforeEach(resetMocks);

describe('SCRUM-68 replacement venue requests', () => {
  /*
   * AC: SCRUM-68 AC1, AC2, AC3, AC4, AC5, AC6.
   * Scenario: The assigned Coordinator requests a different venue for an affected event.
   * Setup: The original booking is APPROVED and flagged; the selected replacement venue
   *        is active and conflict-free; the event has a saved schedule and details.
   * Expected: A PENDING booking is created for the same event, using the event's saved
   *           schedule and replacement venue setup values; the event is not updated.
   * Type: normal.
   */
  // SCRUM-68-TC01
  it('creates a pending replacement booking without changing the event or affected booking', async () => {
    setupReplacement();
    fetchMany.mockResolvedValueOnce([]);

    const response = await request(app)
      .post(`/api/venues/bookings/${AFFECTED_BOOKING.id}/replacement`)
      .send({ venueId: REPLACEMENT_VENUE.id });

    expect(response.status).toBe(201);
    expect(response.body.booking).toMatchObject({
      event_id: EVENT.id,
      venue_id: REPLACEMENT_VENUE.id,
      status: BOOKING_STATUS.PENDING,
      start_at: EVENT.start_at,
      end_at: EVENT.end_at,
      setup_minutes: REPLACEMENT_VENUE.setup_minutes,
      teardown_minutes: REPLACEMENT_VENUE.teardown_minutes,
    });
    expect(insertOne).toHaveBeenCalledWith('venue_bookings', expect.objectContaining({
      event_id: EVENT.id,
      venue_id: REPLACEMENT_VENUE.id,
      requested_by: COORDINATOR.id,
      status: BOOKING_STATUS.PENDING,
      start_at: EVENT.start_at,
      end_at: EVENT.end_at,
    }));
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-68 AC1.
   * Scenario: A Coordinator submits a replacement request for an unflagged booking.
   * Setup: The source booking has needs_review false.
   * Expected: The server returns 409 and creates no booking.
   * Type: negative.
   */
  // SCRUM-68-TC02
  it('rejects a replacement request when the source booking is no longer flagged', async () => {
    fetchOne.mockResolvedValueOnce({ ...AFFECTED_BOOKING, needs_review: false });
    fetchOne.mockResolvedValueOnce(EVENT);

    const response = await request(app)
      .post(`/api/venues/bookings/${AFFECTED_BOOKING.id}/replacement`)
      .send({ venueId: REPLACEMENT_VENUE.id });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('ALTERNATIVE_NOT_REQUIRED');
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-68 AC6.
   * Scenario: A Coordinator who is not assigned to the event requests a replacement.
   * Setup: The source booking is flagged but the event belongs to another Coordinator.
   * Expected: The server returns 403 before reading a venue or creating a booking.
   * Type: negative.
   */
  // SCRUM-68-TC03
  it('rejects a replacement request from a Coordinator not assigned to the event', async () => {
    mockUser = OTHER_COORDINATOR;
    fetchOne.mockResolvedValueOnce(AFFECTED_BOOKING);
    fetchOne.mockResolvedValueOnce(EVENT);

    const response = await request(app)
      .post(`/api/venues/bookings/${AFFECTED_BOOKING.id}/replacement`)
      .send({ venueId: REPLACEMENT_VENUE.id });

    expect(response.status).toBe(403);
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-68 AC6.
   * Scenario: A non-Coordinator attempts to request a replacement venue.
   * Setup: The caller has Venue Staff role.
   * Expected: The route rejects the caller with 403 without reading or creating bookings.
   * Type: negative.
   */
  // SCRUM-68-TC04
  it('blocks users without the Event Coordinator role at the route', async () => {
    mockUser = STAFF;

    const response = await request(app)
      .post(`/api/venues/bookings/${AFFECTED_BOOKING.id}/replacement`)
      .send({ venueId: REPLACEMENT_VENUE.id });

    expect(response.status).toBe(403);
    expect(fetchOne).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-68 AC2.
   * Scenario: The replacement venue conflicts with another confirmed booking.
   * Setup: The selected venue's normal conflict lookup returns an overlapping APPROVED booking.
   * Expected: The standard BOOKING_CONFLICT response is returned and no replacement is saved.
   * Type: negative.
   */
  // SCRUM-68-TC05
  it('applies the regular venue conflict check to replacement requests', async () => {
    setupReplacement();
    fetchMany.mockResolvedValueOnce([{
      id: 22,
      venue_id: REPLACEMENT_VENUE.id,
      status: BOOKING_STATUS.APPROVED,
      start_at: EVENT.start_at,
      end_at: EVENT.end_at,
      setup_minutes: 0,
      teardown_minutes: 0,
    }]);

    const response = await request(app)
      .post(`/api/venues/bookings/${AFFECTED_BOOKING.id}/replacement`)
      .send({ venueId: REPLACEMENT_VENUE.id });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('BOOKING_CONFLICT');
    expect(insertOne).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-68 AC2.
   * Scenario: A Coordinator selects the affected venue again as its own replacement.
   * Setup: The source booking's venue id is submitted as the replacement venue id.
   * Expected: The server rejects the request and creates no booking.
   * Type: boundary.
   */
  // SCRUM-68-TC06
  it('requires the replacement venue to differ from the affected venue', async () => {
    fetchOne.mockResolvedValueOnce(AFFECTED_BOOKING);
    fetchOne.mockResolvedValueOnce(EVENT);

    const response = await request(app)
      .post(`/api/venues/bookings/${AFFECTED_BOOKING.id}/replacement`)
      .send({ venueId: AFFECTED_BOOKING.venue_id });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('SAME_VENUE');
    expect(insertOne).not.toHaveBeenCalled();
  });
});

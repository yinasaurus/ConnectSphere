/*
 * SCRUM-79: notify affected Event Coordinators when Venue Staff record an unavailability period.
 *
 *   AC1  Each affected booking's Coordinator is told to arrange alternatives.
 *   AC2  The notice names the event, venue and unavailability period.
 *   AC3  A Coordinator with multiple affected events receives one notice per event.
 *   AC4  Only Coordinators of bookings matched by SCRUM-60 are notified.
 *   AC5  No affected booking means no notice.
 *
 * Dependency: SCRUM-60 identifies overlapping bookings; SCRUM-72 records the period.
 */
const { ROLES } = require('../src/constants/roles');
const { BOOKING_STATUS } = require('../src/constants/statuses');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchMany: jest.fn(),
  fetchOne: jest.fn(),
  insertOne: jest.fn(),
  updateById: jest.fn(),
  throwIf: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/notifications.service', () => ({
  notifyVenueStaff: jest.fn().mockResolvedValue(undefined),
}));

const { supabase, fetchOne, fetchMany, insertOne, updateById } = require('../src/config/db');
const { notifyUser } = require('../src/services/audit.service');
const venuesService = require('../src/services/venues.service');

const VENUE_STAFF = { id: 5, roles: [ROLES.VENUE_STAFF] };
const PERIOD = {
  id: 60,
  venue_id: 7,
  reason: 'Maintenance',
  start_at: '2026-11-10T09:00:00.000Z',
  end_at: '2026-11-10T17:00:00.000Z',
};

function affectedBooking({
  id = 100,
  eventId = 30,
  eventName = 'Tech Symposium',
  coordinatorId = 21,
  venueId = PERIOD.venue_id,
  startAt = '2026-11-10T10:00:00.000Z',
  endAt = '2026-11-10T12:00:00.000Z',
  status = BOOKING_STATUS.APPROVED,
} = {}) {
  return {
    id,
    event_id: eventId,
    venue_id: venueId,
    status,
    start_at: startAt,
    end_at: endAt,
    setup_minutes: 0,
    teardown_minutes: 0,
    needs_review: false,
    events: { name: eventName, coordinator_id: coordinatorId },
    venues: { name: 'Grand Hall' },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  });
  fetchMany.mockResolvedValue([]);
  insertOne.mockImplementation(async (_table, row) => ({ id: PERIOD.id, ...row }));
  updateById.mockImplementation(async (_table, id, patch) => ({ id, ...patch }));
});

describe('SCRUM-79 Coordinator notices for venue unavailability', () => {
  /*
   * AC: SCRUM-79 AC1 & AC2.
   * Scenario: Venue Staff records a period overlapping an approved booking.
   * Setup: The booking has an assigned Coordinator and related event and venue details.
   * Expected: That Coordinator gets a notice identifying the event, venue, period and reason.
   * Type: normal.
   */
  // SCRUM-79-TC01
  it('notifies the affected booking Coordinator with event, venue and period details', async () => {
    fetchMany.mockResolvedValueOnce([affectedBooking()]);

    await venuesService.blockVenue(VENUE_STAFF, {
      venueId: PERIOD.venue_id,
      startAt: PERIOD.start_at,
      endAt: PERIOD.end_at,
      reason: PERIOD.reason,
    });

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      21,
      'VENUE_UNAVAILABLE',
      'Alternative arrangements required',
      expect.stringContaining('Tech Symposium at Grand Hall'),
      30
    );
    expect(notifyUser.mock.calls[0][3]).toContain(PERIOD.start_at);
    expect(notifyUser.mock.calls[0][3]).toContain(PERIOD.end_at);
    expect(notifyUser.mock.calls[0][3]).toContain('Maintenance');
  });

  /*
   * AC: SCRUM-79 AC3.
   * Scenario: One Coordinator has bookings for two different events affected by one period.
   * Setup: Two overlapping bookings are linked to different events but the same Coordinator.
   * Expected: The Coordinator gets a separate event-identifying notice for each event.
   * Type: normal.
   */
  // SCRUM-79-TC02
  it('sends one notice per affected event when a Coordinator has multiple affected events', async () => {
    fetchMany.mockResolvedValueOnce([
      affectedBooking({ id: 100, eventId: 30, eventName: 'Tech Symposium' }),
      affectedBooking({ id: 101, eventId: 31, eventName: 'Design Forum' }),
    ]);

    await venuesService.blockVenue(VENUE_STAFF, {
      venueId: PERIOD.venue_id,
      startAt: PERIOD.start_at,
      endAt: PERIOD.end_at,
      reason: PERIOD.reason,
    });

    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(notifyUser).toHaveBeenNthCalledWith(
      1, 21, 'VENUE_UNAVAILABLE', expect.any(String), expect.stringContaining('Tech Symposium'), 30
    );
    expect(notifyUser).toHaveBeenNthCalledWith(
      2, 21, 'VENUE_UNAVAILABLE', expect.any(String), expect.stringContaining('Design Forum'), 31
    );
  });

  /*
   * AC: SCRUM-79 AC3.
   * Scenario: Several bookings for the same event and Coordinator overlap the period.
   * Setup: Two booking rows share the event and Coordinator.
   * Expected: A single event notice is sent rather than duplicate notices for the same event.
   * Type: boundary.
   */
  // SCRUM-79-TC03
  it('does not duplicate notices for multiple affected bookings of the same event', async () => {
    fetchMany.mockResolvedValueOnce([
      affectedBooking({ id: 100, eventId: 30 }),
      affectedBooking({ id: 101, eventId: 30 }),
    ]);

    await venuesService.blockVenue(VENUE_STAFF, {
      venueId: PERIOD.venue_id,
      startAt: PERIOD.start_at,
      endAt: PERIOD.end_at,
      reason: PERIOD.reason,
    });

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      21, 'VENUE_UNAVAILABLE', expect.any(String), expect.any(String), 30
    );
  });

  /*
   * AC: SCRUM-79 AC4 & AC5.
   * Scenario: Candidate booking rows include a different venue, a non-overlapping window,
   *           and a pending request, with no qualifying affected booking.
   * Setup: All candidate rows have valid event/Coordinator relations.
   * Expected: SCRUM-60 matching excludes every row and no notice is sent.
   * Type: boundary.
   */
  // SCRUM-79-TC04
  it('sends no notices for other venues, outside periods or pending bookings', async () => {
    fetchMany.mockResolvedValueOnce([
      affectedBooking({ id: 101, venueId: 99 }),
      affectedBooking({
        id: 102,
        startAt: '2026-11-10T18:00:00.000Z',
        endAt: '2026-11-10T20:00:00.000Z',
      }),
      affectedBooking({ id: 103, status: BOOKING_STATUS.PENDING }),
    ]);

    await venuesService.blockVenue(VENUE_STAFF, {
      venueId: PERIOD.venue_id,
      startAt: PERIOD.start_at,
      endAt: PERIOD.end_at,
      reason: PERIOD.reason,
    });

    expect(notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-79 AC4 & AC5.
   * Scenario: No booking overlaps the recorded venue period.
   * Setup: The affected-booking lookup returns an empty result.
   * Expected: The period is saved, but no Coordinator notice is created.
   * Type: boundary.
   */
  // SCRUM-79-TC05
  it('saves an unavailability period without notices when no booking is affected', async () => {
    fetchMany.mockResolvedValueOnce([]);

    const result = await venuesService.blockVenue(VENUE_STAFF, {
      venueId: PERIOD.venue_id,
      startAt: PERIOD.start_at,
      endAt: PERIOD.end_at,
      reason: PERIOD.reason,
    });

    expect(result.id).toBe(PERIOD.id);
    expect(insertOne).toHaveBeenCalledWith('venue_unavailability', expect.any(Object));
    expect(notifyUser).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-79 AC4.
   * Scenario: Affected bookings belong to different Event Coordinators.
   * Setup: Two overlapping event bookings each have their own assigned Coordinator.
   * Expected: Notices go only to those two assigned Coordinator ids.
   * Type: normal.
   */
  // SCRUM-79-TC06
  it('notifies only the Coordinators assigned to affected bookings', async () => {
    fetchMany.mockResolvedValueOnce([
      affectedBooking({ id: 100, eventId: 30, coordinatorId: 21 }),
      affectedBooking({ id: 101, eventId: 31, coordinatorId: 22 }),
    ]);

    await venuesService.blockVenue(VENUE_STAFF, {
      venueId: PERIOD.venue_id,
      startAt: PERIOD.start_at,
      endAt: PERIOD.end_at,
      reason: PERIOD.reason,
    });

    expect(notifyUser.mock.calls.map(([userId]) => userId)).toEqual([21, 22]);
  });

  /*
   * AC: SCRUM-79 AC4.
   * Scenario: An affected booking belongs to an event that has no assigned Coordinator.
   * Setup: coordinator_id is null.
   * Expected: No notification is dispatched; operation succeeds without error.
   * Type: boundary.
   */
  // SCRUM-79-TC07
  it('does not send notice if the affected event has no assigned coordinator', async () => {
    fetchMany.mockResolvedValueOnce([
      affectedBooking({ id: 100, eventId: 30, coordinatorId: null }),
    ]);

    await venuesService.blockVenue(VENUE_STAFF, {
      venueId: PERIOD.venue_id,
      startAt: PERIOD.start_at,
      endAt: PERIOD.end_at,
      reason: PERIOD.reason,
    });

    expect(notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-79 AC1 & AC4.
   * Scenario: An active tentative hold (with future expiry) overlaps the unavailability period.
   * Setup: Booking status is TENTATIVE with future hold_expires_at.
   * Expected: Coordinator is notified of the unavailability for the tentative hold.
   * Type: normal.
   */
  // SCRUM-79-TC08
  it('notifies the coordinator of an active tentative hold overlapping the period', async () => {
    fetchMany.mockResolvedValueOnce([
      {
        ...affectedBooking({ id: 105, eventId: 35, coordinatorId: 25 }),
        status: BOOKING_STATUS.TENTATIVE,
        hold_expires_at: '2026-12-01T00:00:00.000Z',
      },
    ]);

    await venuesService.blockVenue(VENUE_STAFF, {
      venueId: PERIOD.venue_id,
      startAt: PERIOD.start_at,
      endAt: PERIOD.end_at,
      reason: PERIOD.reason,
    });

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      25,
      'VENUE_UNAVAILABLE',
      'Alternative arrangements required',
      expect.stringContaining('Tech Symposium at Grand Hall'),
      35
    );
  });

  /*
   * AC: SCRUM-79 & SCRUM-60.
   * Scenario: Venue Staff retrieves the affected bookings list for an existing unavailability period.
   * Setup: Unavailability period exists; listBookingsAffectedByUnavailability is queried.
   * Expected: Affected bookings are returned, but notifyUser is NOT called during read operations.
   * Type: boundary.
   */
  // SCRUM-79-TC09
  it('does not dispatch notices when viewing or listing affected bookings', async () => {
    fetchOne.mockResolvedValueOnce(PERIOD);
    fetchMany.mockResolvedValueOnce([affectedBooking({ id: 100, eventId: 30, coordinatorId: 21 })]);

    await venuesService.listBookingsAffectedByUnavailability(VENUE_STAFF, PERIOD.id);

    expect(notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-79 AC3 & AC4.
   * Scenario: Coordinator A has two affected events, and Coordinator B has one affected event.
   * Setup: 3 affected bookings across 2 coordinators and 3 different events.
   * Expected: Coordinator A receives 2 notices (one per event); Coordinator B receives 1 notice. Total 3 notices.
   * Type: normal.
   */
  // SCRUM-79-TC10
  it('dispatches exactly one notice per event when multiple coordinators have multiple affected events', async () => {
    fetchMany.mockResolvedValueOnce([
      affectedBooking({ id: 100, eventId: 30, eventName: 'Event 1', coordinatorId: 21 }),
      affectedBooking({ id: 101, eventId: 31, eventName: 'Event 2', coordinatorId: 21 }),
      affectedBooking({ id: 102, eventId: 32, eventName: 'Event 3', coordinatorId: 22 }),
    ]);

    await venuesService.blockVenue(VENUE_STAFF, {
      venueId: PERIOD.venue_id,
      startAt: PERIOD.start_at,
      endAt: PERIOD.end_at,
      reason: PERIOD.reason,
    });

    expect(notifyUser).toHaveBeenCalledTimes(3);
    expect(notifyUser).toHaveBeenCalledWith(21, 'VENUE_UNAVAILABLE', expect.any(String), expect.stringContaining('Event 1'), 30);
    expect(notifyUser).toHaveBeenCalledWith(21, 'VENUE_UNAVAILABLE', expect.any(String), expect.stringContaining('Event 2'), 31);
    expect(notifyUser).toHaveBeenCalledWith(22, 'VENUE_UNAVAILABLE', expect.any(String), expect.stringContaining('Event 3'), 32);
  });

  /*
   * AC: SCRUM-79 AC2.
   * Scenario: Venue unavailability is recorded with custom free-text reason (e.g. Renovation).
   * Setup: reason is set to 'Emergency electrical inspection & repairs'.
   * Expected: Notice body explicitly includes 'Reason: Emergency electrical inspection & repairs.'
   * Type: normal.
   */
  // SCRUM-79-TC11
  it('includes custom free-text reason in the notice body', async () => {
    fetchMany.mockResolvedValueOnce([affectedBooking({ id: 100, eventId: 30, coordinatorId: 21 })]);

    await venuesService.blockVenue(VENUE_STAFF, {
      venueId: PERIOD.venue_id,
      startAt: PERIOD.start_at,
      endAt: PERIOD.end_at,
      reason: 'Emergency electrical inspection & repairs',
    });

    expect(notifyUser).toHaveBeenCalledTimes(1);
    const body = notifyUser.mock.calls[0][3];
    expect(body).toContain('Reason: Emergency electrical inspection & repairs.');
    expect(body).toContain('Please arrange an alternative venue.');
  });
});

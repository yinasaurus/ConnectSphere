/**
 * SCRUM-60: identify bookings affected by a venue becoming unavailable.
 *
 *   AC1  When a period is recorded, the system identifies every existing booking at that
 *        venue whose occupied window overlaps it.
 *   AC2  Occupied window = event start - setup time to event end + turnaround time.
 *   AC3  A window that ends exactly when the period starts, or starts exactly when the
 *        period ends, is not identified.
 *   AC4  Only confirmed bookings (APPROVED) and active tentative holds are identified.
 *        Pending requests and expired holds are not.
 *   AC5  Bookings at other venues are not identified, including another venue booking of
 *        the same multi-venue event.
 *   AC6  Bookings already in the past are not identified.
 *   AC7  Each identified booking is marked needing alternative arrangements (needs_review,
 *        the same flag SCRUM-42/58 already use), so the Coordinator can see it.
 *   AC8  The Venue Staff member who recorded the period can view the identified bookings.
 *   AC9  The event's status and the booking's venue, date and time are unchanged.
 *
 * Labels:
 *   US60-B..  service rules (venuesService.identifyAndMarkAffectedBookings /
 *             listBookingsAffectedByUnavailability / blockVenue)
 *   US60-R..  HTTP route (auth cookie + service)
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  updateById: jest.fn(),
}));

const { supabase, fetchOne, fetchMany, insertOne, updateById } = require('../src/config/db');
const venuesService = require('../src/services/venues.service');
const { ROLES } = require('../src/constants/roles');
const { BOOKING_STATUS } = require('../src/constants/statuses');
const { env } = require('../src/config/env');

const venueStaff = { id: 5, roles: [ROLES.VENUE_STAFF] };
const organiser = { id: 1, roles: [ROLES.EVENT_ORGANISER] };

const NOW = new Date('2026-11-01T00:00:00Z');

function booking(overrides = {}) {
  return {
    id: 100,
    event_id: 30,
    venue_id: 7,
    status: BOOKING_STATUS.APPROVED,
    start_at: '2026-11-10T10:00:00Z',
    end_at: '2026-11-10T12:00:00Z',
    setup_minutes: 0,
    teardown_minutes: 0,
    needs_review: false,
    events: { name: 'Tech Symposium' },
    ...overrides,
  };
}

function period(overrides = {}) {
  return {
    id: 60,
    venue_id: 7,
    reason: 'Maintenance',
    start_at: '2026-11-10T09:00:00Z',
    end_at: '2026-11-10T17:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  insertOne.mockImplementation(async (table, row) => ({ id: 60, ...row }));
  updateById.mockImplementation(async (table, id, patch) => ({ id, ...patch }));
  supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  });
});

describe('SCRUM-60 identify and mark affected bookings (service rules)', () => {
  /*
   * AC:       SCRUM-60 (AC1: every booking whose occupied window overlaps the period is
   *           identified; AC7: identified bookings are marked needs_review)
   * Scenario: An APPROVED booking's raw window sits inside the recorded period.
   * Setup:    Booking 10:00-12:00 at venue 7; period 09:00-17:00 at venue 7.
   * Expected: The booking is returned, and updateById marks it needs_review: true.
   * Type:     normal
   */
  // SCRUM-60-TC01
  it('US60-B01: an overlapping APPROVED booking is identified and marked', async () => {
    fetchMany.mockResolvedValueOnce([booking()]);

    const result = await venuesService.identifyAndMarkAffectedBookings(7, period(), NOW);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 100, eventId: 30, eventName: 'Tech Symposium' });
    expect(updateById).toHaveBeenCalledWith('venue_bookings', 100, expect.objectContaining({
      needs_review: true,
    }));
  });

  /*
   * AC:       SCRUM-60 (AC2: occupied window = start - setup to end + turnaround)
   * Scenario: A booking's raw window (10:00-12:00) does not touch the period (09:00-09:45),
   *           but its padded occupied window (30 min setup, 45 min teardown => 9:30-12:45)
   *           does overlap it.
   * Setup:    Booking 10:00-12:00, setup 30, teardown 45; period 09:00-09:45.
   * Expected: The booking is identified -- the padding is what makes it overlap.
   * Type:     normal
   */
  // SCRUM-60-TC02
  it('US60-B02: the occupied window includes setup and turnaround padding', async () => {
    fetchMany.mockResolvedValueOnce([booking({ setup_minutes: 30, teardown_minutes: 45 })]);

    const result = await venuesService.identifyAndMarkAffectedBookings(
      7,
      period({ start_at: '2026-11-10T09:00:00Z', end_at: '2026-11-10T09:45:00Z' }),
      NOW
    );

    expect(result).toHaveLength(1);
  });

  /*
   * AC:       SCRUM-60 (AC3: a window that only touches the period's edge is not identified)
   * Scenario: A booking's occupied window ends exactly when the period starts, and another
   *           starts exactly when the period ends.
   * Setup:    Period 10:00-12:00. Booking A occupies 08:00-10:00 (ends at period start).
   *           Booking B occupies 12:00-14:00 (starts at period end).
   * Expected: Neither booking is identified; updateById is never called.
   * Type:     boundary
   */
  // SCRUM-60-TC03
  it('US60-B03: a touching-edge occupied window is not identified', async () => {
    fetchMany.mockResolvedValueOnce([
      booking({ id: 101, start_at: '2026-11-10T06:00:00Z', end_at: '2026-11-10T08:00:00Z' }),
      booking({ id: 102, start_at: '2026-11-10T12:00:00Z', end_at: '2026-11-10T14:00:00Z' }),
    ]);

    const result = await venuesService.identifyAndMarkAffectedBookings(
      7,
      period({ start_at: '2026-11-10T08:00:00Z', end_at: '2026-11-10T12:00:00Z' }),
      NOW
    );

    expect(result).toHaveLength(0);
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-60 (AC4: only confirmed bookings and active tentative holds are
   *           identified; pending requests and expired holds are not)
   * Scenario: A PENDING request, a REJECTED booking, a CANCELLED booking, and an expired
   *           TENTATIVE hold all overlap the period, but none should be identified.
   * Setup:    Four bookings with those statuses (the hold has hold_expires_at in the past).
   * Expected: None are identified; updateById is never called.
   * Type:     error
   */
  // SCRUM-60-TC04
  it.each([
    ['PENDING', { status: BOOKING_STATUS.PENDING }],
    ['REJECTED', { status: BOOKING_STATUS.REJECTED }],
    ['CANCELLED', { status: BOOKING_STATUS.CANCELLED }],
    ['an expired hold', { status: BOOKING_STATUS.TENTATIVE, hold_expires_at: '2026-11-01T00:00:00Z' }],
  ])('US60-B04: a booking with status %s is not identified', async (_label, overrides) => {
    fetchMany.mockResolvedValueOnce([booking(overrides)]);

    const result = await venuesService.identifyAndMarkAffectedBookings(7, period(), NOW);

    expect(result).toHaveLength(0);
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-60 (AC4: an active tentative hold is identified, without setup/
   *           turnaround padding)
   * Scenario: A TENTATIVE hold with a future expiry overlaps the period on its raw window.
   * Setup:    Hold 10:00-12:00, hold_expires_at in the future; period 09:00-17:00.
   * Expected: The hold is identified and marked needs_review.
   * Type:     normal
   */
  // SCRUM-60-TC05
  it('US60-B05: an active tentative hold is identified', async () => {
    fetchMany.mockResolvedValueOnce([
      booking({
        status: BOOKING_STATUS.TENTATIVE,
        hold_expires_at: '2026-12-01T00:00:00Z',
        setup_minutes: 30,
        teardown_minutes: 30,
      }),
    ]);

    const result = await venuesService.identifyAndMarkAffectedBookings(7, period(), NOW);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TENTATIVE_HOLD');
    expect(updateById).toHaveBeenCalledWith('venue_bookings', 100, expect.objectContaining({
      needs_review: true,
    }));
  });

  /*
   * AC:       SCRUM-60 (AC5: bookings at other venues are not identified, including another
   *           venue booking of the same multi-venue event)
   * Scenario: The same event has one booking at venue 7 (the one becoming unavailable) and
   *           one at venue 9, both overlapping the period's dates.
   * Setup:    Two bookings, same event_id, different venue_id. The query result is filtered
   *           for the recorded period's venue (7).
   * Expected: Only the venue-7 booking is identified.
   * Type:     boundary
   */
  // SCRUM-60-TC06
  it('US60-B06: another venue booking of the same multi-venue event is not identified', async () => {
    fetchMany.mockResolvedValueOnce([
      booking({ id: 100, venue_id: 7 }),
      booking({ id: 200, venue_id: 9 }),
    ]);

    const result = await venuesService.identifyAndMarkAffectedBookings(7, period(), NOW);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(100);
  });

  /*
   * AC:       SCRUM-60 (AC6: a booking already in the past is not identified)
   * Scenario: A booking's end time is already before "now".
   * Setup:    Booking ends 2020-01-02; now is 2026-11-01.
   * Expected: Not identified; updateById is never called.
   * Type:     boundary
   */
  // SCRUM-60-TC07
  it('US60-B07: a booking already in the past is not identified', async () => {
    fetchMany.mockResolvedValueOnce([
      booking({ start_at: '2020-01-01T10:00:00Z', end_at: '2020-01-02T10:00:00Z' }),
    ]);

    const result = await venuesService.identifyAndMarkAffectedBookings(
      7,
      period({ start_at: '2020-01-01T00:00:00Z', end_at: '2020-01-03T00:00:00Z' }),
      NOW
    );

    expect(result).toHaveLength(0);
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-60 (AC9: the booking's status, venue, date and time are unchanged --
   *           only needs_review is written)
   * Scenario: An overlapping booking is identified and marked.
   * Setup:    A normal overlapping APPROVED booking.
   * Expected: updateById's patch contains only needs_review and updated_at -- no status,
   *           venue_id, start_at or end_at.
   * Type:     normal
   */
  // SCRUM-60-TC08
  it('US60-B08: marking writes only needs_review, nothing else on the booking', async () => {
    fetchMany.mockResolvedValueOnce([booking()]);

    await venuesService.identifyAndMarkAffectedBookings(7, period(), NOW);

    const patch = updateById.mock.calls[0][2];
    expect(Object.keys(patch).sort()).toEqual(['needs_review', 'updated_at']);
  });

  /*
   * AC:       SCRUM-60 (not tied to a single AC -- idempotency: re-identifying an
   *           already-marked booking does not write again, but still returns it)
   * Scenario: A booking is already needs_review: true from an earlier overlapping period.
   * Setup:    booking({ needs_review: true }), overlapping the new period too.
   * Expected: The booking is still returned; updateById is not called again.
   * Type:     boundary
   */
  // SCRUM-60-TC09
  it('US60-B09: an already-marked booking is returned again without re-writing it', async () => {
    fetchMany.mockResolvedValueOnce([booking({ needs_review: true })]);

    const result = await venuesService.identifyAndMarkAffectedBookings(7, period(), NOW);

    expect(result).toHaveLength(1);
    expect(updateById).not.toHaveBeenCalled();
  });
});

describe('SCRUM-60 blockVenue triggers identification (AC1)', () => {
  /*
   * AC:       SCRUM-60 (AC1: identification runs when the period is recorded)
   * Scenario: Venue Staff records a period; an existing booking at that venue overlaps it.
   * Setup:    insertOne returns the saved period; fetchMany returns one overlapping booking.
   * Expected: blockVenue's result includes affectedBookings with that booking, and the
   *           booking is marked needs_review.
   * Type:     normal
   */
  // SCRUM-60-TC10
  it('US60-B10: recording a period identifies and marks the bookings it affects', async () => {
    fetchMany.mockResolvedValueOnce([booking()]);

    const result = await venuesService.blockVenue(venueStaff, {
      venueId: 7,
      startAt: '2026-11-10T09:00:00Z',
      endAt: '2026-11-10T17:00:00Z',
      reason: 'Maintenance',
    });

    expect(result.affectedBookings).toHaveLength(1);
    expect(result.affectedBookings[0].id).toBe(100);
    expect(updateById).toHaveBeenCalledWith('venue_bookings', 100, expect.objectContaining({
      needs_review: true,
    }));
  });

  /*
   * AC:       SCRUM-60 (AC9: the event's status and the booking's venue, date and time are
   *           unchanged, and the event is not cancelled)
   * Scenario: Recording a period that affects a booking never touches the events table.
   * Setup:    A normal overlapping booking.
   * Expected: updateById is never called with 'events' as the table.
   * Type:     normal
   */
  // SCRUM-60-TC11
  it('US60-B11: recording a period never updates the event row', async () => {
    fetchMany.mockResolvedValueOnce([booking()]);

    await venuesService.blockVenue(venueStaff, {
      venueId: 7,
      startAt: '2026-11-10T09:00:00Z',
      endAt: '2026-11-10T17:00:00Z',
      reason: 'Maintenance',
    });

    expect(updateById).not.toHaveBeenCalledWith('events', expect.anything(), expect.anything());
  });
});

describe('SCRUM-60 view bookings affected by a period (AC8, service rules)', () => {
  /*
   * AC:       SCRUM-60 (AC8: the Venue Staff member can view the identified bookings, with
   *           event, venue, date and time)
   * Scenario: Venue Staff looks up a recorded period's affected bookings.
   * Setup:    fetchOne returns the period; fetchMany returns one overlapping booking.
   * Expected: The booking's event, venue, date and time are returned.
   * Type:     normal
   */
  // SCRUM-60-TC12
  it('US60-B12: Venue Staff can view the bookings a period affects', async () => {
    fetchOne.mockResolvedValueOnce(period());
    fetchMany.mockResolvedValueOnce([booking()]);

    const result = await venuesService.listBookingsAffectedByUnavailability(venueStaff, 60, NOW);

    expect(result).toEqual([{
      id: 100,
      eventId: 30,
      eventName: 'Tech Symposium',
      venueId: 7,
      type: 'BOOKING',
      status: BOOKING_STATUS.APPROVED,
      startAt: '2026-11-10T10:00:00.000Z',
      endAt: '2026-11-10T12:00:00.000Z',
    }]);
  });

  /*
   * AC:       SCRUM-60 (AC8: a non-Venue-Staff user cannot view the list)
   * Scenario: An Organiser tries to view a period's affected bookings.
   * Setup:    Caller holds only the EVENT_ORGANISER role.
   * Expected: Rejected with 403; fetchOne/fetchMany are never called.
   * Type:     error
   */
  // SCRUM-60-TC13
  it('US60-B13: a non-Venue-Staff user cannot view affected bookings', async () => {
    await expect(venuesService.listBookingsAffectedByUnavailability(organiser, 60, NOW))
      .rejects.toMatchObject({ status: 403 });
    expect(fetchOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-60 (not tied to a numbered AC -- general 404 guard)
   * Scenario: Venue Staff looks up a period that does not exist.
   * Setup:    fetchOne resolves null.
   * Expected: Rejected with 404.
   * Type:     error
   */
  // SCRUM-60-TC14
  it('US60-B14: viewing a period that does not exist is 404', async () => {
    fetchOne.mockResolvedValueOnce(null);
    await expect(venuesService.listBookingsAffectedByUnavailability(venueStaff, 999, NOW))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('SCRUM-60 affected-bookings route', () => {
  const { createApp } = require('../src/app');
  const app = createApp();

  function cookieFor(userId) {
    const token = jwt.sign({ sub: userId }, env.jwtSecret);
    return `${env.sessionCookieName}=${token}`;
  }

  /*
   * AC:       SCRUM-60 (AC8: works through the real HTTP route)
   * Scenario: Venue Staff views affected bookings through the real route.
   * Setup:    Venue Staff is signed in; the period and an overlapping booking exist.
   * Expected: 200 with the affected booking in the body.
   * Type:     normal
   */
  // SCRUM-60-TC15
  it('US60-R01: Venue Staff can view affected bookings through the API', async () => {
    fetchOne.mockResolvedValueOnce({ id: 5, is_active: true }); // auth: the signed-in user
    fetchMany.mockResolvedValueOnce([{ role: ROLES.VENUE_STAFF }]); // auth: their roles
    fetchOne.mockResolvedValueOnce(period()); // service: the period
    fetchMany.mockResolvedValueOnce([booking()]); // service: overlapping bookings

    const res = await request(app)
      .get('/api/venues/unavailability/60/affected-bookings')
      .set('Cookie', cookieFor(5));

    expect(res.status).toBe(200);
    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0]).toMatchObject({ id: 100, eventName: 'Tech Symposium' });
  });

  /*
   * AC:       SCRUM-60 (AC8: non-Venue-Staff rejected -- route level)
   * Scenario: An Organiser hits the real route.
   * Setup:    Signed in as an Organiser, not Venue Staff.
   * Expected: 403, through the real role middleware.
   * Type:     error
   */
  // SCRUM-60-TC16
  it('US60-R02: a non-Venue-Staff user gets 403 through the API', async () => {
    fetchOne.mockResolvedValueOnce({ id: 1, is_active: true });
    fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_ORGANISER }]);

    const res = await request(app)
      .get('/api/venues/unavailability/60/affected-bookings')
      .set('Cookie', cookieFor(1));

    expect(res.status).toBe(403);
  });

  /*
   * AC:       SCRUM-60 (the route requires authentication)
   * Scenario: An unauthenticated request hits the real route.
   * Setup:    No session cookie is sent.
   * Expected: 401, before the service or database is reached.
   * Type:     error
   */
  // SCRUM-60-TC17
  it('US60-R03: the route needs a signed-in user', async () => {
    const res = await request(app).get('/api/venues/unavailability/60/affected-bookings');
    expect(res.status).toBe(401);
  });
});

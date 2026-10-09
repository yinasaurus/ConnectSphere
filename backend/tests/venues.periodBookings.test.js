/**
 * SCRUM-67: Show existing bookings for a venue and period.
 *
 *   AC1  Each confirmed booking in the period is returned with its full occupied window
 *        (start - setup, end + turnaround).
 *   AC2  Each active tentative hold is returned and identifiable as a hold (type field).
 *   AC3  An expired tentative hold is not returned.
 *   AC4  For an event booked at several venues, each booking appears once, under its venue only.
 *   AC5  Access: Event Coordinators, Venue Staff and the Event Coordinator Lead only.
 *
 * Decisions agreed before building: a booking is "in the period" when its occupied window
 * overlaps it; holds keep their held period (no padding); expired holds are left out
 * entirely; PENDING requests are not returned.
 *
 * The database is mocked. In the service tests, fetchOne returns the venue and fetchMany
 * returns the booking rows. In the route tests, the first fetchOne/fetchMany calls are
 * the real auth middleware loading the user and their roles.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  updateById: jest.fn(),
}));

const { supabase, fetchOne, fetchMany } = require('../src/config/db');
const venuesService = require('../src/services/venues.service');
const { createApp } = require('../src/app');

const NOW = new Date('2026-10-15T00:00:00Z');
const PERIOD = { from: '2026-10-20T08:00:00Z', to: '2026-10-20T14:00:00Z' };
const VENUE = { id: 7, name: 'Helix Hall' };

function row(overrides) {
  return {
    id: 1,
    event_id: 50,
    venue_id: 7,
    status: 'APPROVED',
    start_at: '2026-10-20T10:00:00Z',
    end_at: '2026-10-20T12:00:00Z',
    setup_minutes: 30,
    teardown_minutes: 45,
    hold_expires_at: null,
    events: { name: 'Leadership Forum' },
    ...overrides,
  };
}

function mockRows(rows = []) {
  fetchOne.mockResolvedValue(VENUE);
  fetchMany.mockResolvedValueOnce(rows);
}

let chain;
beforeEach(() => {
  jest.clearAllMocks();
  fetchOne.mockReset();
  fetchMany.mockReset();
  chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  };
  supabase.from.mockReturnValue(chain);
});

describe('SCRUM-67 listVenueBookingsForPeriod (service)', () => {
  /*
   * AC:       SCRUM-67 AC1
   * Scenario: The Week 7 example. A confirmed booking 10:00-12:00 with 30 min setup and
   *           45 min turnaround, inside an 08:00-14:00 period.
   * Setup:    One APPROVED row (APPROVED = confirmed by venue staff), 30/45 minutes.
   * Expected: Returned once, with occupied window 09:30-12:45, the original booked times,
   *           and type BOOKING, so the user sees everything the venue has committed.
   * Type:     normal
   */
  it('US67-B01 (AC1): a confirmed booking is returned with its full occupied window', async () => {
    mockRows([row()]);
    const result = await venuesService.listVenueBookingsForPeriod(7, PERIOD, NOW);
    expect(result).toEqual({
      venue: VENUE,
      from: '2026-10-20T08:00:00.000Z',
      to: '2026-10-20T14:00:00.000Z',
      bookings: [{
        id: 1,
        eventId: 50,
        eventName: 'Leadership Forum',
        type: 'BOOKING',
        status: 'APPROVED',
        startAt: '2026-10-20T10:00:00.000Z',
        endAt: '2026-10-20T12:00:00.000Z',
        setupMinutes: 30,
        teardownMinutes: 45,
        occupiedStartAt: '2026-10-20T09:30:00.000Z',
        occupiedEndAt: '2026-10-20T12:45:00.000Z',
        holdExpiresAt: null,
      }],
    });
  });

  /*
   * AC:       SCRUM-67 AC1
   * Scenario: A confirmed booking ends before the period, but its turnaround runs into it.
   * Setup:    Booking 06:00-07:30 with 45 min turnaround, so occupied until 08:15. The
   *           period starts at 08:00.
   * Expected: Returned, because the venue really is committed until 08:15. Checking only
   *           the advertised times would hide it.
   * Type:     boundary
   */
  it('US67-B02 (AC1): a booking is included when only its turnaround overlaps the period', async () => {
    mockRows([row({ start_at: '2026-10-20T06:00:00Z', end_at: '2026-10-20T07:30:00Z' })]);
    const result = await venuesService.listVenueBookingsForPeriod(7, PERIOD, NOW);
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0].occupiedEndAt).toBe('2026-10-20T08:15:00.000Z');
  });

  /*
   * AC:       SCRUM-67 AC1
   * Scenario: Confirmed bookings that are not in the period.
   * Setup:    (a) occupied window ends exactly at 08:00, the period start: booking
   *           06:00-07:15 with 45 min turnaround. (b) a booking the next day.
   * Expected: Neither is returned. A window that only touches the period edge doesn't
   *           occupy any of it, and (b) is entirely outside.
   * Type:     boundary (a), normal (b)
   */
  it.each([
    ['ends exactly at the period start', { start_at: '2026-10-20T06:00:00Z', end_at: '2026-10-20T07:15:00Z' }],
    ['is on another day', { start_at: '2026-10-21T10:00:00Z', end_at: '2026-10-21T12:00:00Z' }],
  ])('US67-B03 (AC1): a booking whose occupied window %s is not returned', async (_label, times) => {
    mockRows([row(times)]);
    const result = await venuesService.listVenueBookingsForPeriod(7, PERIOD, NOW);
    expect(result.bookings).toEqual([]);
  });

  /*
   * AC:       SCRUM-67 AC2
   * Scenario: A tentative hold that hasn't expired.
   * Setup:    TENTATIVE row 10:00-12:00 expiring 2026-10-16, with "now" on 2026-10-15. The
   *           row still carries 30/45 setup/turnaround values, to show they are ignored.
   * Expected: Returned with type TENTATIVE_HOLD (distinguishable from a confirmed booking,
   *           per AC2), its held period as the occupied window, no setup/turnaround, and
   *           its expiry.
   * Type:     normal
   */
  it('US67-B04 (AC2): an active hold is returned and marked as a hold', async () => {
    mockRows([row({ status: 'TENTATIVE', hold_expires_at: '2026-10-16T00:00:00Z' })]);
    const result = await venuesService.listVenueBookingsForPeriod(7, PERIOD, NOW);
    expect(result.bookings).toEqual([expect.objectContaining({
      type: 'TENTATIVE_HOLD',
      status: 'TENTATIVE',
      // Same as the held times: holds are not padded (agreed decision).
      occupiedStartAt: '2026-10-20T10:00:00.000Z',
      occupiedEndAt: '2026-10-20T12:00:00.000Z',
      setupMinutes: null,
      teardownMinutes: null,
      holdExpiresAt: '2026-10-16T00:00:00Z',
    })]);
  });

  /*
   * AC:       SCRUM-67 AC2
   * Scenario: A hold just outside the period, which padding would have pulled in.
   * Setup:    TENTATIVE row 06:00-07:30 with 45 min turnaround. Padded it would reach
   *           08:15; unpadded it ends at 07:30, before the 08:00 period start.
   * Expected: Not returned. This proves holds use only their held period.
   * Type:     boundary
   */
  it('US67-B05 (AC2): a hold is matched on its held period, not a padded window', async () => {
    mockRows([row({ status: 'TENTATIVE', start_at: '2026-10-20T06:00:00Z', end_at: '2026-10-20T07:30:00Z' })]);
    const result = await venuesService.listVenueBookingsForPeriod(7, PERIOD, NOW);
    expect(result.bookings).toEqual([]);
  });

  /*
   * AC:       SCRUM-67 AC2 (same assumption as SCRUM-66)
   * Scenario: A hold with no expiry recorded.
   * Setup:    TENTATIVE row with hold_expires_at null. Holds can't be created with an expiry
   *           yet (SCRUM-75).
   * Expected: Returned as an active hold, with holdExpiresAt null, so an undated hold never
   *           silently disappears.
   * Type:     boundary
   */
  it('US67-B06 (AC2): a hold with no expiry is treated as active', async () => {
    mockRows([row({ status: 'TENTATIVE', hold_expires_at: null })]);
    const result = await venuesService.listVenueBookingsForPeriod(7, PERIOD, NOW);
    expect(result.bookings).toEqual([expect.objectContaining({ type: 'TENTATIVE_HOLD', holdExpiresAt: null })]);
  });

  /*
   * AC:       SCRUM-67 AC3
   * Scenario: A hold whose expiry has passed, or is exactly now.
   * Setup:    TENTATIVE row in the period, expiring (a) the day before "now" and (b)
   *           exactly "now".
   * Expected: Not returned. An expired hold no longer reserves the venue, so it must not be
   *           presented as something already committed.
   * Type:     normal (a), boundary (b)
   */
  it.each([
    ['expired the day before', '2026-10-14T00:00:00Z'],
    ['expiring exactly now', NOW.toISOString()],
  ])('US67-B07 (AC3): a hold %s is not returned', async (_label, expiresAt) => {
    mockRows([row({ status: 'TENTATIVE', hold_expires_at: expiresAt })]);
    const result = await venuesService.listVenueBookingsForPeriod(7, PERIOD, NOW);
    expect(result.bookings).toEqual([]);
  });

  /*
   * AC:       SCRUM-67 AC3
   * Scenario: Production use, where the route passes no fixed time.
   * Setup:    A hold that expired in 2000; no third argument, so the real clock is used.
   * Expected: Not returned. This proves expiry is judged against the actual current time.
   * Type:     normal
   */
  it('US67-B08 (AC3): by default a hold is judged expired against the current time', async () => {
    mockRows([row({ status: 'TENTATIVE', hold_expires_at: '2000-01-01T00:00:00Z' })]);
    const result = await venuesService.listVenueBookingsForPeriod(7, PERIOD);
    expect(result.bookings).toEqual([]);
  });

  /*
   * AC:       SCRUM-67 AC4
   * Scenario: One event (id 50) is booked at Helix Hall (venue 7) and at a breakout room
   *           (venue 8) at the same time (Week 7 change #3).
   * Setup:    The query returns both rows, as if the DB filter had failed, plus an
   *           unrelated booking at venue 7.
   * Expected: Viewing venue 7 returns its own two bookings, each exactly once. The venue 8
   *           booking for the same event is never listed under venue 7.
   * Type:     conflict
   */
  it('US67-B09 (AC4): an event booked at several venues appears once, under this venue only', async () => {
    mockRows([
      row({ id: 1, event_id: 50, venue_id: 7 }),
      row({ id: 2, event_id: 50, venue_id: 8 }),
      row({ id: 3, event_id: 60, venue_id: 7, start_at: '2026-10-20T13:00:00Z', end_at: '2026-10-20T13:30:00Z', events: { name: 'Board meeting' } }),
    ]);
    const result = await venuesService.listVenueBookingsForPeriod(7, PERIOD, NOW);
    expect(result.bookings.map((b) => b.id)).toEqual([1, 3]);
    // The database is also asked for this venue only.
    expect(chain.eq).toHaveBeenCalledWith('venue_id', 7);
  });

  /*
   * AC:       SCRUM-67 AC4
   * Scenario: The venue id comes from the URL as a string ("7") while the DB returns a number.
   * Setup:    venueId "7" (as the controller passes it), row venue_id 7.
   * Expected: The booking is still returned. Comparing string and number directly would
   *           wrongly hide every booking.
   * Type:     boundary
   */
  it('US67-B10 (AC4): a string venue id from the URL still matches the venue', async () => {
    mockRows([row()]);
    const result = await venuesService.listVenueBookingsForPeriod('7', PERIOD, NOW);
    expect(result.bookings).toHaveLength(1);
  });

  /*
   * AC:       SCRUM-67 AC1 + AC2 (agreed decision: PENDING not returned)
   * Scenario: Which booking statuses are fetched at all.
   * Setup:    No rows; this checks the query the service builds.
   * Expected: Only APPROVED and TENTATIVE rows are requested. PENDING, REJECTED and
   *           CANCELLED are not committed bookings.
   * Type:     normal
   */
  it('US67-B11: only confirmed bookings and tentative holds are queried', async () => {
    mockRows([]);
    await venuesService.listVenueBookingsForPeriod(7, PERIOD, NOW);
    expect(chain.in).toHaveBeenCalledWith('status', ['APPROVED', 'TENTATIVE']);
  });

  /*
   * AC:       SCRUM-67 AC1 + AC2 (agreed decision: PENDING not returned)
   * Scenario: A PENDING request reaches the service anyway.
   * Setup:    One PENDING row in the period returned by the mocked query.
   * Expected: Not returned as a confirmed booking. Without the status check it would be
   *           treated like an APPROVED row and padded.
   * Type:     error
   */
  it('US67-B12: a PENDING row is not returned even if the query lets it through', async () => {
    mockRows([row({ status: 'PENDING' })]);
    const result = await venuesService.listVenueBookingsForPeriod(7, PERIOD, NOW);
    expect(result.bookings.map((b) => b.type)).toEqual([]);
  });

  /*
   * AC:       SCRUM-67 AC1 + AC2
   * Scenario: A confirmed booking and an active hold in the same period, out of order.
   * Setup:    The DB returns the 13:00 hold first and the 10:00 booking second.
   * Expected: Both returned, sorted by when the venue becomes occupied (booking from 09:30,
   *           then the hold from 13:00), each with its own type.
   * Type:     normal
   */
  it('US67-B13 (AC1+AC2): bookings and holds come back together, sorted by occupied start', async () => {
    mockRows([
      row({ id: 2, status: 'TENTATIVE', start_at: '2026-10-20T13:00:00Z', end_at: '2026-10-20T13:30:00Z' }),
      row({ id: 1 }),
    ]);
    const result = await venuesService.listVenueBookingsForPeriod(7, PERIOD, NOW);
    expect(result.bookings.map((b) => [b.id, b.type])).toEqual([[1, 'BOOKING'], [2, 'TENTATIVE_HOLD']]);
  });

  /*
   * AC:       SCRUM-67 AC1
   * Scenario: A booking whose event can't be joined (events is null).
   * Setup:    APPROVED row with events: null.
   * Expected: Still returned, with eventName null. A missing name must not hide a
   *           committed booking.
   * Type:     error
   */
  it('US67-B14 (AC1): a booking with no linked event name is still returned', async () => {
    mockRows([row({ events: null })]);
    const result = await venuesService.listVenueBookingsForPeriod(7, PERIOD, NOW);
    expect(result.bookings).toEqual([expect.objectContaining({ id: 1, eventName: null })]);
  });

  /*
   * AC:       SCRUM-67 (input validation; every AC is "for a given period")
   * Scenario: The period is missing, unreadable, empty or backwards.
   * Setup:    Six bad inputs: no from, no to, a non-date, from == to, from after to, and no
   *           range argument at all.
   * Expected: 400 with a message saying what is wrong, and no database call.
   * Type:     error (from == to is a boundary)
   */
  it.each([
    ['from is missing', { to: PERIOD.to }, 'from and to are required'],
    ['to is missing', { from: PERIOD.from }, 'from and to are required'],
    ['a date is invalid', { from: 'not-a-date', to: PERIOD.to }, 'from and to must be valid dates'],
    ['from equals to', { from: PERIOD.from, to: PERIOD.from }, 'from must be before to'],
    ['from is after to', { from: PERIOD.to, to: PERIOD.from }, 'from must be before to'],
    ['no range is passed', undefined, 'from and to are required'],
  ])('US67-B15: returns 400 when %s', async (_label, range, message) => {
    await expect(venuesService.listVenueBookingsForPeriod(7, range, NOW)).rejects.toMatchObject({ status: 400, message });
    // Validation happens before any lookup, so a bad request never reaches the DB.
    expect(fetchOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-67 (error handling; "a venue's existing bookings")
   * Scenario: The venue doesn't exist.
   * Setup:    The venue lookup returns null; the period is valid.
   * Expected: 404 "Venue not found", and the bookings query is never run.
   * Type:     error
   */
  it('US67-B16: returns 404 for an unknown venue', async () => {
    fetchOne.mockResolvedValue(null);
    await expect(venuesService.listVenueBookingsForPeriod(99, PERIOD, NOW)).rejects.toMatchObject({ status: 404 });
    expect(fetchMany).not.toHaveBeenCalled();
  });
});

describe('SCRUM-67 GET /api/venues/:id/bookings (route, real session cookie)', () => {
  const app = createApp();
  const token = jwt.sign({ sub: 5 }, env.jwtSecret);
  const url = `/api/venues/7/bookings?from=${PERIOD.from}&to=${PERIOD.to}`;

  // Real auth middleware: the first fetchOne loads user 5 and the first fetchMany loads
  // their roles, so access depends on roles in the database, not on the token.
  function asRoles(roles) {
    fetchOne.mockResolvedValueOnce({ id: 5, is_active: true });
    fetchMany.mockResolvedValueOnce(roles.map((role) => ({ role })));
    return request(app).get(url).set('Cookie', `${env.sessionCookieName}=${token}`);
  }

  /*
   * AC:       SCRUM-67 AC5 (integration: auth middleware -> role check -> service -> response)
   * Scenario: Each permitted role asks for Helix Hall's bookings through the real HTTP route.
   * Setup:    A real signed cookie; roles from the mocked user_roles query. The service is
   *           not stubbed, so the venue lookup and booking query run on the mocked DB.
   * Expected: 200 with the confirmed booking and its occupied window. The Event Coordinator
   *           Lead is included, as AC5 names it.
   * Type:     normal
   */
  it.each([ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF, ROLES.EVENT_COORDINATOR_LEAD])(
    'US67-R01 (AC5): %s gets the venue bookings',
    async (role) => {
      const pending = asRoles([role]);
      fetchOne.mockResolvedValueOnce(VENUE);
      fetchMany.mockResolvedValueOnce([row()]);
      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body.bookings).toEqual([expect.objectContaining({
        id: 1, type: 'BOOKING', occupiedStartAt: '2026-10-20T09:30:00.000Z', occupiedEndAt: '2026-10-20T12:45:00.000Z',
      })]);
    }
  );

  /*
   * AC:       SCRUM-67 AC5
   * Scenario: A role AC5 doesn't name calls the endpoint.
   * Setup:    A real cookie for a user whose only role is Technical Support, Event Organiser,
   *           Attendee, or an unknown value.
   * Expected: 403, and no venue or booking lookup happens. Technical Support is refused
   *           because AC5 only names Coordinators, Venue Staff and the Lead (unlike SCRUM-66).
   * Type:     error
   */
  it.each([ROLES.TECHNICAL_SUPPORT, ROLES.EVENT_ORGANISER, ROLES.ATTENDEE, 'UNKNOWN'])(
    'US67-R02 (AC5): %s is refused with 403',
    async (role) => {
      const res = await asRoles([role]);
      expect(res.status).toBe(403);
      // Only the auth middleware's user lookup ran; the venue was never looked up.
      expect(fetchOne).toHaveBeenCalledTimes(1);
    }
  );

  /*
   * AC:       SCRUM-67 AC5
   * Scenario: A user holding a refused role and a permitted one (multiple roles allowed, W4).
   * Setup:    Roles [EVENT_ORGANISER, VENUE_STAFF].
   * Expected: Allowed, because one permitted role is enough.
   * Type:     boundary
   */
  it('US67-R03 (AC5): a hybrid user with one permitted role is allowed', async () => {
    const pending = asRoles([ROLES.EVENT_ORGANISER, ROLES.VENUE_STAFF]);
    fetchOne.mockResolvedValueOnce(VENUE);
    fetchMany.mockResolvedValueOnce([]);
    expect((await pending).status).toBe(200);
  });

  /*
   * AC:       SCRUM-67 AC5
   * Scenario: Nobody is signed in.
   * Setup:    No session cookie.
   * Expected: 401, before any database query.
   * Type:     error
   */
  it('US67-R04 (AC5): a request without a session is rejected with 401', async () => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
    expect(fetchOne).not.toHaveBeenCalled();
  });
});

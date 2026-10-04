/**
 * SCRUM-66: View venue availability calendar.
 *
 *   AC1  Confirmed booking blocks start - setup to end + turnaround (10:00-12:00, 30/45 -> 09:30-12:45).
 *   AC2  Active tentative hold blocks its held period.
 *   AC3  Expired tentative hold is not marked unavailable.
 *   AC4  Recorded unavailability (e.g. maintenance) blocks its dates/times.
 *   AC5  Everything else in the range is available.
 *   AC6  Event Organisers and Attendees cannot access the view.
 *
 * The database is mocked: fetchOne returns the venue, the first fetchMany returns
 * bookings/holds and the second returns unavailability periods.
 */
const request = require('supertest');
const { ROLES } = require('../src/constants/roles');

let mockRoles = [];

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  updateById: jest.fn(),
}));

jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    requireAuth: (req, _res, next) => {
      req.user = { id: 999, isActive: true, roles: mockRoles, role: mockRoles[0] || null };
      next();
    },
  };
});

const { supabase, fetchOne, fetchMany } = require('../src/config/db');
const venuesService = require('../src/services/venues.service');
const { createApp } = require('../src/app');

const NOW = new Date('2026-10-15T00:00:00Z');
const RANGE = { from: '2026-10-20T08:00:00Z', to: '2026-10-20T14:00:00Z' };

function booking(overrides) {
  return {
    id: 1,
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

function mockData({ bookings = [], unavailability = [] } = {}) {
  fetchOne.mockResolvedValue({ id: 7, name: 'Helix Hall' });
  fetchMany.mockResolvedValueOnce(bookings).mockResolvedValueOnce(unavailability);
}

// Compact view of the timeline: [start HH:MM, end HH:MM, available, reason types].
function summary(result) {
  return result.periods.map((p) => [
    p.startAt.slice(11, 16),
    p.endAt.slice(11, 16),
    p.available,
    p.reasons.map((r) => r.type),
  ]);
}

let chain;
beforeEach(() => {
  jest.clearAllMocks();
  mockRoles = [];
  chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
  };
  supabase.from.mockReturnValue(chain);
});

describe('SCRUM-66 getVenueAvailability (service)', () => {
  /*
   * AC:       SCRUM-66 AC1
   * Scenario: The AC's own example. A confirmed booking 10:00-12:00 with 30 min setup and
   *           45 min turnaround, viewed over 08:00-14:00.
   * Setup:    One APPROVED booking (APPROVED = venue staff confirmed it) with
   *           setup_minutes 30 and teardown_minutes 45. The range is wider than the booking
   *           on both sides so the padding is visible.
   * Expected: 09:30-12:45 is unavailable (start - setup to end + turnaround); 08:00-09:30
   *           and 12:45-14:00 stay available (AC5).
   * Type:     normal
   */
  it('US66-B01 (AC1): a confirmed 10:00-12:00 booking with 30/45 min marks 09:30-12:45 unavailable', async () => {
    mockData({ bookings: [booking()] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([
      ['08:00', '09:30', true, []],
      ['09:30', '12:45', false, ['BOOKING']],
      ['12:45', '14:00', true, []],
    ]);
    // The blocked period names the booking, so the user can see what occupies it.
    expect(result.periods[1].reasons[0]).toMatchObject({ id: 1, label: 'Leadership Forum' });
  });

  /*
   * AC:       SCRUM-66 AC1
   * Scenario: A confirmed booking ends before the range starts, but its turnaround time
   *           runs into the range.
   * Setup:    Booking 06:00-07:30 with 45 min turnaround, so it is occupied until 08:15.
   *           The range starts at 08:00, so only the padding overlaps.
   * Expected: 08:00-08:15 is unavailable, because AC1 counts turnaround as occupied. If
   *           only the advertised times were checked, the whole range would look free.
   * Type:     boundary
   */
  it('US66-B02 (AC1): setup/turnaround padding alone can reach into the range', async () => {
    // Booking ends 07:30, +45 min turnaround -> occupied until 08:15.
    mockData({ bookings: [booking({ start_at: '2026-10-20T06:00:00Z', end_at: '2026-10-20T07:30:00Z' })] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([
      ['08:00', '08:15', false, ['BOOKING']],
      ['08:15', '14:00', true, []],
    ]);
  });

  /*
   * AC:       SCRUM-66 AC2
   * Scenario: A tentative hold that hasn't expired yet.
   * Setup:    TENTATIVE row 10:00-12:00, expiring 2026-10-16, while "now" is 2026-10-15.
   *           The row still has 30/45 setup/turnaround values, to show they are ignored.
   * Expected: Exactly 10:00-12:00 ("its held period") is unavailable, with no setup or
   *           turnaround padding, because AC2 only names the held period.
   * Type:     normal
   */
  it('US66-B03 (AC2): an active tentative hold marks exactly its held period unavailable', async () => {
    mockData({ bookings: [booking({ status: 'TENTATIVE', hold_expires_at: '2026-10-16T00:00:00Z' })] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([
      ['08:00', '10:00', true, []],
      ['10:00', '12:00', false, ['TENTATIVE_HOLD']],
      ['12:00', '14:00', true, []],
    ]);
    // The expiry is passed through so the page can show when the hold lapses.
    expect(result.periods[1].reasons[0].expiresAt).toBe('2026-10-16T00:00:00Z');
  });

  /*
   * AC:       SCRUM-66 AC2 (team assumption, not stated in the AC)
   * Scenario: A tentative hold with no expiry recorded (hold_expires_at is null).
   * Setup:    TENTATIVE row 10:00-12:00, hold_expires_at null. Holds can't be created with
   *           an expiry yet (SCRUM-75), so older rows have none.
   * Expected: Treated as active and marked unavailable, so a hold without a date never
   *           silently frees the venue. This rule is still waiting on a team decision.
   * Type:     boundary
   */
  it('US66-B04 (AC2): a tentative hold with no expiry recorded is treated as active', async () => {
    mockData({ bookings: [booking({ status: 'TENTATIVE', hold_expires_at: null })] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)[1]).toEqual(['10:00', '12:00', false, ['TENTATIVE_HOLD']]);
  });

  /*
   * AC:       SCRUM-66 AC3
   * Scenario: A tentative hold whose expiry has passed, or is exactly now.
   * Setup:    TENTATIVE row 10:00-12:00 with an expiry of (a) a day before "now" and (b)
   *           exactly "now", which is the edge between active and expired.
   * Expected: Not marked unavailable. The whole range is one available period, because an
   *           expired hold must not reserve the venue (Week 7 change #4).
   * Type:     normal (a), boundary (b)
   */
  it.each([
    ['expired yesterday', '2026-10-14T00:00:00Z'],
    ['expiring exactly now (boundary)', NOW.toISOString()],
  ])('US66-B05 (AC3): a hold %s is not marked unavailable', async (_label, expiresAt) => {
    mockData({ bookings: [booking({ status: 'TENTATIVE', hold_expires_at: expiresAt })] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([['08:00', '14:00', true, []]]);
  });

  /*
   * AC:       SCRUM-66 AC4
   * Scenario: A maintenance block starts inside the range and ends the next day.
   * Setup:    venue_unavailability row 13:00 on the 20th to 09:00 on the 21st, reason
   *           "Lighting rig maintenance" (like the seeded Studio 3 outage).
   * Expected: 13:00-14:00 is unavailable inside the range. The reason still reports the
   *           block's full recorded times, so staff can see when it really ends.
   * Type:     normal
   */
  it('US66-B06 (AC4): a maintenance period is marked unavailable for its recorded times', async () => {
    mockData({
      unavailability: [{ id: 4, reason: 'Lighting rig maintenance', start_at: '2026-10-20T13:00:00Z', end_at: '2026-10-21T09:00:00Z' }],
    });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([
      ['08:00', '13:00', true, []],
      ['13:00', '14:00', false, ['UNAVAILABILITY']],
    ]);
    // endAt is the next day, not 14:00: the timeline is clipped to the range but the reason isn't.
    expect(result.periods[1].reasons[0]).toMatchObject({
      label: 'Lighting rig maintenance',
      startAt: '2026-10-20T13:00:00.000Z',
      endAt: '2026-10-21T09:00:00.000Z',
    });
  });

  /*
   * AC:       SCRUM-66 AC5
   * Scenario: The venue has no bookings, holds or unavailability.
   * Setup:    Both queries return no rows.
   * Expected: The whole 08:00-14:00 range comes back as one available period with no
   *           reasons. Also pins the full response shape the frontend relies on.
   * Type:     normal
   */
  it('US66-B07 (AC5): with nothing recorded the whole range is one available period', async () => {
    mockData();
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(result).toEqual({
      venue: { id: 7, name: 'Helix Hall' },
      from: '2026-10-20T08:00:00.000Z',
      to: '2026-10-20T14:00:00.000Z',
      periods: [{ startAt: '2026-10-20T08:00:00.000Z', endAt: '2026-10-20T14:00:00.000Z', available: true, reasons: [] }],
    });
  });

  /*
   * AC:       SCRUM-66 AC1 + AC2 + AC5
   * Scenario: Which booking rows are fetched from the database at all.
   * Setup:    No rows. This checks the query the service builds, not the result.
   * Expected: Only APPROVED (confirmed) and TENTATIVE (hold) rows are requested. PENDING,
   *           REJECTED and CANCELLED requests are not bookings or holds, so per AC5 their
   *           times must stay available.
   * Type:     normal
   */
  it('US66-B08 (AC5): only confirmed bookings and tentative holds are queried as blocking', async () => {
    mockData();
    await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(chain.in).toHaveBeenCalledWith('status', ['APPROVED', 'TENTATIVE']);
  });

  /*
   * AC:       SCRUM-66 AC5
   * Scenario: A PENDING request reaches the service anyway (for example, the DB filter
   *           changes later).
   * Setup:    One PENDING row 10:00-12:00 returned by the mocked query.
   * Expected: Not marked unavailable. The service itself only blocks confirmed bookings
   *           and holds, so it doesn't depend on the query filter in US66-B08.
   * Type:     error
   */
  it('US66-B09 (AC5): a row with another status is not marked even if returned', async () => {
    mockData({ bookings: [booking({ status: 'PENDING' })] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([['08:00', '14:00', true, []]]);
  });

  /*
   * AC:       SCRUM-66 AC1 + AC2 + AC4
   * Scenario: A booking, a hold and a maintenance block overlap or touch, one after another.
   * Setup:    Booking occupying 09:30-12:45, hold 12:30-13:00 (overlaps the booking's
   *           turnaround), maintenance 13:00-13:30 (starts exactly when the hold ends).
   * Expected: One continuous unavailable period 09:30-13:30 that lists all three reasons,
   *           so the user sees a single blocked stretch and everything causing it.
   * Type:     conflict
   */
  it('US66-B10 (AC1+AC2+AC4): overlapping blocks merge into one unavailable period listing every reason', async () => {
    mockData({
      bookings: [
        booking(),
        booking({ id: 2, status: 'TENTATIVE', start_at: '2026-10-20T12:30:00Z', end_at: '2026-10-20T13:00:00Z' }),
      ],
      unavailability: [{ id: 4, reason: 'Deep clean', start_at: '2026-10-20T13:00:00Z', end_at: '2026-10-20T13:30:00Z' }],
    });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([
      ['08:00', '09:30', true, []],
      ['09:30', '13:30', false, ['BOOKING', 'TENTATIVE_HOLD', 'UNAVAILABILITY']],
      ['13:30', '14:00', true, []],
    ]);
  });

  /*
   * AC:       SCRUM-66 AC1 + AC5
   * Scenario: A booking ends exactly when the range starts.
   * Setup:    Booking 06:00-08:00 with setup and turnaround set to 0, so it occupies
   *           exactly up to 08:00, the start of the range.
   * Expected: The range is fully available. Ending at 08:00 doesn't occupy 08:00 itself,
   *           so a booking that only touches the range must not block any of it.
   * Type:     boundary
   */
  it('US66-B11 (AC5): a block that only touches the range edge leaves the range available', async () => {
    // Occupied 06:00-08:00 exactly (no padding); touching windows don't overlap.
    mockData({ bookings: [booking({ start_at: '2026-10-20T06:00:00Z', end_at: '2026-10-20T08:00:00Z', setup_minutes: 0, teardown_minutes: 0 })] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([['08:00', '14:00', true, []]]);
  });

  /*
   * AC:       SCRUM-66 (input validation; supports every AC's "for a date/time range")
   * Scenario: The requested range is missing, unreadable, empty or backwards.
   * Setup:    Five bad ranges: no from, no to, a non-date, from == to, from after to.
   * Expected: 400 with a message saying what is wrong, and no database call. Without a
   *           valid range there is nothing to mark available or unavailable.
   * Type:     error (from == to is a boundary)
   */
  it.each([
    ['from is missing', { to: RANGE.to }, 'from and to are required'],
    ['to is missing', { from: RANGE.from }, 'from and to are required'],
    ['a date is invalid', { from: 'not-a-date', to: RANGE.to }, 'from and to must be valid dates'],
    ['from equals to', { from: RANGE.from, to: RANGE.from }, 'from must be before to'],
    ['from is after to', { from: RANGE.to, to: RANGE.from }, 'from must be before to'],
  ])('US66-B12: returns 400 when %s', async (_label, range, message) => {
    await expect(venuesService.getVenueAvailability(7, range, NOW)).rejects.toMatchObject({ status: 400, message });
    // Validation runs before the venue lookup, so a bad request never touches the DB.
    expect(fetchOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-66 AC1 + AC2
   * Scenario: A booking and a hold with no linked event (events join is null).
   * Setup:    APPROVED row and TENTATIVE row, both with events: null.
   * Expected: Both are still marked unavailable, labelled "Confirmed booking" and
   *           "Tentative hold". A missing name must not hide the block or leave it unlabelled.
   * Type:     error
   */
  it('US66-B14: blocks without a linked event name fall back to a generic label', async () => {
    mockData({
      bookings: [
        booking({ events: null }),
        booking({ id: 2, status: 'TENTATIVE', start_at: '2026-10-20T13:00:00Z', end_at: '2026-10-20T13:30:00Z', events: null }),
      ],
    });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    const labels = result.periods.flatMap((p) => p.reasons.map((r) => r.label));
    expect(labels).toEqual(['Confirmed booking', 'Tentative hold']);
  });

  /*
   * AC:       SCRUM-66 AC3
   * Scenario: Production use. The route doesn't pass a fixed time, so the real clock is used.
   * Setup:    A hold that expired in 2000, with no third argument, so the service falls back
   *           to new Date().
   * Expected: Not marked unavailable. This proves expiry is judged against the actual
   *           current time when the view is opened.
   * Type:     normal
   */
  it('US66-B15 (AC3): by default a hold is judged expired against the current time', async () => {
    mockData({ bookings: [booking({ status: 'TENTATIVE', hold_expires_at: '2000-01-01T00:00:00Z' })] });
    const result = await venuesService.getVenueAvailability(7, RANGE);
    expect(summary(result)).toEqual([['08:00', '14:00', true, []]]);
  });

  /*
   * AC:       SCRUM-66 (input validation)
   * Scenario: The service is called with no range argument at all, not just empty fields.
   * Setup:    Only the venue id is passed. This differs from US66-B12, which always passes
   *           an object.
   * Expected: A clean 400 instead of a TypeError from reading `from` of undefined.
   * Type:     error
   */
  it('US66-B16: calling without a range is a 400, not a crash', async () => {
    await expect(venuesService.getVenueAvailability(7)).rejects.toMatchObject({ status: 400 });
  });

  /*
   * AC:       SCRUM-66 (error handling; "for a venue")
   * Scenario: The venue id doesn't exist.
   * Setup:    The venue lookup returns null; the range is valid.
   * Expected: 404 "Venue not found", and no booking or unavailability queries are run.
   * Type:     error
   */
  it('US66-B13: returns 404 for an unknown venue', async () => {
    fetchOne.mockResolvedValue(null);
    await expect(venuesService.getVenueAvailability(99, RANGE, NOW)).rejects.toMatchObject({ status: 404 });
    expect(fetchMany).not.toHaveBeenCalled();
  });
});

describe('SCRUM-66 GET /api/venues/:id/availability (route)', () => {
  const app = createApp();
  const url = `/api/venues/7/availability?from=${RANGE.from}&to=${RANGE.to}`;

  beforeEach(() => {
    jest.spyOn(venuesService, 'getVenueAvailability').mockResolvedValue({ periods: [] });
  });

  afterEach(() => {
    venuesService.getVenueAvailability.mockRestore();
  });

  /*
   * AC:       SCRUM-66 story role ("authorised internal user"); complements AC6
   * Scenario: Each internal role opens the view through the real HTTP route.
   * Setup:    Signed-in user with only that role. The service is stubbed, because this
   *           test checks the route's role check and parameter passing, not the timeline.
   * Expected: 200, with the venue id and from/to passed through unchanged. Technical
   *           Support is included on the team's reading of the story's repeated role.
   * Type:     normal
   */
  it.each([ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF, ROLES.TECHNICAL_SUPPORT])(
    'US66-R01: %s can view availability',
    async (role) => {
      mockRoles = [role];
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      // The id arrives as a string from the URL; the service receives it as-is.
      expect(venuesService.getVenueAvailability).toHaveBeenCalledWith('7', { from: RANGE.from, to: RANGE.to });
    }
  );

  /*
   * AC:       SCRUM-66 AC6
   * Scenario: An Event Organiser or Attendee calls the availability endpoint directly.
   * Setup:    Signed-in user with only that role; the service is stubbed.
   * Expected: 403, and the service is never called. Hiding the page isn't enough, because
   *           the API itself must refuse.
   * Type:     error
   */
  it.each([ROLES.EVENT_ORGANISER, ROLES.ATTENDEE])('US66-R02 (AC6): %s is refused with 403', async (role) => {
    mockRoles = [role];
    const res = await request(app).get(url);
    expect(res.status).toBe(403);
    expect(venuesService.getVenueAvailability).not.toHaveBeenCalled();
  });
});

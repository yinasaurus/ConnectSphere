/*
 * SCRUM-80: notify the hold's Coordinator before expiry and when expiry passes.
 *
 *   AC1  Send a warning within the configurable lead time.
 *   AC2  Send an expiry notice when a hold expires.
 *   AC3  Each notice names the event and venue.
 *   AC4  Notify only the Coordinator assigned to the hold's event.
 *   AC5  Converted (non-TENTATIVE) bookings receive no further notices.
 *   AC6  Each hold receives at most one warning and one expiry notice.
 *
 * Dependency: SCRUM-75 creates expiring holds; SCRUM-76 expires holds automatically.
 */
jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchMany: jest.fn(),
  fetchOne: jest.fn(),
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  updateById: jest.fn(),
  throwIf: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn(),
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/notifications.service', () => ({
  notifyVenueStaff: jest.fn(),
}));

const { supabase, fetchMany } = require('../src/config/db');
const { notifyUser } = require('../src/services/audit.service');
const { BOOKING_STATUS } = require('../src/constants/statuses');
const venuesService = require('../src/services/venues.service');

const NOW = new Date('2026-11-02T00:00:00.000Z');

function hold(overrides = {}) {
  return {
    id: 700,
    event_id: 50,
    venue_id: 8,
    status: BOOKING_STATUS.TENTATIVE,
    hold_expires_at: '2026-11-02T00:10:00.000Z',
    events: { name: 'Tech Symposium', coordinator_id: 21 },
    venues: { name: 'Innovation Hall' },
    ...overrides,
  };
}

let warningRows;
let expiredRows;
let claimedMarkers;
let currentClaim;

beforeEach(() => {
  jest.clearAllMocks();
  warningRows = [];
  expiredRows = [];
  claimedMarkers = new Set();
  currentClaim = null;
  fetchMany.mockImplementation(async (builder) => {
    const source = builder.__kind === 'warning-query' ? warningRows : expiredRows;
    const expiryBound = builder.__filters.find(([operator, field]) => (
      operator === 'lte' && field === 'hold_expires_at'
    ));
    const marker = builder.__filters.find(([, field]) => field === 'hold_warning_sent_at'
      || field === 'hold_expiry_notice_sent_at')?.[1];
    return source.filter((row) => {
      if (
        !builder.__statuses.includes(row.status)
        || row[marker] != null
        || claimedMarkers.has(`${row.id}:${marker}`)
      ) return false;
      const expiry = new Date(row.hold_expires_at).getTime();
      const bound = new Date(expiryBound[2]).getTime();
      return builder.__kind === 'warning-query'
        ? expiry > new Date(NOW).getTime() && expiry <= bound
        : expiry <= new Date(NOW).getTime();
    });
  });
  supabase.from.mockImplementation((table) => ({
    __table: table,
    __kind: null,
    __statuses: [],
    select: jest.fn(function select() {
      return this;
    }),
    update: jest.fn(function update(patch) {
      currentClaim = { table, patch, id: null, marker: Object.keys(patch)[0] };
      return this;
    }),
    eq: jest.fn(function eq(field, value) {
      if (currentClaim) {
        if (field === 'id') currentClaim.id = value;
      } else {
        if (field === 'status') this.__statuses = [value];
        this.__filters = [...(this.__filters || []), ['eq', field, value]];
      }
      return this;
    }),
    in: jest.fn(function inFilter(field, values) {
      if (currentClaim) {
        if (field === 'status') currentClaim.statuses = values;
      } else {
        if (field === 'status') this.__statuses = values;
        this.__filters = [...(this.__filters || []), ['in', field, values]];
      }
      return this;
    }),
    gt: jest.fn(function gt(field, value) {
      this.__kind = 'warning-query';
      this.__filters = [...(this.__filters || []), ['gt', field, value]];
      return this;
    }),
    lte: jest.fn(function lte(field, value) {
      this.__filters = [...(this.__filters || []), ['lte', field, value]];
      return this;
    }),
    is: jest.fn(function is(field, value) {
      if (currentClaim) currentClaim.nullMarker = field === currentClaim.marker && value === null;
      else this.__filters = [...(this.__filters || []), ['is', field, value]];
      return this;
    }),
    maybeSingle: jest.fn(async () => {
      const claim = currentClaim;
      currentClaim = null;
      const key = `${claim.id}:${claim.marker}`;
      if (!claim.statuses.includes(BOOKING_STATUS.TENTATIVE)
        && !claim.statuses.includes(BOOKING_STATUS.EXPIRED)) {
        return { data: null, error: null };
      }
      if (!claim.nullMarker || claimedMarkers.has(key)) {
        return { data: null, error: null };
      }
      claimedMarkers.add(key);
      return { data: { id: claim.id }, error: null };
    }),
  }));
});

describe('SCRUM-80 hold expiry notifications', () => {
  /*
   * AC: SCRUM-80 AC1, AC3, AC4.
   * Scenario: A tentative hold reaches its configured warning window.
   * Setup: Hold expires 10 minutes from now, within a 15-minute lead time.
   * Expected: Only the event's Coordinator gets one notice naming the event and venue.
   * Type: normal.
   */
  // SCRUM-80-TC01
  it('sends the Coordinator a named warning inside the configured lead time', async () => {
    warningRows = [hold()];

    const result = await venuesService.processDueHoldNotifications(NOW, 15);

    expect(result).toEqual({ warningsSent: 1, expiryNoticesSent: 0 });
    expect(notifyUser).toHaveBeenCalledWith(
      21,
      'HOLD_EXPIRING',
      'Venue hold expiring soon',
      expect.stringContaining('Tech Symposium at Innovation Hall'),
      50
    );
    expect(notifyUser.mock.calls[0][3]).toContain('02 Nov 2026, 08:10 SGT');
  });

  /*
   * AC: SCRUM-80 AC2, AC3, AC4.
   * Scenario: A tentative hold has passed its expiry.
   * Setup: SCRUM-76 has already changed the hold status to EXPIRED.
   * Expected: Only that Coordinator gets one named expiry notice.
   * Type: boundary.
   */
  // SCRUM-80-TC02
  it('sends the Coordinator a named notice after the hold expires', async () => {
    expiredRows = [hold({
      status: BOOKING_STATUS.EXPIRED,
      hold_expires_at: '2026-11-01T23:59:00.000Z',
    })];

    const result = await venuesService.processDueHoldNotifications(NOW, 15);

    expect(result).toEqual({ warningsSent: 0, expiryNoticesSent: 1 });
    expect(notifyUser).toHaveBeenCalledWith(
      21,
      'HOLD_EXPIRED',
      'Venue hold expired',
      expect.stringContaining('Tech Symposium at Innovation Hall'),
      50
    );
    expect(notifyUser.mock.calls[0][3]).toContain('02 Nov 2026, 07:59 SGT');
  });

  /*
   * AC: SCRUM-80 AC1, AC5, AC6.
   * Scenario: A hold's expiry is outside the configured warning window and it is confirmed.
   * Setup: The row status is APPROVED when the expiry query runs.
   * Expected: No warning or expiry notice is sent for the confirmed booking.
   * Type: boundary.
   */
  // SCRUM-80-TC03
  it('does not warn early or send expiry notices after the hold is confirmed', async () => {
    warningRows = [];
    expiredRows = [hold({ status: BOOKING_STATUS.APPROVED })];

    const result = await venuesService.processDueHoldNotifications(NOW, 15);

    expect(result).toEqual({ warningsSent: 0, expiryNoticesSent: 0 });
    expect(notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-80 AC4.
   * Scenario: A due hold has no assigned Coordinator.
   * Setup: Hold event relation has coordinator_id null.
   * Expected: No other user receives the notice.
   * Type: boundary.
   */
  // SCRUM-80-TC04
  it('does not notify anyone when a hold has no assigned Coordinator', async () => {
    warningRows = [hold({ events: { name: 'Tech Symposium', coordinator_id: null } })];

    const result = await venuesService.processDueHoldNotifications(NOW, 15);

    expect(result.warningsSent).toBe(0);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-80 AC6.
   * Scenario: The scheduled job runs repeatedly for the same due hold.
   * Setup: Both ticks see the same warning candidate; the database claim is one-shot.
   * Expected: The persistent marker claim allows only one notification.
   * Type: boundary.
   */
  // SCRUM-80-TC05
  it('sends at most one warning and one expiry notice for a hold across repeated runs', async () => {
    warningRows = [hold()];
    await venuesService.processDueHoldNotifications(NOW, 15);
    await venuesService.processDueHoldNotifications(NOW, 15);
    expect(notifyUser).toHaveBeenCalledTimes(1);

    warningRows = [];
    expiredRows = [hold({
      status: BOOKING_STATUS.EXPIRED,
      hold_expires_at: '2026-11-01T23:59:00.000Z',
    })];
    await venuesService.processDueHoldNotifications(NOW, 15);
    await venuesService.processDueHoldNotifications(NOW, 15);
    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(notifyUser.mock.calls.map(([userId, type]) => [userId, type])).toEqual([
      [21, 'HOLD_EXPIRING'],
      [21, 'HOLD_EXPIRED'],
    ]);
  });

  /*
   * AC: SCRUM-80 AC1 and configurable warning interval.
   * Scenario: The poller queries upcoming holds with its supplied warning lead time.
   * Setup: Invoke the job with a 15-minute warning lead.
   * Expected: The warning query's upper-bound filter is exactly 15 minutes after now.
   * Type: normal.
   */
  // SCRUM-80-TC06
  it('uses the configured lead time to select holds for warning', async () => {
    await venuesService.processDueHoldNotifications(NOW, 15);
    const warningQuery = supabase.from.mock.results[0].value;
    const warningWindow = warningQuery.__filters.find(([operator, field]) => operator === 'lte' && field === 'hold_expires_at');

    expect(warningWindow[2]).toBe('2026-11-02T00:15:00.000Z');
  });

  /*
   * AC: SCRUM-80 AC2.
   * Scenario: SCRUM-76 has not yet changed the status; the hold is TENTATIVE but its
   * expiry has already passed.
   * Setup: Hold status stays TENTATIVE with hold_expires_at before NOW (TC02 uses EXPIRED).
   * Expected: The Coordinator receives one "Venue hold expired" notice.
   * Type: boundary.
   */
  // SCRUM-80-TC07
  it('sends an expiry notice for a TENTATIVE hold whose expiry has already passed', async () => {
    expiredRows = [hold({ hold_expires_at: '2026-11-01T23:59:00.000Z' })]; // status still TENTATIVE

    const result = await venuesService.processDueHoldNotifications(NOW, 15);

    expect(result).toEqual({ warningsSent: 0, expiryNoticesSent: 1 });
    expect(notifyUser).toHaveBeenCalledWith(
      21,
      'HOLD_EXPIRED',
      'Venue hold expired',
      expect.stringContaining('Tech Symposium at Innovation Hall'),
      50
    );
  });

  /*
   * AC: SCRUM-80 AC6 (retry on delivery failure).
   * Scenario: The notification service is temporarily unavailable on the first job run.
   * Setup: notifyUser rejects once; the hold is a warning candidate on both runs.
   * Expected: The marker stays null after the failed run so the next run retries and
   * succeeds.
   * Type: error.
   */
  // SCRUM-80-TC08
  it('retries the notice on the next run when notifyUser fails and leaves the marker empty', async () => {
    warningRows = [hold()];
    notifyUser
      .mockRejectedValueOnce(new Error('notification service down'))
      .mockResolvedValue(undefined);

    // First run: delivery fails; 0 sent, marker stays null.
    const first = await venuesService.processDueHoldNotifications(NOW, 15);
    expect(first).toEqual({ warningsSent: 0, expiryNoticesSent: 0 });

    // Second run: delivery succeeds; same hold is retried because marker was never set.
    const second = await venuesService.processDueHoldNotifications(NOW, 15);
    expect(second).toEqual({ warningsSent: 1, expiryNoticesSent: 0 });

    expect(notifyUser).toHaveBeenCalledTimes(2);
  });

  /*
   * AC: SCRUM-80 AC1 and configurable warning interval.
   * Scenario: A 5-minute lead warns only holds expiring within that window.
   * Setup: One hold 10 minutes out (outside window); one hold 3 minutes out (inside window).
   * Expected: Only the 3-minute hold triggers a warning; the 10-minute hold does not.
   * Type: boundary.
   */
  // SCRUM-80-TC09
  it('warns only holds inside the configured lead-time window', async () => {
    // hold() expires 10 minutes from NOW -- outside a 5-minute window.
    warningRows = [hold()];
    const resultOutside = await venuesService.processDueHoldNotifications(NOW, 5);
    expect(resultOutside).toEqual({ warningsSent: 0, expiryNoticesSent: 0 });
    expect(notifyUser).not.toHaveBeenCalled();

    jest.clearAllMocks();

    // A hold 3 minutes out -- inside the 5-minute window.
    warningRows = [hold({ hold_expires_at: '2026-11-02T00:03:00.000Z' })];
    const resultInside = await venuesService.processDueHoldNotifications(NOW, 5);
    expect(resultInside).toEqual({ warningsSent: 1, expiryNoticesSent: 0 });
    expect(notifyUser).toHaveBeenCalledWith(
      21,
      'HOLD_EXPIRING',
      'Venue hold expiring soon',
      expect.stringContaining('Tech Symposium at Innovation Hall'),
      50
    );
  });
});

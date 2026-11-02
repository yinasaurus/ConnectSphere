/**
 * SCRUM-76: a tentative venue hold expires automatically when it isn't confirmed by its
 * expiry time, so the venue can be offered to other events.
 *
 * Labels:
 *   US76-B..  service rules (venuesService.expireHolds, findConflict, decideBooking, cancelBooking)
 *   US76-J..  the timer job (jobs/holdExpiry.job.js)
 *
 * expireHolds runs one conditional UPDATE. The tests below run that UPDATE against a small
 * in-memory venue_bookings table, so they check which rows really change, not only which
 * filters were sent.
 */
jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  throwIf: jest.fn(),
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  updateById: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));
jest.mock('../src/services/notifications.service', () => ({ notifyVenueStaff: jest.fn() }));

const { supabase, fetchOne, fetchMany, updateById } = require('../src/config/db');
const { writeAudit } = require('../src/services/audit.service');
const { ROLES } = require('../src/constants/roles');
const { BOOKING_STATUS } = require('../src/constants/statuses');
const venuesService = require('../src/services/venues.service');
const { startHoldExpiryJob, DEFAULT_INTERVAL_MS } = require('../src/jobs/holdExpiry.job');
const accessService = require('../src/services/access.service');

const STAFF = { id: 40, roles: [ROLES.VENUE_STAFF] };
const COORDINATOR = { id: 21, roles: [ROLES.EVENT_COORDINATOR] };

const EXPIRY = '2026-11-18T09:00:00.000Z';
const BEFORE = new Date('2026-11-18T08:59:59.999Z');
const AT = new Date(EXPIRY);
const AFTER = new Date('2026-11-18T09:00:00.001Z');

function hold(extra = {}) {
  return {
    id: 900,
    event_id: 50,
    venue_id: 8,
    status: BOOKING_STATUS.TENTATIVE,
    start_at: '2026-11-20T10:00:00.000Z',
    end_at: '2026-11-20T12:00:00.000Z',
    setup_minutes: 30,
    teardown_minutes: 45,
    hold_expires_at: EXPIRY,
    ...extra,
  };
}

// --- a tiny in-memory venue_bookings table for the UPDATE ... WHERE ... RETURNING query ---
let table;

function builder() {
  const state = { patch: null, filters: [] };
  const b = {
    state,
    update(patch) { state.patch = patch; return b; },
    eq(col, val) { state.filters.push((row) => row[col] === val); return b; },
    lte(col, val) { state.filters.push((row) => row[col] !== null && new Date(row[col]) <= new Date(val)); return b; },
    not(col, op, val) {
      if (op === 'is' && val === null) state.filters.push((row) => row[col] !== null && row[col] !== undefined);
      return b;
    },
    in(col, vals) { state.filters.push((row) => vals.includes(row[col])); return b; },
    select() { return b; },
    order() { return b; },
  };
  return b;
}

function runQuery(b) {
  const matches = table.filter((row) => b.state.filters.every((test) => test(row)));
  if (b.state.patch) matches.forEach((row) => Object.assign(row, b.state.patch));
  return matches.map((row) => ({ ...row }));
}

beforeEach(() => {
  jest.clearAllMocks();
  table = [];
  supabase.from.mockImplementation(() => builder());
  fetchMany.mockReset().mockImplementation(async (b) => runQuery(b));
  fetchOne.mockReset();
  updateById.mockReset().mockImplementation(async (_t, id, patch) => ({ id, ...patch }));
  writeAudit.mockResolvedValue();
});

describe('SCRUM-76 expire holds (service rules)', () => {
  it('US76-B01: a Held booking whose expiry has passed becomes Expired', async () => {
    table = [hold()];
    const expired = await venuesService.expireHolds(AFTER);
    expect(expired.map((row) => row.id)).toEqual([900]);
    expect(table[0].status).toBe(BOOKING_STATUS.EXPIRED);
  });

  it('US76-B02: a Held booking expires exactly at its expiry time', async () => {
    table = [hold()];
    await venuesService.expireHolds(AT);
    expect(table[0].status).toBe(BOOKING_STATUS.EXPIRED);
  });

  it('US76-B03: a Held booking is not expired before its expiry time', async () => {
    table = [hold()];
    const expired = await venuesService.expireHolds(BEFORE);
    expect(expired).toEqual([]);
    expect(table[0].status).toBe(BOOKING_STATUS.TENTATIVE);
  });

  it('US76-B04: a confirmed (APPROVED) booking is never expired', async () => {
    table = [hold({ status: BOOKING_STATUS.APPROVED })];
    await venuesService.expireHolds(AFTER);
    expect(table[0].status).toBe(BOOKING_STATUS.APPROVED);
  });

  it('US76-B05: a cancelled hold is not changed to Expired', async () => {
    table = [hold({ status: BOOKING_STATUS.CANCELLED })];
    await venuesService.expireHolds(AFTER);
    expect(table[0].status).toBe(BOOKING_STATUS.CANCELLED);
  });

  it.each([BOOKING_STATUS.PENDING, BOOKING_STATUS.REJECTED])(
    'US76-B06: a %s booking is not touched',
    async (status) => {
      table = [hold({ status })];
      await venuesService.expireHolds(AFTER);
      expect(table[0].status).toBe(status);
    }
  );

  it('US76-B07: a hold with no expiry recorded is left alone', async () => {
    table = [hold({ hold_expires_at: null })];
    await venuesService.expireHolds(AFTER);
    expect(table[0].status).toBe(BOOKING_STATUS.TENTATIVE);
  });

  it('US76-B08: re-running on an already expired hold changes nothing', async () => {
    table = [hold()];
    await venuesService.expireHolds(AFTER);
    const snapshot = JSON.parse(JSON.stringify(table));
    writeAudit.mockClear();

    const second = await venuesService.expireHolds(new Date('2026-11-19T00:00:00.000Z'));

    expect(second).toEqual([]);
    expect(table).toEqual(snapshot);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('US76-B09: only due holds change when several are stored', async () => {
    table = [
      hold({ id: 1, hold_expires_at: '2026-11-17T00:00:00.000Z' }),
      hold({ id: 2, hold_expires_at: '2026-11-19T00:00:00.000Z' }),
      hold({ id: 3, status: BOOKING_STATUS.CANCELLED, hold_expires_at: '2026-11-17T00:00:00.000Z' }),
      hold({ id: 4, status: BOOKING_STATUS.APPROVED, hold_expires_at: '2026-11-17T00:00:00.000Z' }),
    ];
    const expired = await venuesService.expireHolds(AFTER);
    expect(expired.map((row) => row.id)).toEqual([1]);
    expect(table.map((row) => row.status)).toEqual([
      BOOKING_STATUS.EXPIRED,
      BOOKING_STATUS.TENTATIVE,
      BOOKING_STATUS.CANCELLED,
      BOOKING_STATUS.APPROVED,
    ]);
  });

  it('US76-B10: writes one HOLD_EXPIRED audit entry per expired hold, with no user as actor', async () => {
    table = [hold()];
    await venuesService.expireHolds(AFTER);
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(null, 'HOLD_EXPIRED', 'venue_booking', 900, {
      eventId: 50,
      venueId: 8,
      holdExpiresAt: EXPIRY,
    });
  });

  it('US76-B11: an expired hold no longer blocks another event\'s request for that period', async () => {
    table = [hold()];
    await venuesService.expireHolds(AFTER);
    const conflict = await venuesService.findConflict(
      8, '2026-11-20T10:00:00.000Z', '2026-11-20T12:00:00.000Z', 0, 0,
      { confirmedOnly: true, ownEventId: 77, now: AFTER }
    );
    expect(conflict).toBeNull();
  });

  it('US76-B12: the venue is still blocked if another booking occupies that period', async () => {
    table = [
      hold(),
      hold({ id: 901, event_id: 60, status: BOOKING_STATUS.APPROVED, hold_expires_at: null }),
    ];
    await venuesService.expireHolds(AFTER);
    const conflict = await venuesService.findConflict(
      8, '2026-11-20T10:00:00.000Z', '2026-11-20T12:00:00.000Z', 0, 0,
      { confirmedOnly: true, ownEventId: 77, now: AFTER }
    );
    expect(conflict).toMatchObject({ id: 901 });
  });

  it('US76-B13: the venue is still blocked if another active hold occupies that period', async () => {
    table = [
      hold(),
      hold({ id: 902, event_id: 61, hold_expires_at: '2026-11-19T12:00:00.000Z' }),
    ];
    await venuesService.expireHolds(AFTER);
    const conflict = await venuesService.findConflict(
      8, '2026-11-20T10:00:00.000Z', '2026-11-20T12:00:00.000Z', 0, 0,
      { confirmedOnly: true, ownEventId: 77, now: AFTER }
    );
    expect(conflict).toMatchObject({ id: 902 });
  });

  it('US76-B14: between job runs, a hold past its expiry already stops blocking', async () => {
    // Still TENTATIVE in the table (the job hasn't run yet), but its expiry has passed.
    table = [hold()];
    const conflict = await venuesService.findConflict(
      8, '2026-11-20T10:00:00.000Z', '2026-11-20T12:00:00.000Z', 0, 0,
      { confirmedOnly: true, ownEventId: 77, now: AFTER }
    );
    expect(conflict).toBeNull();
  });

  it('US76-B15: an expired hold cannot be approved as a booking', async () => {
    fetchOne.mockResolvedValueOnce(hold({ status: BOOKING_STATUS.EXPIRED }));
    await expect(
      venuesService.decideBooking(STAFF, 900, { approve: true })
    ).rejects.toMatchObject({ status: 409, code: 'ALREADY_DECIDED' });
    expect(updateById).not.toHaveBeenCalled();
  });

  it('US76-B16: an expired hold cannot be cancelled (it is already released)', async () => {
    fetchOne
      .mockResolvedValueOnce(hold({ status: BOOKING_STATUS.EXPIRED }))
      .mockResolvedValueOnce({ id: 50, status: 'PLANNING', coordinator_id: 21 });
    await expect(
      venuesService.cancelBooking(COORDINATOR, 900)
    ).rejects.toMatchObject({ status: 409, code: 'INVALID_STATUS' });
    expect(updateById).not.toHaveBeenCalled();
  });

  it('US76-B18: an expired hold does not stop an event from being ready for the safety check', async () => {
    fetchMany
      .mockResolvedValueOnce([{ status: BOOKING_STATUS.APPROVED }, { status: BOOKING_STATUS.EXPIRED }])
      .mockResolvedValueOnce([]);
    await expect(accessService.arrangementsReadyForSafetyCheck(50)).resolves.toEqual({ ok: true });
  });

  it('US76-B19: an expired hold alone does not count as the event\'s venue booking', async () => {
    fetchMany.mockResolvedValueOnce([{ status: BOOKING_STATUS.EXPIRED }]);
    const gate = await accessService.arrangementsReadyForSafetyCheck(50);
    expect(gate.ok).toBe(false);
  });

  it('US76-B17: a database error is passed on', async () => {
    fetchMany.mockRejectedValueOnce(Object.assign(new Error('db down'), { status: 500 }));
    await expect(venuesService.expireHolds(AFTER)).rejects.toThrow('db down');
  });
});

describe('SCRUM-76 expire holds with the real clock', () => {
  it('US76-B20: with no time passed in, expireHolds uses the current time', async () => {
    table = [
      hold({ id: 900, hold_expires_at: new Date(Date.now() - 60 * 1000).toISOString() }),
      hold({ id: 901, hold_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() }),
    ];
    const expired = await venuesService.expireHolds();
    expect(expired.map((row) => row.id)).toEqual([900]);
    expect(table[1].status).toBe(BOOKING_STATUS.TENTATIVE);
  });
});

describe('SCRUM-76 expiry timer job', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('US76-J01: runs once at start-up, then on every interval, with no user action', async () => {
    const run = jest.fn().mockResolvedValue([]);
    const stop = startHoldExpiryJob({ intervalMs: 1000, run });
    expect(run).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(4);
    expect(run.mock.calls[0][0]).toBeInstanceOf(Date);
    stop();
  });

  it('US76-J02: stop() ends the timer', async () => {
    const run = jest.fn().mockResolvedValue([]);
    const stop = startHoldExpiryJob({ intervalMs: 1000, run });
    stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('US76-J03: a failed run is logged and the next run still happens', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const run = jest.fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue([]);
    const stop = startHoldExpiryJob({ intervalMs: 1000, run });
    await jest.advanceTimersByTimeAsync(1000);

    expect(errorSpy).toHaveBeenCalledWith('Hold expiry run failed', expect.any(Error));
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    errorSpy.mockRestore();
  });

  it('US76-J04: logs which holds were expired', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const run = jest.fn().mockResolvedValue([{ id: 900 }, { id: 901 }]);
    const stop = startHoldExpiryJob({ intervalMs: 1000, run });
    await jest.advanceTimersByTimeAsync(0);

    expect(logSpy).toHaveBeenCalledWith('Expired 2 venue hold(s): 900, 901');
    stop();
    logSpy.mockRestore();
  });

  it('US76-J05: with no options, runs the real expiry check every minute', async () => {
    const now = new Date('2026-11-18T08:59:30.000Z');
    jest.setSystemTime(now);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    table = [hold()];
    const stop = startHoldExpiryJob();
    await jest.advanceTimersByTimeAsync(0);
    expect(table[0].status).toBe(BOOKING_STATUS.TENTATIVE);

    // One default interval (60s) later the clock is past the 09:00 expiry.
    await jest.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    expect(table[0].status).toBe(BOOKING_STATUS.EXPIRED);
    expect(logSpy).toHaveBeenCalledWith('Expired 1 venue hold(s): 900');
    stop();
    logSpy.mockRestore();
  });
});

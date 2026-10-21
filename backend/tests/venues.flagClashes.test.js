/**
 * SCRUM-58: Identify bookings made problematic by new setup and turnaround times.
 *   AC1  Saving a venue's setup or turnaround time flags every booking at that venue that
 *        now clashes with another booking. A booking occupies the venue from its start minus
 *        setup until its end plus turnaround.
 *   AC2  Occupied windows that only touch (one ends exactly when the other starts) are not flagged.
 *   AC3  If the change creates no overlap, nothing is flagged.
 *   AC4  Bookings at other venues are not flagged.
 *   AC5  Flagged bookings are listed for Venue Staff, and the Coordinator of each affected
 *        event sees their event's booking flagged.
 *   AC6  Flagging never cancels, edits or removes a booking: venue, date, time and status stay.
 *   Assumption (confirm with the customer): only confirmed bookings and active holds count.
 *
 * Decisions agreed for this story: the venue's NEW times are used for every booking (each
 * booking's own stored times are left alone), both bookings of a clashing pair are flagged,
 * holds are padded like confirmed bookings, flags are never cleared automatically, and "past"
 * means the booking's end time is at or before now.
 *
 * The flag is the existing venue_bookings.needs_review mark (SCRUM-42), shown on the event
 * page as "Requires review". The database is replaced by in-memory tables so each test can
 * check exactly what was written; the HTTP tests go through the real app (session cookie,
 * role check, body validation, services).
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  updateById: jest.fn(),
  throwIf: jest.fn((error) => {
    if (error) throw error;
  }),
}));

jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn(),
  notifyUser: jest.fn(),
}));

const db = require('../src/config/db');
const audit = require('../src/services/audit.service');
const venuesService = require('../src/services/venues.service');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');
const { createApp } = require('../src/app');

const USERS = {
  venueStaff: { id: 1, role: ROLES.VENUE_STAFF },
  coordinatorA: { id: 2, role: ROLES.EVENT_COORDINATOR },
  coordinatorB: { id: 6, role: ROLES.EVENT_COORDINATOR },
};

// Every booking is on this day, far in the future, so none is "past" when the real clock is used.
const DAY = '2099-06-01';
// A fixed "now" for direct calls to the service: after the hold expiries below, before DAY.
const NOW = new Date('2099-01-01T00:00:00.000Z');

let tables;

// In-memory stand-in for the tables the routes and the login check read and write.
function useInMemoryTables() {
  let nextId = 1000;
  const rowsFor = (query) => tables[query.table].filter((row) => (
    query.filters.every(([column, value]) => (
      Array.isArray(value)
        ? value.map(String).includes(String(row[column]))
        : String(row[column]) === String(value)
    ))
  ));

  db.supabase.from.mockImplementation((table) => {
    const query = { table, filters: [] };
    query.select = () => query;
    query.order = () => query;
    query.eq = (column, value) => {
      query.filters.push([column, value]);
      return query;
    };
    query.in = (column, values) => {
      query.filters.push([column, values]);
      return query;
    };
    return query;
  });
  db.fetchMany.mockImplementation(async (query) => rowsFor(query));
  db.fetchOne.mockImplementation(async (query) => rowsFor(query)[0] || null);
  db.insertOne.mockImplementation(async (table, row) => {
    const created = { id: nextId++, ...row };
    tables[table].push(created);
    return created;
  });
  db.insertMany.mockImplementation(async (table, rows) => {
    const created = rows.map((row) => ({ id: nextId++, ...row }));
    tables[table].push(...created);
    return created;
  });
  db.updateById.mockImplementation(async (table, id, patch) => {
    const row = tables[table].find((item) => Number(item.id) === Number(id));
    Object.assign(row, patch);
    return row;
  });
}

function cookieFor(user) {
  const token = jwt.sign({ sub: user.id, roles: [user.role] }, env.jwtSecret);
  return `${env.sessionCookieName}=${token}`;
}

// A booking on DAY from `from` to `to` (HH:MM, UTC). Defaults: confirmed, at venue 1.
function booking(id, from, to, overrides = {}) {
  return {
    id,
    event_id: id,
    venue_id: 1,
    status: 'APPROVED',
    start_at: `${DAY}T${from}:00.000Z`,
    end_at: `${DAY}T${to}:00.000Z`,
    setup_minutes: 0,
    teardown_minutes: 0,
    needs_review: false,
    hold_expires_at: null,
    expires_at: null,
    ...overrides,
  };
}

function venueTimes(setup, teardown) {
  return { id: 1, setup_minutes: setup, teardown_minutes: teardown };
}

function row(id) {
  return tables.venue_bookings.find((item) => item.id === id);
}

function flaggedIds() {
  return tables.venue_bookings.filter((item) => item.needs_review).map((item) => item.id).sort();
}

beforeEach(() => {
  jest.clearAllMocks();
  tables = {
    users: Object.values(USERS).map((user) => ({ id: user.id, email: `${user.id}@test`, is_active: true })),
    user_roles: Object.values(USERS).map((user) => ({ user_id: user.id, role: user.role })),
    venues: [
      { id: 1, name: 'Helix Hall', location: 'Level 2', capacity: 180, setup_minutes: 0, teardown_minutes: 0, is_active: true },
      { id: 2, name: 'Annex', location: 'Level 3', capacity: 60, setup_minutes: 0, teardown_minutes: 0, is_active: true },
    ],
    venue_layouts: [],
    venue_bookings: [],
    events: [
      { id: 1, name: 'Forum', coordinator_id: USERS.coordinatorA.id, status: 'PLANNING' },
      { id: 2, name: 'Workshop', coordinator_id: USERS.coordinatorB.id, status: 'PLANNING' },
      { id: 3, name: 'Gala', coordinator_id: USERS.coordinatorA.id, status: 'PLANNING' },
    ],
    safety_checks: [],
  };
  useInMemoryTables();
});

describe('SCRUM-58 which bookings are flagged when the venue times are saved', () => {
  /*
   * AC:       SCRUM-58 AC1
   * Scenario: Venue Staff raise setup and turnaround to 30 minutes each; two bookings that
   *           were fine before now reach into each other.
   * Setup:    A 10:00-12:00 and B 12:30-14:00 (30 min gap). With 30/30 A occupies 09:30-12:30
   *           and B 12:00-14:30, so they overlap by 30 minutes.
   * Expected: Both A and B get needs_review; both ids are returned.
   * Type:     normal
   */
  it('US58-U01: bookings that now overlap are both flagged', async () => {
    tables.venue_bookings.push(booking(1, '10:00', '12:00'), booking(2, '12:30', '14:00'));

    const ids = await venuesService.flagBookingsClashingUnderVenueTimes(
      { id: 1 }, venueTimes(30, 30), NOW
    );

    expect(ids.sort()).toEqual([1, 2]);
    // Both sides of the pair carry the mark, not just the later booking.
    expect(flaggedIds()).toEqual([1, 2]);
  });

  /*
   * AC:       SCRUM-58 AC1 (setup shifts the START earlier)
   * Scenario: Only the setup time is raised; the earlier booking's turnaround stays zero.
   * Setup:    A 10:00-12:00, B 12:20-14:00. Setup 30, turnaround 0: A occupies 10:00-12:00 but
   *           B occupies 11:50-14:00, so B's setup reaches back into A.
   * Expected: Both flagged. This proves the setup time moves the start earlier.
   * Type:     boundary
   */
  it('US58-U02: a setup time on its own can create the clash', async () => {
    tables.venue_bookings.push(booking(1, '10:00', '12:00'), booking(2, '12:20', '14:00'));

    await venuesService.flagBookingsClashingUnderVenueTimes({ id: 1 }, venueTimes(30, 0), NOW);

    expect(flaggedIds()).toEqual([1, 2]);
  });

  /*
   * AC:       SCRUM-58 AC1 (turnaround shifts the END later)
   * Scenario: Only the turnaround time is raised.
   * Setup:    A 10:00-12:00, B 12:20-14:00. Setup 0, turnaround 30: A occupies 10:00-12:30,
   *           B occupies 12:20-14:30, so A's turnaround runs into B.
   * Expected: Both flagged. This proves the turnaround time moves the end later.
   * Type:     boundary
   */
  it('US58-U03: a turnaround time on its own can create the clash', async () => {
    tables.venue_bookings.push(booking(1, '10:00', '12:00'), booking(2, '12:20', '14:00'));

    await venuesService.flagBookingsClashingUnderVenueTimes({ id: 1 }, venueTimes(0, 30), NOW);

    expect(flaggedIds()).toEqual([1, 2]);
  });

  /*
   * AC:       SCRUM-58 AC2
   * Scenario: The new times make one booking's occupied window end exactly when the next starts.
   * Setup:    A 10:00-12:00 and B 13:00-15:00 with 30/30: A occupies 09:30-12:30 and B
   *           12:30-15:30. 12:30 is both A's end and B's start.
   * Expected: Nothing flagged: touching is not overlapping.
   * Type:     boundary
   */
  it('US58-U04: windows that only touch are not flagged', async () => {
    tables.venue_bookings.push(booking(1, '10:00', '12:00'), booking(2, '13:00', '15:00'));

    const ids = await venuesService.flagBookingsClashingUnderVenueTimes(
      { id: 1 }, venueTimes(30, 30), NOW
    );

    expect(ids).toEqual([]);
    expect(flaggedIds()).toEqual([]);
  });

  /*
   * AC:       SCRUM-58 AC3
   * Scenario: The new times leave every booking with room to spare.
   * Setup:    A 10:00-12:00 and B 15:00-17:00 with 30/30.
   * Expected: Nothing flagged, no booking updated, no audit entry written.
   * Type:     normal
   */
  it('US58-U05: no overlap means nothing is flagged or written', async () => {
    tables.venue_bookings.push(booking(1, '10:00', '12:00'), booking(2, '15:00', '17:00'));

    const ids = await venuesService.flagBookingsClashingUnderVenueTimes(
      { id: 1 }, venueTimes(30, 30), NOW
    );

    expect(ids).toEqual([]);
    expect(db.updateById).not.toHaveBeenCalled();
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-58 AC3 (boundary: the smallest gap that still clears)
   * Scenario: Zero setup and turnaround, back-to-back bookings.
   * Setup:    A 10:00-12:00, B 12:00-14:00 with 0/0.
   * Expected: Nothing flagged (touching at 12:00).
   * Type:     boundary
   */
  it('US58-U06: zero-minute times with back-to-back bookings flag nothing', async () => {
    tables.venue_bookings.push(booking(1, '10:00', '12:00'), booking(2, '12:00', '14:00'));

    const ids = await venuesService.flagBookingsClashingUnderVenueTimes(
      { id: 1 }, venueTimes(0, 0), NOW
    );

    expect(ids).toEqual([]);
  });

  /*
   * AC:       SCRUM-58 AC1
   * Scenario: Three bookings; only two clash.
   * Setup:    A 10:00-12:00, B 12:30-14:00 (clash with 30/30), C 18:00-20:00 (clear).
   * Expected: A and B flagged; C is not.
   * Type:     normal
   */
  it('US58-U07: only the bookings that clash are flagged', async () => {
    tables.venue_bookings.push(
      booking(1, '10:00', '12:00'),
      booking(2, '12:30', '14:00'),
      booking(3, '18:00', '20:00')
    );

    await venuesService.flagBookingsClashingUnderVenueTimes({ id: 1 }, venueTimes(30, 30), NOW);

    expect(flaggedIds()).toEqual([1, 2]);
  });

  /*
   * AC:       SCRUM-58 AC1 (the venue's NEW times decide, not each booking's stored times)
   * Scenario: The bookings were made when the venue used 0/0, so each still stores 0/0.
   * Setup:    A and B store setup 0 / teardown 0; the venue now saves 30/30.
   * Expected: They are flagged, which only happens if the new venue times are used.
   * Type:     normal
   */
  it('US58-U08: the venue times are used, not the times stored on each booking', async () => {
    tables.venue_bookings.push(
      booking(1, '10:00', '12:00', { setup_minutes: 0, teardown_minutes: 0 }),
      booking(2, '12:30', '14:00', { setup_minutes: 0, teardown_minutes: 0 })
    );

    await venuesService.flagBookingsClashingUnderVenueTimes({ id: 1 }, venueTimes(30, 30), NOW);

    expect(flaggedIds()).toEqual([1, 2]);
    // The booking's own stored times are left alone.
    expect(row(1).setup_minutes).toBe(0);
    expect(row(1).teardown_minutes).toBe(0);
  });
});

describe('SCRUM-58 AC4: other venues are not flagged', () => {
  /*
   * AC:       SCRUM-58 AC4
   * Scenario: Venue 1's times change. Venue 2 has two bookings that would clash under the
   *           same times, and a booking at the same hour as a venue 1 booking.
   * Setup:    Venue 1: A 10:00-12:00 (alone). Venue 2: B 10:00-12:00 and C 12:30-14:00.
   * Expected: Nothing is flagged: B and C belong to venue 2, and A's overlap with B is
   *           across different venues, which is not a clash.
   * Type:     boundary
   */
  it('US58-V01: bookings at other venues are not flagged', async () => {
    tables.venue_bookings.push(
      booking(1, '10:00', '12:00'),
      booking(2, '10:00', '12:00', { venue_id: 2 }),
      booking(3, '12:30', '14:00', { venue_id: 2 })
    );

    const ids = await venuesService.flagBookingsClashingUnderVenueTimes(
      { id: 1 }, venueTimes(30, 30), NOW
    );

    expect(ids).toEqual([]);
    expect(flaggedIds()).toEqual([]);
  });

  /*
   * AC:       SCRUM-58 AC4 (defence in depth)
   * Scenario: The database query returns a row from another venue by mistake.
   * Setup:    fetchMany is forced to return A (venue 1) and B (venue 2) at overlapping times.
   * Expected: B is ignored, so nothing is flagged and nothing is written.
   * Type:     error
   */
  it('US58-V02: a row from another venue that slips into the result is ignored', async () => {
    tables.venue_bookings.push(booking(1, '10:00', '12:00'), booking(2, '11:00', '13:00', { venue_id: 2 }));
    db.fetchMany.mockResolvedValueOnce(tables.venue_bookings);

    const ids = await venuesService.flagBookingsClashingUnderVenueTimes(
      { id: 1 }, venueTimes(30, 30), NOW
    );

    expect(ids).toEqual([]);
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

describe('SCRUM-58 assumption: only confirmed bookings and active holds are considered', () => {
  /*
   * AC:       SCRUM-58 assumption (matches SCRUM-60)
   * Scenario: A confirmed booking overlaps a pending request, a cancelled booking, a rejected
   *           booking, an expired hold and a booking that already ended.
   * Setup:    A 10:00-12:00 APPROVED. Others overlap A's padded window but are PENDING,
   *           CANCELLED, REJECTED and TENTATIVE with an expiry before now. A seventh, APPROVED
   *           in 2020, is on another day so it can never clash (the past rule itself is
   *           tested by US58-A05).
   * Expected: Nothing is flagged, including A: ignored rows must not count as the other side.
   * Type:     boundary
   */
  it('US58-A01: pending, cancelled, rejected, expired and past bookings are ignored', async () => {
    tables.venue_bookings.push(
      booking(1, '10:00', '12:00'),
      booking(2, '12:30', '14:00', { status: 'PENDING' }),
      booking(3, '12:30', '14:00', { status: 'CANCELLED' }),
      booking(4, '12:30', '14:00', { status: 'REJECTED' }),
      booking(5, '12:30', '14:00', { status: 'TENTATIVE', hold_expires_at: '2098-12-31T00:00:00.000Z' }),
      booking(6, '10:00', '12:00', {
        start_at: '2020-06-01T10:00:00.000Z',
        end_at: '2020-06-01T12:00:00.000Z',
      })
    );

    const ids = await venuesService.flagBookingsClashingUnderVenueTimes(
      { id: 1 }, venueTimes(30, 30), NOW
    );

    expect(ids).toEqual([]);
    expect(flaggedIds()).toEqual([]);
  });

  /*
   * AC:       SCRUM-58 assumption (only confirmed bookings and active holds count)
   * Scenario: The database query wrongly returns pending, cancelled and rejected rows.
   * Setup:    fetchMany is forced to return a confirmed booking plus a PENDING, a CANCELLED
   *           and a REJECTED one, each overlapping it once padded by 30/30, none with an expiry.
   * Expected: Nothing is flagged: the code itself refuses to treat those rows as holds, so
   *           it does not rely on the query to leave them out.
   * Type:     error
   */
  it('US58-A04: pending, cancelled and rejected rows are never treated as holds', async () => {
    tables.venue_bookings.push(
      booking(1, '10:00', '12:00'),
      booking(2, '12:30', '14:00', { status: 'PENDING' }),
      booking(3, '12:30', '14:00', { status: 'CANCELLED' }),
      booking(4, '12:30', '14:00', { status: 'REJECTED' })
    );
    db.fetchMany.mockResolvedValueOnce(tables.venue_bookings);

    const ids = await venuesService.flagBookingsClashingUnderVenueTimes(
      { id: 1 }, venueTimes(30, 30), NOW
    );

    expect(ids).toEqual([]);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-58 assumption (past bookings are not flagged) + decision: "past" means the
   *           booking's end time is at or before now
   * Scenario: On the same day, one booking has already ended while two others are still to come.
   * Setup:    Now is 13:00 on DAY. A 10:00-12:00 has ended; B 12:30-14:00 is in progress;
   *           C 13:30-15:00 is later. Under 30/30, A would clash with B, and B with C.
   * Expected: Only B and C are flagged. A is left alone even though it overlaps B, so the only
   *           reason it is skipped is that it has ended.
   * Type:     boundary
   */
  it('US58-A05: a booking that has already ended is not flagged, even if it overlaps one still to come', async () => {
    tables.venue_bookings.push(
      booking(1, '10:00', '12:00'),
      booking(2, '12:30', '14:00'),
      booking(3, '13:30', '15:00')
    );

    const ids = await venuesService.flagBookingsClashingUnderVenueTimes(
      { id: 1 }, venueTimes(30, 30), new Date(`${DAY}T13:00:00.000Z`)
    );

    expect([...ids].sort()).toEqual([2, 3]);
    expect(flaggedIds()).toEqual([2, 3]);
  });

  /*
   * AC:       SCRUM-58 assumption (active holds count) + decision: holds are padded
   * Scenario: A confirmed booking and an active hold sit next to each other.
   * Setup:    A 10:00-12:00 APPROVED; B 12:30-14:00 TENTATIVE, hold expires after now. With
   *           30/30 A ends at 12:30 and B starts at 12:30 if B is NOT padded, so B only
   *           clashes because holds are padded (B occupies 12:00-14:30).
   * Expected: Both flagged, which shows the hold is padded like a confirmed booking.
   * Type:     boundary
   */
  it('US58-A02: an active hold counts, padded like a confirmed booking', async () => {
    tables.venue_bookings.push(
      booking(1, '10:00', '12:00'),
      booking(2, '12:30', '14:00', { status: 'TENTATIVE', hold_expires_at: '2099-02-01T00:00:00.000Z' })
    );

    await venuesService.flagBookingsClashingUnderVenueTimes({ id: 1 }, venueTimes(30, 30), NOW);

    expect(flaggedIds()).toEqual([1, 2]);
  });

  /*
   * AC:       SCRUM-58 assumption (a hold with no expiry is still active)
   * Scenario: A tentative hold with no expiry recorded overlaps a confirmed booking.
   * Setup:    A 10:00-12:00 APPROVED; B 12:30-14:00 TENTATIVE, hold_expires_at and expires_at null.
   * Expected: Both flagged: an undated hold is treated as active (same as SCRUM-66).
   * Type:     boundary
   */
  it('US58-A03: a hold with no expiry is treated as active', async () => {
    tables.venue_bookings.push(
      booking(1, '10:00', '12:00'),
      booking(2, '12:30', '14:00', { status: 'TENTATIVE' })
    );

    await venuesService.flagBookingsClashingUnderVenueTimes({ id: 1 }, venueTimes(30, 30), NOW);

    expect(flaggedIds()).toEqual([1, 2]);
  });
});

describe('SCRUM-58 AC6: flagging only marks, it never changes a booking', () => {
  /*
   * AC:       SCRUM-58 AC6
   * Scenario: Two bookings are flagged.
   * Setup:    A and B as in US58-U01, with a copy of both rows taken beforehand.
   * Expected: After flagging, venue, event, status, start and end are identical to the copy;
   *           only needs_review (and updated_at) changed; both rows still exist.
   * Type:     normal
   */
  it('US58-F01: venue, date, time and status are unchanged after flagging', async () => {
    tables.venue_bookings.push(booking(1, '10:00', '12:00'), booking(2, '12:30', '14:00'));
    const before = tables.venue_bookings.map((item) => ({ ...item }));

    await venuesService.flagBookingsClashingUnderVenueTimes({ id: 1 }, venueTimes(30, 30), NOW);

    expect(tables.venue_bookings).toHaveLength(2);
    tables.venue_bookings.forEach((after, index) => {
      ['id', 'event_id', 'venue_id', 'status', 'start_at', 'end_at'].forEach((field) => {
        expect(after[field]).toBe(before[index][field]);
      });
    });
    // The only fields the flag writes.
    db.updateById.mock.calls.forEach(([table, , patch]) => {
      expect(table).toBe('venue_bookings');
      expect(Object.keys(patch).sort()).toEqual(['needs_review', 'updated_at']);
    });
  });

  /*
   * AC:       SCRUM-58 AC1 + decision: flags are never cleared automatically
   * Scenario: One booking is already flagged (for example by a critical-change review) and
   *           the other pair clashes now.
   * Setup:    A already needs_review, clear of everything; B and C clash under 30/30.
   * Expected: A keeps its flag and is not rewritten; B and C get flagged; the audit lists B, C.
   * Type:     boundary
   */
  it('US58-F02: an existing flag is kept and not rewritten', async () => {
    tables.venue_bookings.push(
      booking(1, '08:00', '09:00', { needs_review: true }),
      booking(2, '12:00', '14:00'),
      booking(3, '14:30', '16:00')
    );

    const ids = await venuesService.flagBookingsClashingUnderVenueTimes(
      { id: 1 }, venueTimes(30, 30), NOW
    );

    expect(row(1).needs_review).toBe(true);
    expect(db.updateById.mock.calls.map(([, id]) => id).sort()).toEqual([2, 3]);
    expect(ids.sort()).toEqual([2, 3]);
    expect(audit.writeAudit).toHaveBeenCalledWith(
      1, 'VENUE_BOOKINGS_FLAGGED', 'venue', 1,
      expect.objectContaining({ bookingIds: expect.arrayContaining([2, 3]) })
    );
  });

  /*
   * AC:       SCRUM-58 AC1 (a clashing booking that is already flagged is still reported)
   * Scenario: The clashing pair were already flagged earlier.
   * Setup:    A and B clash under 30/30 and both already have needs_review.
   * Expected: Both ids are returned (so the caller can say they need attention) but nothing
   *           is rewritten.
   * Type:     boundary
   */
  it('US58-F03: already flagged clashing bookings are reported but not rewritten', async () => {
    tables.venue_bookings.push(
      booking(1, '10:00', '12:00', { needs_review: true }),
      booking(2, '12:30', '14:00', { needs_review: true })
    );

    const ids = await venuesService.flagBookingsClashingUnderVenueTimes(
      { id: 1 }, venueTimes(30, 30), NOW
    );

    expect(ids.sort()).toEqual([1, 2]);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-58 AC1 (failure handling)
   * Scenario: The database cannot be read while checking the bookings.
   * Setup:    fetchMany rejects with a database error.
   * Expected: The error is thrown to the caller and no booking is written.
   * Type:     error
   */
  it('US58-F04: a database error is thrown and nothing is flagged', async () => {
    db.fetchMany.mockRejectedValueOnce(new Error('db down'));

    await expect(
      venuesService.flagBookingsClashingUnderVenueTimes({ id: 1 }, venueTimes(30, 30), NOW)
    ).rejects.toThrow('db down');
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

describe('SCRUM-58 saving the venue through the real route (AC1, AC5, AC6)', () => {
  const app = createApp();

  function patchVenue(body, user = USERS.venueStaff) {
    return request(app)
      .patch('/api/venues/1')
      .set('Cookie', cookieFor(user))
      .send(body);
  }

  // Event 1 (Coordinator A) and Event 2 (Coordinator B) clash under 30/30; event 3 is clear.
  function seedClash() {
    tables.venue_bookings.push(
      booking(1, '10:00', '12:00', { event_id: 1 }),
      booking(2, '12:30', '14:00', { event_id: 2 }),
      booking(3, '18:00', '20:00', { event_id: 3 })
    );
  }

  /*
   * AC:       SCRUM-58 AC1, AC5 (Venue Staff list)
   * Scenario: Venue Staff save 30/30 on Helix Hall, then open the venue bookings list.
   * Setup:    Bookings 1 and 2 clash under 30/30; booking 3 is clear.
   * Expected: PATCH returns 200 with flaggedBookingIds [1, 2]; the bookings list shows
   *           needs_review true for 1 and 2 and false for 3.
   * Type:     normal
   */
  it('US58-R01: saving the times flags the clash and Venue Staff see it in the list', async () => {
    seedClash();

    const saved = await patchVenue({ setupMinutes: 30, teardownMinutes: 30 });

    expect(saved.status).toBe(200);
    expect(saved.body.venue.setupMinutes).toBe(30);
    expect([...saved.body.venue.flaggedBookingIds].sort()).toEqual([1, 2]);

    const list = await request(app)
      .get('/api/venues/bookings')
      .set('Cookie', cookieFor(USERS.venueStaff));
    expect(list.status).toBe(200);
    const flagByBooking = Object.fromEntries(list.body.bookings.map((item) => [item.id, item.needs_review]));
    expect(flagByBooking).toEqual({ 1: true, 2: true, 3: false });
  });

  /*
   * AC:       SCRUM-58 AC5 (Coordinator view)
   * Scenario: After the save, each Coordinator opens their own event's bookings.
   * Setup:    Event 1 is Coordinator A's, event 2 is Coordinator B's, event 3 is A's but clear.
   * Expected: A sees event 1's booking flagged; B sees event 2's booking flagged; A sees
   *           event 3's booking not flagged.
   * Type:     normal
   */
  it('US58-R02: each Coordinator sees their own event booking flagged', async () => {
    seedClash();
    await patchVenue({ setupMinutes: 30, teardownMinutes: 30 });

    const forEvent = async (eventId, user) => {
      const res = await request(app)
        .get(`/api/events/${eventId}/venue-bookings`)
        .set('Cookie', cookieFor(user));
      expect(res.status).toBe(200);
      return res.body.bookings.map((item) => item.needs_review);
    };

    expect(await forEvent(1, USERS.coordinatorA)).toEqual([true]);
    expect(await forEvent(2, USERS.coordinatorB)).toEqual([true]);
    expect(await forEvent(3, USERS.coordinatorA)).toEqual([false]);
  });

  /*
   * AC:       SCRUM-58 AC6
   * Scenario: The flagging save is done; check the stored bookings.
   * Setup:    Same clash as US58-R01.
   * Expected: All three bookings still exist and are still APPROVED at venue 1 with the
   *           same start and end times.
   * Type:     normal
   */
  it('US58-R03: saving the times does not cancel, move or remove any booking', async () => {
    seedClash();
    const before = tables.venue_bookings.map((item) => ({ ...item }));

    await patchVenue({ setupMinutes: 30, teardownMinutes: 30 });

    expect(tables.venue_bookings).toHaveLength(3);
    tables.venue_bookings.forEach((after, index) => {
      expect(after.status).toBe('APPROVED');
      expect(after.venue_id).toBe(before[index].venue_id);
      expect(after.start_at).toBe(before[index].start_at);
      expect(after.end_at).toBe(before[index].end_at);
    });
  });

  /*
   * AC:       SCRUM-58 AC1 ("when a venue's setup or turnaround time is saved")
   * Scenario: Venue Staff change only the venue's name.
   * Setup:    The venue's times are already 30/30 and two bookings already overlap under them.
   * Expected: 200 and no flag, with no flaggedBookingIds in the response: the check runs
   *           only when a time is part of the save.
   * Type:     boundary
   */
  it('US58-R04: saving other details does not run the check', async () => {
    tables.venues[0].setup_minutes = 30;
    tables.venues[0].teardown_minutes = 30;
    seedClash();

    const saved = await patchVenue({ name: 'Helix Hall East' });

    expect(saved.status).toBe(200);
    expect(saved.body.venue).not.toHaveProperty('flaggedBookingIds');
    expect(flaggedIds()).toEqual([]);
  });

  /*
   * AC:       SCRUM-58 AC1 ("new or changed" times)
   * Scenario: Venue Staff rename the venue in the Update venue form, which sends the unchanged
   *           setup and turnaround values along with the new name.
   * Setup:    The venue is already 30/30 and two bookings overlap under those times; the PATCH
   *           body carries setupMinutes 30, teardownMinutes 30 and a new name, as the form does.
   * Expected: 200 and no flag: the times did not change, so this save did not cause the overlap.
   * Type:     boundary
   */
  it('US58-R08: re-sending unchanged times with another edit does not run the check', async () => {
    tables.venues[0].setup_minutes = 30;
    tables.venues[0].teardown_minutes = 30;
    seedClash();

    const saved = await patchVenue({ name: 'Helix Hall East', setupMinutes: 30, teardownMinutes: 30 });

    expect(saved.status).toBe(200);
    expect(saved.body.venue).not.toHaveProperty('flaggedBookingIds');
    expect(flaggedIds()).toEqual([]);
  });

  /*
   * AC:       SCRUM-58 AC1 (either time changing is enough)
   * Scenario: Venue Staff change only the turnaround time; the setup time is sent unchanged.
   * Setup:    The venue is 0/0; the PATCH sends setupMinutes 0 and teardownMinutes 45. Bookings
   *           1 and 2 are 30 minutes apart, so they clash once turnaround is 45 (at 30 they
   *           would only touch).
   * Expected: 200 and both bookings flagged.
   * Type:     boundary
   */
  it('US58-R09: changing only one of the two times still runs the check', async () => {
    seedClash();

    const saved = await patchVenue({ setupMinutes: 0, teardownMinutes: 45 });

    expect(saved.status).toBe(200);
    expect([...saved.body.venue.flaggedBookingIds].sort()).toEqual([1, 2]);
    expect(flaggedIds()).toEqual([1, 2]);
  });

  /*
   * AC:       SCRUM-58 AC3
   * Scenario: Venue Staff save times that leave every booking clear.
   * Setup:    Bookings 1 and 2 are 30 minutes apart; the new times are 5/5.
   * Expected: 200, flaggedBookingIds is an empty list and no booking is flagged.
   * Type:     normal
   */
  it('US58-R05: a save that creates no overlap flags nothing', async () => {
    seedClash();

    const saved = await patchVenue({ setupMinutes: 5, teardownMinutes: 5 });

    expect(saved.status).toBe(200);
    expect(saved.body.venue.flaggedBookingIds).toEqual([]);
    expect(flaggedIds()).toEqual([]);
  });

  /*
   * AC:       SCRUM-58 AC1 (a rejected save flags nothing)
   * Scenario: Venue Staff send a negative setup time.
   * Setup:    Bookings that would clash under valid 30/30 times.
   * Expected: 400 and no booking flagged; the venue's saved times are unchanged.
   * Type:     error
   */
  it('US58-R06: a rejected save flags nothing', async () => {
    seedClash();

    const saved = await patchVenue({ setupMinutes: -5, teardownMinutes: 30 });

    expect(saved.status).toBe(400);
    expect(flaggedIds()).toEqual([]);
    expect(tables.venues[0].setup_minutes).toBe(0);
  });

  /*
   * AC:       SCRUM-58 AC1 (only Venue Staff can save the times)
   * Scenario: A Coordinator tries to change the venue's times.
   * Setup:    Bookings that would clash under 30/30.
   * Expected: 403, no booking flagged, venue times unchanged.
   * Type:     error
   */
  it('US58-R07: a user who is not Venue Staff cannot trigger flagging', async () => {
    seedClash();

    const saved = await patchVenue({ setupMinutes: 30, teardownMinutes: 30 }, USERS.coordinatorA);

    expect(saved.status).toBe(403);
    expect(flaggedIds()).toEqual([]);
    expect(tables.venues[0].setup_minutes).toBe(0);
  });
});

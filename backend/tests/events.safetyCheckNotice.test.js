/**
 * SCRUM-81: notify Safety Officers when an event is ready for its safety check,
 * and notify the event's Coordinator and Organiser of the outcome.
 *
 *   AC1  When arrangements are ready and the event is sent to Awaiting Safety Check,
 *        every active Safety Officer is notified.
 *   AC2  No readiness notice when venues/equipment are not ready (status change refused).
 *   AC3  Approve notifies Coordinator and Organiser.
 *   AC4  Reject notifies them and includes the reason.
 *   AC5  Request-changes notifies them with reason and affected arrangements.
 *   AC6  Sending to safety check again after request-changes notifies SOs again.
 *   AC7  Only SOs (readiness) and the event's own Coordinator/Organiser (outcome).
 *
 * Product rules confirmed: notify on Send to safety check (not on last booking approve);
 * all users with SAFETY_OFFICER; Coordinator and Organiser are distinct contacts.
 *
 * Database is mocked; real notifyUser runs so notification rows are asserted via insertOne.
 */
const { ROLES } = require('../src/constants/roles');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  updateById: jest.fn(),
  insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => {
  const actual = jest.requireActual('../src/services/audit.service');
  return { writeAudit: jest.fn(), notifyUser: actual.notifyUser };
});

const db = require('../src/config/db');
const access = require('../src/services/access.service');
const events = require('../src/services/events.service');

const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const safetyOfficer = { id: 12, roles: [ROLES.SAFETY_OFFICER] };

let event;
let tables;

function queryFor(table) {
  const query = {
    table,
    filters: [],
    inFilters: [],
  };
  query.select = jest.fn(() => query);
  query.eq = jest.fn((column, value) => {
    query.filters.push(['eq', column, value]);
    return query;
  });
  query.in = jest.fn((column, values) => {
    query.inFilters.push([column, values.map(String)]);
    return query;
  });
  query.order = jest.fn(() => query);
  query.is = jest.fn(() => query);
  query.not = jest.fn(() => query);
  query.neq = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  return query;
}

function matchingRows(query) {
  let rows = (tables[query.table] || []).filter((row) =>
    query.filters.every(([op, column, value]) => {
      if (op === 'eq') return String(row[column]) === String(value);
      return true;
    })
    && query.inFilters.every(([column, values]) => values.includes(String(row[column])))
  );
  return rows;
}

function notificationRows() {
  return db.insertOne.mock.calls
    .filter(([table]) => table === 'notifications')
    .map(([, row]) => row);
}

function safetyOutcomeNotices() {
  return notificationRows().filter((row) => row.type === 'SAFETY_CHECK_OUTCOME');
}

function safetyReadyNotices() {
  return notificationRows().filter((row) => row.type === 'SAFETY_CHECK_READY');
}

beforeEach(() => {
  jest.clearAllMocks();
  event = {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    name: 'Workshop',
    status: 'PLANNING',
    expected_attendance: 80,
    accessibility_needs: 'Step-free access',
    start_at: '2026-11-20T10:00:00.000Z',
  };
  tables = {
    events: [event],
    venue_bookings: [{
      id: 7,
      event_id: 3,
      status: 'APPROVED',
      start_at: '2026-11-20T10:00:00.000Z',
      end_at: '2026-11-20T12:00:00.000Z',
      venues: {
        id: 1,
        name: 'Orchid',
        capacity: 100,
        accessibility: 'Lift',
        venue_layouts: [{ layout: 'Theatre' }],
      },
    }],
    equipment_requests: [{
      id: 21,
      event_id: 3,
      quantity: 2,
      status: 'RESERVED',
      notes: null,
      equipment: { id: 5, name: 'Wireless mic', type: 'AUDIO' },
    }],
    safety_checks: [],
    event_status_history: [],
    users: [
      { id: 1, is_active: true },
      { id: 2, is_active: true },
      { id: 12, is_active: true },
      { id: 13, is_active: true },
      { id: 14, is_active: false },
    ],
    user_roles: [
      { user_id: 1, role: ROLES.EVENT_ORGANISER },
      { user_id: 2, role: ROLES.EVENT_COORDINATOR },
      { user_id: 12, role: ROLES.SAFETY_OFFICER },
      { user_id: 13, role: ROLES.SAFETY_OFFICER },
      { user_id: 14, role: ROLES.SAFETY_OFFICER },
    ],
  };

  db.supabase.from.mockImplementation(queryFor);
  db.fetchOne.mockImplementation(async (query) => {
    const row = matchingRows(query)[0];
    return row ? { ...row } : null;
  });
  db.fetchMany.mockImplementation(async (query) => matchingRows(query).map((row) => ({ ...row })));
  db.updateById.mockImplementation(async (table, id, patch) => {
    const row = (tables[table] || []).find((item) => String(item.id) === String(id));
    if (row) Object.assign(row, patch);
    return row;
  });
  db.insertOne.mockImplementation(async (table, row) => {
    const saved = { id: (tables[table]?.length || 0) + 1, ...row };
    tables[table] = [...(tables[table] || []), saved];
    return saved;
  });
});

describe('SCRUM-81 safety-check readiness notices', () => {
  /*
   * AC:       SCRUM-81 AC1, AC7
   * Scenario: Coordinator sends a ready event to Awaiting Safety Check.
   * Setup:    Approved venue + reserved equipment; active SO users 12 and 13; inactive SO 14.
   * Expected: One SAFETY_CHECK_READY notice each to 12 and 13 (not 14, not coord/organiser).
   * Type:     normal
   */
  it('notifies every active Safety Officer when the event is sent to safety check', async () => {
    await events.changeStatus(coordinator, 3, 'AWAITING_SAFETY_CHECK');
    const ready = safetyReadyNotices();
    expect(ready).toHaveLength(2);
    expect(ready.map((row) => row.user_id).sort()).toEqual([12, 13]);
    expect(ready.every((row) => row.event_id === 3)).toBe(true);
    expect(ready[0]).toEqual(expect.objectContaining({
      type: 'SAFETY_CHECK_READY',
      title: 'Event ready for safety check',
      body: expect.stringContaining('Workshop'),
    }));
    // AC7: readiness notices are SO-only.
    expect(ready.every((row) => row.user_id !== 1 && row.user_id !== 2)).toBe(true);
  });

  /*
   * AC:       SCRUM-81 AC2
   * Scenario: Coordinator tries to send to safety check while a venue is still pending.
   * Setup:    Booking PENDING; equipment reserved.
   * Expected: 409; no SAFETY_CHECK_READY notification rows.
   * Type:     error
   */
  it('does not notify Safety Officers when a venue booking is not approved', async () => {
    tables.venue_bookings[0].status = 'PENDING';
    await expect(
      events.changeStatus(coordinator, 3, 'AWAITING_SAFETY_CHECK')
    ).rejects.toMatchObject({ status: 409, code: 'NOT_READY_FOR_SAFETY_CHECK' });
    expect(safetyReadyNotices()).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-81 AC2
   * Scenario: Coordinator tries to send to safety check while equipment is not reserved.
   * Setup:    Booking APPROVED; equipment request PENDING.
   * Expected: 409; no SAFETY_CHECK_READY notification rows.
   * Type:     error
   */
  it('does not notify Safety Officers when requested equipment is not reserved', async () => {
    tables.equipment_requests[0].status = 'PENDING';
    await expect(
      events.changeStatus(coordinator, 3, 'AWAITING_SAFETY_CHECK')
    ).rejects.toMatchObject({ status: 409, code: 'NOT_READY_FOR_SAFETY_CHECK' });
    expect(safetyReadyNotices()).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-81 AC1
   * Scenario: Event is sent to safety check but no active Safety Officer exists.
   * Setup:    Remove all SAFETY_OFFICER role rows (arrangements still ready).
   * Expected: Status still moves to Awaiting; zero SAFETY_CHECK_READY notices.
   * Type:     boundary
   */
  it('sends no readiness notice when there is no active Safety Officer', async () => {
    tables.user_roles = tables.user_roles.filter((row) => row.role !== ROLES.SAFETY_OFFICER);
    await events.changeStatus(coordinator, 3, 'AWAITING_SAFETY_CHECK');
    expect(event.status).toBe('AWAITING_SAFETY_CHECK');
    expect(safetyReadyNotices()).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-81 AC6
   * Scenario: After request-changes returned the event to Planning, Coordinator sends again.
   * Setup:    First send notifies SOs; record REQUEST_CHANGES (arrangements stay ready;
   *           event returns to Planning); send to Awaiting again.
   * Expected: A second SAFETY_CHECK_READY wave to the same active SOs.
   * Type:     normal
   */
  it('notifies Safety Officers again when the event is sent to safety check a second time', async () => {
    await events.changeStatus(coordinator, 3, 'AWAITING_SAFETY_CHECK');
    expect(safetyReadyNotices()).toHaveLength(2);

    await access.recordSafetyCheck(safetyOfficer, 3, {
      outcome: 'REQUEST_CHANGES',
      reason: 'Need a larger room',
      affectedArrangements: [{ type: 'VENUE_BOOKING', id: 7 }],
    });
    expect(event.status).toBe('PLANNING');

    await events.changeStatus(coordinator, 3, 'AWAITING_SAFETY_CHECK');
    expect(safetyReadyNotices()).toHaveLength(4);
    expect(safetyReadyNotices().filter((row) => row.user_id === 12)).toHaveLength(2);
  });
});

describe('SCRUM-81 safety-check outcome notices', () => {
  beforeEach(async () => {
    event.status = 'AWAITING_SAFETY_CHECK';
  });

  /*
   * AC:       SCRUM-81 AC3, AC7
   * Scenario: Safety Officer approves the check.
   * Setup:    Event awaiting; organiser 1 and coordinator 2; active SOs also in the DB.
   * Expected: SAFETY_CHECK_OUTCOME to 1 and 2 only; no outcome notice to SOs or others.
   * Type:     normal
   */
  it('notifies Coordinator and Organiser when the safety check is approved', async () => {
    await access.recordSafetyCheck(safetyOfficer, 3, { outcome: 'APPROVE' });
    const outcomes = safetyOutcomeNotices();
    expect(outcomes).toHaveLength(2);
    expect(outcomes.map((row) => row.user_id).sort()).toEqual([1, 2]);
    expect(outcomes[0]).toEqual(expect.objectContaining({
      type: 'SAFETY_CHECK_OUTCOME',
      title: 'Safety check approved',
      body: expect.stringContaining('Workshop'),
      event_id: 3,
    }));
    expect(outcomes.every((row) => row.user_id !== 12 && row.user_id !== 13)).toBe(true);
  });

  /*
   * AC:       SCRUM-81 AC4, AC7
   * Scenario: Safety Officer rejects with a reason.
   * Setup:    Reason "Crowd density too high for exits".
   * Expected: Notices to Coordinator and Organiser that include that reason.
   * Type:     normal
   */
  it('notifies Coordinator and Organiser of a rejection including the reason', async () => {
    await access.recordSafetyCheck(safetyOfficer, 3, {
      outcome: 'REJECT',
      reason: 'Crowd density too high for exits',
    });
    const outcomes = safetyOutcomeNotices();
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((row) => row.body.includes('Crowd density too high for exits'))).toBe(true);
    expect(outcomes[0].title).toBe('Safety check rejected');
  });

  /*
   * AC:       SCRUM-81 AC5, AC7
   * Scenario: Safety Officer requests changes with a venue booking selected.
   * Setup:    Reason and affectedArrangements [{ VENUE_BOOKING, 7 }].
   * Expected: Notices include the reason and venue booking #7; only contacts 1 and 2.
   * Type:     normal
   */
  it('notifies Coordinator and Organiser of request-changes with reason and arrangements', async () => {
    await access.recordSafetyCheck(safetyOfficer, 3, {
      outcome: 'REQUEST_CHANGES',
      reason: 'Need a larger room',
      affectedArrangements: [{ type: 'VENUE_BOOKING', id: 7 }],
    });
    const outcomes = safetyOutcomeNotices();
    expect(outcomes).toHaveLength(2);
    expect(outcomes.map((row) => row.user_id).sort()).toEqual([1, 2]);
    expect(outcomes[0].title).toBe('Safety check: changes requested');
    expect(outcomes[0].body).toContain('Need a larger room');
    expect(outcomes[0].body).toContain('venue booking #7');
  });

  /*
   * AC:       SCRUM-81 AC7
   * Scenario: Approve when the event somehow has no organiser id.
   * Setup:    organiser_id null; coordinator_id 2.
   * Expected: Only the Coordinator is notified (one outcome notice).
   * Type:     boundary
   */
  it('skips a missing organiser when notifying the safety outcome', async () => {
    event.organiser_id = null;
    await access.recordSafetyCheck(safetyOfficer, 3, { outcome: 'APPROVE' });
    expect(safetyOutcomeNotices()).toEqual([
      expect.objectContaining({ user_id: 2, type: 'SAFETY_CHECK_OUTCOME' }),
    ]);
  });

  /*
   * AC:       SCRUM-81 AC7
   * Scenario: Approve when the event somehow has no coordinator id.
   * Setup:    coordinator_id null; organiser_id 1.
   * Expected: Only the Organiser is notified (one outcome notice).
   * Type:     boundary
   */
  it('skips a missing coordinator when notifying the safety outcome', async () => {
    event.coordinator_id = null;
    await access.recordSafetyCheck(safetyOfficer, 3, { outcome: 'APPROVE' });
    expect(safetyOutcomeNotices()).toEqual([
      expect.objectContaining({ user_id: 1, type: 'SAFETY_CHECK_OUTCOME' }),
    ]);
  });

  /*
   * AC:       SCRUM-81 AC7
   * Scenario: Outcome notices must not go to an organiser of a different event.
   * Setup:    User 99 is an organiser in another organisation; event contacts stay 1 and 2.
   * Expected: SAFETY_CHECK_OUTCOME only for 1 and 2; user 99 never appears.
   * Type:     boundary
   */
  it('does not notify an organiser of another event about the outcome', async () => {
    tables.users.push({ id: 99, is_active: true });
    tables.user_roles.push({ user_id: 99, role: ROLES.EVENT_ORGANISER });
    await access.recordSafetyCheck(safetyOfficer, 3, { outcome: 'APPROVE' });
    const outcomes = safetyOutcomeNotices();
    expect(outcomes.map((row) => row.user_id).sort()).toEqual([1, 2]);
    expect(outcomes.every((row) => row.user_id !== 99)).toBe(true);
  });
});

describe('SCRUM-81 notice text helpers', () => {
  /*
   * AC:       SCRUM-81 AC1
   * Scenario: Ready-notice wording names the event.
   * Setup:    Event name "Helix Summit".
   * Expected: Title and body identify readiness for a safety check.
   * Type:     normal
   */
  it('builds a readiness notice that names the event', () => {
    expect(access.buildSafetyReadyNotice('Helix Summit')).toEqual({
      title: 'Event ready for safety check',
      body: 'Helix Summit is ready for its safety check. Open the Safety queue to review it.',
    });
  });

  /*
   * AC:       SCRUM-81 AC5
   * Scenario: Request-changes notice lists venue and equipment arrangement ids.
   * Setup:    One venue booking and one equipment request in affectedArrangements.
   * Expected: Body includes both arrangement labels and the reason.
   * Type:     normal
   */
  it('builds a request-changes notice that lists arrangements', () => {
    const notice = access.buildSafetyOutcomeNotice({
      outcome: 'REQUEST_CHANGES',
      eventName: 'Workshop',
      reason: 'Swap the room',
      affectedArrangements: [
        { type: 'VENUE_BOOKING', id: 7 },
        { type: 'EQUIPMENT_REQUEST', id: 21 },
      ],
    });
    expect(notice.title).toBe('Safety check: changes requested');
    expect(notice.body).toContain('Swap the room');
    expect(notice.body).toContain('venue booking #7');
    expect(notice.body).toContain('equipment request #21');
  });
});

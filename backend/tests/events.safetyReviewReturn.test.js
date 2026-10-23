/**
 * SCRUM-58: a request for changes returns the event to Planning and marks the
 * arrangements the Safety Officer selected. Those marks keep it off the safety
 * queue until each one is reviewed again. Reviewing again does not change the
 * booking or the reservation.
 */
jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  updateById: jest.fn(),
  updateByIdWhere: jest.fn(),
  insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn(),
  notifyUser: jest.fn(),
}));

const db = require('../src/config/db');
const audit = require('../src/services/audit.service');
const access = require('../src/services/access.service');
const events = require('../src/services/events.service');
const venues = require('../src/services/venues.service');
const equipment = require('../src/services/equipment.service');
const { ROLES } = require('../src/constants/roles');

const safetyOfficer = { id: 12, roles: [ROLES.SAFETY_OFFICER] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const venueStaff = { id: 40, roles: [ROLES.VENUE_STAFF] };
const tech = { id: 41, roles: [ROLES.TECHNICAL_SUPPORT] };

let event;
let booking;
let kit;
let tables;

function queryFor(table) {
  const query = {
    table,
    filters: [],
    inFilters: [],
    excluded: [],
    orderCol: null,
    orderAsc: true,
    limitCount: null,
  };
  query.select = jest.fn(() => query);
  query.eq = jest.fn((column, value) => {
    query.filters.push(['eq', column, value]);
    return query;
  });
  query.neq = jest.fn((column, value) => {
    query.excluded.push([column, value]);
    return query;
  });
  query.in = jest.fn((column, values) => {
    query.inFilters.push([column, values.map(String)]);
    return query;
  });
  query.is = jest.fn((column, value) => {
    query.filters.push(['is', column, value]);
    return query;
  });
  query.not = jest.fn(() => query);
  query.order = jest.fn((column, opts = {}) => {
    query.orderCol = column;
    query.orderAsc = opts.ascending !== false;
    return query;
  });
  query.limit = jest.fn((n) => {
    query.limitCount = n;
    return query;
  });
  query.or = jest.fn(() => query);
  return query;
}

function matchingRows(query) {
  let rows = (tables[query.table] || []).filter((row) =>
    query.filters.every(([op, column, value]) => {
      if (op === 'is') return row[column] == null;
      return String(row[column]) === String(value);
    })
    && query.inFilters.every(([column, values]) => values.includes(String(row[column])))
    && query.excluded.every(([column, value]) => String(row[column]) !== String(value))
  );
  if (query.orderCol) {
    rows = [...rows].sort((a, b) => {
      const av = a[query.orderCol];
      const bv = b[query.orderCol];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return query.orderAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }
  if (query.limitCount != null) rows = rows.slice(0, query.limitCount);
  return rows;
}

beforeEach(() => {
  jest.clearAllMocks();
  event = {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    name: 'Workshop',
    status: 'AWAITING_SAFETY_CHECK',
    expected_attendance: 80,
    start_at: '2026-11-20T10:00:00.000Z',
    end_at: '2026-11-20T12:00:00.000Z',
  };
  booking = {
    id: 7,
    event_id: 3,
    venue_id: 1,
    status: 'APPROVED',
    needs_review: false,
    start_at: '2026-11-20T10:00:00.000Z',
    end_at: '2026-11-20T12:00:00.000Z',
    setup_minutes: 30,
    teardown_minutes: 30,
  };
  kit = {
    id: 21,
    event_id: 3,
    equipment_id: 5,
    quantity: 2,
    status: 'RESERVED',
    needs_review: false,
    notes: 'Two mics',
  };
  tables = {
    events: [event],
    venue_bookings: [booking],
    equipment_requests: [kit],
    equipment_reservations: [],
    equipment: [{ id: 5, name: 'Wireless mic', quantity: 8, status: 'AVAILABLE' }],
    venues: [{ id: 1, name: 'Orchid' }],
    safety_checks: [],
    event_status_history: [],
    users: [
      { id: 1, is_active: true },
      { id: 2, is_active: true },
      { id: 12, is_active: true },
    ],
    user_roles: [
      { user_id: 2, role: ROLES.EVENT_COORDINATOR },
      { user_id: 12, role: ROLES.SAFETY_OFFICER },
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
    return row ? { ...row } : null;
  });
  db.updateByIdWhere.mockImplementation(async (table, id, patch, where = {}) => {
    const row = (tables[table] || []).find((item) => String(item.id) === String(id));
    if (!row) return null;
    if (Object.entries(where).some(([column, value]) => String(row[column]) !== String(value))) {
      return null;
    }
    Object.assign(row, patch);
    return { ...row };
  });
  db.insertOne.mockImplementation(async (table, row) => {
    const saved = { id: (tables[table]?.length || 0) + 1, ...row };
    tables[table] = [...(tables[table] || []), saved];
    return saved;
  });
});

describe('SCRUM-58 request changes marks arrangements and returns to Planning', () => {
  /*
   * AC:       SCRUM-58 AC1, AC2, AC4
   * Scenario: The Safety Officer requests changes and selects the venue booking.
   * Setup:    Event is Awaiting Safety Check. Booking 7 is APPROVED. Equipment 21 is RESERVED.
   * Expected: Event status is Planning. Booking 7 is marked for review. Its status, venue and
   *           times are unchanged.
   * Type:     normal
   */
  it('US58-A01 (AC1, AC2, AC4): request changes marks the selected booking and leaves its details', async () => {
    await access.recordSafetyCheck(safetyOfficer, 3, {
      outcome: 'REQUEST_CHANGES',
      reason: 'Move the stage',
      affectedArrangements: [{ type: 'VENUE_BOOKING', id: 7 }],
    });

    expect(event.status).toBe('PLANNING');
    expect(booking.needs_review).toBe(true);
    expect(booking.status).toBe('APPROVED');
    expect(booking.venue_id).toBe(1);
    expect(booking.start_at).toBe('2026-11-20T10:00:00.000Z');
    expect(booking.end_at).toBe('2026-11-20T12:00:00.000Z');
  });

  /*
   * AC:       SCRUM-58 AC3
   * Scenario: Only the venue booking was selected.
   * Setup:    Same event. Equipment request 21 was not in the selection.
   * Expected: The equipment request is not marked and stays RESERVED.
   * Type:     normal
   */
  it('US58-A02 (AC3): an arrangement that was not selected is left alone', async () => {
    await access.recordSafetyCheck(safetyOfficer, 3, {
      outcome: 'REQUEST_CHANGES',
      reason: 'Move the stage',
      affectedArrangements: [{ type: 'VENUE_BOOKING', id: 7 }],
    });

    expect(kit.needs_review).toBe(false);
    expect(kit.status).toBe('RESERVED');
    expect(kit.quantity).toBe(2);
  });

  /*
   * AC:       SCRUM-58 AC2, AC4
   * Scenario: The Safety Officer selects the equipment request only.
   * Setup:    Equipment request 21 is RESERVED with quantity 2.
   * Expected: That request is marked. Status and quantity stay the same. No reservation row is added.
   * Type:     normal
   */
  it('US58-A03 (AC2, AC4): the selected equipment request is marked and not edited', async () => {
    await access.recordSafetyCheck(safetyOfficer, 3, {
      outcome: 'REQUEST_CHANGES',
      reason: 'Wrong kit',
      affectedArrangements: [{ type: 'EQUIPMENT_REQUEST', id: 21 }],
    });

    expect(kit.needs_review).toBe(true);
    expect(kit.status).toBe('RESERVED');
    expect(kit.quantity).toBe(2);
    expect(booking.needs_review).toBe(false);
    expect(tables.equipment_reservations).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-58 AC2
   * Scenario: The Safety Officer approves instead of requesting changes.
   * Setup:    Both arrangements are ready and unmarked.
   * Expected: Neither arrangement is marked.
   * Type:     boundary
   */
  it('US58-A04 (AC2): approving does not mark any arrangement', async () => {
    await access.recordSafetyCheck(safetyOfficer, 3, { outcome: 'APPROVE' });
    expect(booking.needs_review).toBe(false);
    expect(kit.needs_review).toBe(false);
  });
});

describe('SCRUM-58 safety queue hides an event until every mark is cleared', () => {
  /*
   * AC:       SCRUM-58 AC5
   * Scenario: The event is awaiting a safety check but one booking still needs review.
   * Setup:    Status AWAITING_SAFETY_CHECK. Booking needs_review true. Equipment is clear.
   * Expected: The Safety Officer queue does not include the event.
   * Type:     normal
   */
  it('US58-Q01 (AC5): any review mark keeps the event off the safety queue', async () => {
    booking.needs_review = true;
    const rows = await access.listSafetyQueue(safetyOfficer);
    expect(rows.map((row) => row.id)).not.toContain(3);
  });

  /*
   * AC:       SCRUM-58 AC6
   * Scenario: Every marked arrangement has been reviewed. The event is awaiting a safety check.
   * Setup:    Status AWAITING_SAFETY_CHECK. Both needs_review flags are false. Arrangements are ready.
   * Expected: The event is on the Safety Officer queue.
   * Type:     normal
   */
  it('US58-Q02 (AC6): the event returns to the queue once every mark is cleared', async () => {
    const rows = await access.listSafetyQueue(safetyOfficer);
    expect(rows.map((row) => row.id)).toContain(3);
  });

  /*
   * AC:       SCRUM-58 AC5
   * Scenario: The Coordinator sends the event back while a mark is still set.
   * Setup:    Event is Planning. Booking is APPROVED and needs_review. Equipment is RESERVED.
   * Expected: The send succeeds. The queue still omits the event, because the mark remains.
   * Type:     normal
   */
  it('US58-Q03 (AC5): sending back while a mark is set leaves the event off the queue', async () => {
    event.status = 'PLANNING';
    booking.needs_review = true;

    const updated = await events.changeStatus(coordinator, 3, 'AWAITING_SAFETY_CHECK');

    expect(updated.status).toBe('AWAITING_SAFETY_CHECK');
    expect(booking.needs_review).toBe(true);
    const rows = await access.listSafetyQueue(safetyOfficer);
    expect(rows.map((row) => row.id)).not.toContain(3);
  });
});

describe('SCRUM-58 reviewing a marked arrangement clears the mark only', () => {
  /*
   * AC:       SCRUM-58 AC4, AC6
   * Scenario: Venue Staff approve a booking that is already approved and marked.
   * Setup:    Booking 7 is APPROVED with needs_review. Signed in as Venue Staff.
   * Expected: The mark clears. Status, venue and times stay. The Coordinator is not notified again.
   * Type:     normal
   */
  it('US58-R01 (AC4, AC6): approving again clears the booking mark and changes nothing else', async () => {
    booking.needs_review = true;
    audit.notifyUser.mockClear();

    const updated = await venues.decideBooking(venueStaff, 7, { approve: true });

    expect(updated.needs_review).toBe(false);
    expect(updated.status).toBe('APPROVED');
    expect(booking.venue_id).toBe(1);
    expect(booking.start_at).toBe('2026-11-20T10:00:00.000Z');
    expect(booking.end_at).toBe('2026-11-20T12:00:00.000Z');
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-18 AC4 (must still hold)
   * Scenario: Venue Staff try to approve a booking that is already approved and not marked.
   * Setup:    Booking 7 is APPROVED with needs_review false.
   * Expected: 409 ALREADY_DECIDED. The booking is not written.
   * Type:     error
   */
  it('US58-R02 (AC4): an approved booking with no mark cannot be decided again', async () => {
    await expect(
      venues.decideBooking(venueStaff, 7, { approve: true })
    ).rejects.toMatchObject({ status: 409, code: 'ALREADY_DECIDED' });
    expect(booking.status).toBe('APPROVED');
  });

  /*
   * AC:       SCRUM-58 AC4
   * Scenario: Venue Staff reject a booking that is already approved and marked.
   * Setup:    Booking 7 is APPROVED with needs_review true. Decision is reject.
   * Expected: 409. Status stays APPROVED and the mark stays. Nothing is cancelled.
   * Type:     error
   */
  it('US58-R03 (AC4): rejecting a marked approved booking does not cancel it', async () => {
    booking.needs_review = true;
    await expect(
      venues.decideBooking(venueStaff, 7, { approve: false, reason: 'No' })
    ).rejects.toMatchObject({ status: 409, code: 'ALREADY_DECIDED' });
    expect(booking.status).toBe('APPROVED');
    expect(booking.needs_review).toBe(true);
  });

  /*
   * AC:       SCRUM-58 AC4, AC6
   * Scenario: Technical Support reserve an equipment request that is already reserved and marked.
   * Setup:    Request 21 is RESERVED, quantity 2, needs_review true. One reservation row already exists.
   * Expected: The mark clears. Status and quantity stay. No second reservation row is written.
   * Type:     normal
   */
  it('US58-R04 (AC4, AC6): reserving again clears the equipment mark and does not hold stock twice', async () => {
    kit.needs_review = true;
    tables.equipment_reservations.push({
      id: 1, event_id: 3, equipment_id: 5, quantity: 2,
    });

    const updated = await equipment.decideRequest(tech, 21, { approve: true });

    expect(updated.needs_review).toBe(false);
    expect(updated.status).toBe('RESERVED');
    expect(kit.quantity).toBe(2);
    expect(tables.equipment_reservations).toHaveLength(1);
  });

  /*
   * AC:       existing equipment decision rule (must still hold)
   * Scenario: Technical Support try to reserve a request that is already reserved and not marked.
   * Setup:    Request 21 is RESERVED with needs_review false.
   * Expected: 409 ALREADY_DECIDED.
   * Type:     error
   */
  it('US58-R05: a reserved request with no mark cannot be reserved again', async () => {
    await expect(
      equipment.decideRequest(tech, 21, { approve: true })
    ).rejects.toMatchObject({ status: 409, code: 'ALREADY_DECIDED' });
    expect(tables.equipment_reservations).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-58 AC4
   * Scenario: Technical Support mark a reserved request unavailable.
   * Setup:    Request 21 is RESERVED and needs_review. Decision is not approve.
   * Expected: 409. Status stays RESERVED. The mark stays.
   * Type:     error
   */
  it('US58-R06 (AC4): a marked reserved request cannot be set unavailable', async () => {
    kit.needs_review = true;
    await expect(
      equipment.decideRequest(tech, 21, { approve: false, reason: 'No stock' })
    ).rejects.toMatchObject({ status: 409, code: 'ALREADY_DECIDED' });
    expect(kit.status).toBe('RESERVED');
    expect(kit.needs_review).toBe(true);
  });
});

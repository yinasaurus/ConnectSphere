/**
 * SCRUM-55: Safety Officer reviews events awaiting a safety check.
 * SCRUM-56: Safety Officer records approve / reject / request changes.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  updateById: jest.fn(),
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
const { createApp } = require('../src/app');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

const safetyOfficer = { id: 12, roles: [ROLES.SAFETY_OFFICER] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
const otherUser = { id: 99, organisationId: 11, roles: [ROLES.EVENT_ORGANISER] };

let event;
let tables;

function queryFor(table) {
  const query = {
    table,
    filters: [],
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
        venue_layouts: [{ layout: 'Theatre' }, { layout: 'Classroom' }],
      },
    }],
    equipment_requests: [{
      id: 21,
      event_id: 3,
      quantity: 2,
      status: 'RESERVED',
      notes: 'Two mics',
      equipment: { id: 5, name: 'Wireless mic', type: 'AUDIO' },
    }],
    safety_checks: [],
    event_status_history: [],
    users: [
      { id: 1, is_active: true },
      { id: 2, is_active: true },
      { id: 12, is_active: true },
    ],
    user_roles: [
      { user_id: 1, role: ROLES.EVENT_ORGANISER },
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
    return row;
  });
  db.insertOne.mockImplementation(async (table, row) => {
    const saved = { id: (tables[table]?.length || 0) + 1, ...row };
    tables[table] = [...(tables[table] || []), saved];
    return saved;
  });
});

describe('SCRUM-55 safety queue and open', () => {
  /*
   * AC:       SCRUM-55 AC1
   * Scenario: An awaiting event with approved venue and reserved equipment is listed.
   * Setup:    Event 3 is AWAITING_SAFETY_CHECK with one APPROVED booking and one RESERVED request.
   * Expected: The Safety Officer queue contains that event.
   * Type:     normal
   */
  it('lists an awaiting event whose arrangements are ready', async () => {
    const rows = await access.listSafetyQueue(safetyOfficer);
    expect(rows).toEqual([
      expect.objectContaining({
        id: 3,
        name: 'Workshop',
        status: 'AWAITING_SAFETY_CHECK',
        expectedAttendance: 80,
      }),
    ]);
  });

  /*
   * AC:       SCRUM-55 AC1
   * Scenario: An awaiting event still has a pending venue booking.
   * Setup:    Booking status PENDING; equipment reserved.
   * Expected: The event does not appear in the queue.
   * Type:     boundary
   */
  it('hides an awaiting event when a venue booking is not approved', async () => {
    tables.venue_bookings[0].status = 'PENDING';
    const rows = await access.listSafetyQueue(safetyOfficer);
    expect(rows).toEqual([]);
  });

  /*
   * AC:       SCRUM-55 AC1
   * Scenario: An awaiting event has unreserved equipment.
   * Setup:    Booking APPROVED; equipment PENDING.
   * Expected: The event does not appear.
   * Type:     boundary
   */
  it('hides an awaiting event when requested equipment is not reserved', async () => {
    tables.equipment_requests[0].status = 'PENDING';
    const rows = await access.listSafetyQueue(safetyOfficer);
    expect(rows).toEqual([]);
  });

  /*
   * AC:       SCRUM-55 AC1
   * Scenario: A Planning event is ready but was never sent to safety check.
   * Setup:    Status PLANNING with approved booking and reserved equipment.
   * Expected: Not listed — only Awaiting Safety Check enters the queue.
   * Type:     boundary
   */
  it('does not list a Planning event even when arrangements are ready', async () => {
    event.status = 'PLANNING';
    const rows = await access.listSafetyQueue(safetyOfficer);
    expect(rows).toEqual([]);
  });

  /*
   * AC:       SCRUM-55 AC4
   * Scenario: A Coordinator opens the safety queue.
   * Expected: 403 and no event list leak from the service throw.
   * Type:     error
   */
  it('refuses the safety queue to a non Safety Officer', async () => {
    await expect(access.listSafetyQueue(coordinator)).rejects.toMatchObject({ status: 403 });
  });

  /*
   * AC:       SCRUM-55 AC2
   * Scenario: Safety Officer opens an awaiting event for review.
   * Setup:    Ready arrangements with venue layouts and equipment.
   * Expected: Attendance, accessibility, venue capacity/layouts, and equipment are returned.
   * Type:     normal
   */
  it('opens review details for an awaiting event', async () => {
    const detail = await access.openSafetyCheck(safetyOfficer, 3);
    expect(detail).toEqual(expect.objectContaining({
      eventId: 3,
      eventName: 'Workshop',
      expectedAttendance: 80,
      accessibilityNeeds: 'Step-free access',
      outcome: null,
    }));
    expect(detail.bookings[0]).toEqual(expect.objectContaining({
      capacity: 100,
      layouts: ['Theatre', 'Classroom'],
      venueName: 'Orchid',
    }));
    expect(detail.equipmentRequests[0]).toEqual(expect.objectContaining({
      equipmentName: 'Wireless mic',
      status: 'RESERVED',
      quantity: 2,
    }));
  });

  /*
   * AC:       SCRUM-55 AC4
   * Scenario: Non-SO opens a safety check.
   * Expected: 403 before any event fetch.
   * Type:     error
   */
  it('refuses openSafetyCheck for a non Safety Officer', async () => {
    await expect(access.openSafetyCheck(coordinator, 3)).rejects.toMatchObject({ status: 403 });
    expect(db.fetchOne).not.toHaveBeenCalled();
  });
});

describe('SCRUM-56 record safety outcome', () => {
  /*
   * AC:       SCRUM-56 AC1, AC4, AC6
   * Scenario: Approve with no reason.
   * Expected: Outcome APPROVED stored; event moves to PREPARATION; history and audit written.
   * Type:     normal
   */
  it('approves without a reason and moves the event to Preparation', async () => {
    const result = await access.recordSafetyCheck(safetyOfficer, 3, { outcome: 'APPROVE' });
    expect(result.outcome).toBe('APPROVED');
    expect(event.status).toBe('PREPARATION');
    expect(tables.safety_checks).toHaveLength(1);
    expect(audit.writeAudit).toHaveBeenCalledWith(
      12,
      'SAFETY_CHECK_RECORDED',
      'event',
      3,
      expect.objectContaining({ outcome: 'APPROVED', toStatus: 'PREPARATION' })
    );
  });

  /*
   * AC:       SCRUM-56 AC1, AC2, AC7
   * Scenario: Reject with a reason.
   * Expected: Event returns to PLANNING; cannot stay awaiting.
   * Type:     normal
   */
  it('rejects with a reason and returns the event to Planning', async () => {
    const result = await access.recordSafetyCheck(safetyOfficer, 3, {
      outcome: 'REJECT',
      reason: 'Crowd density too high for exits',
    });
    expect(result.outcome).toBe('REJECTED');
    expect(event.status).toBe('PLANNING');
  });

  /*
   * AC:       SCRUM-56 AC2
   * Scenario: Reject without a reason.
   * Expected: 400; event and safety_checks unchanged.
   * Type:     error
   */
  it('refuses reject without a reason', async () => {
    await expect(
      access.recordSafetyCheck(safetyOfficer, 3, { outcome: 'REJECT' })
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(event.status).toBe('AWAITING_SAFETY_CHECK');
    expect(tables.safety_checks).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-56 AC1, AC2, AC3, AC7
   * Scenario: Request changes with reason and one venue booking selected.
   * Expected: REQUEST_CHANGES stored with affected arrangement; event → PLANNING.
   * Type:     normal
   */
  it('records request changes with a selected venue booking', async () => {
    const result = await access.recordSafetyCheck(safetyOfficer, 3, {
      outcome: 'REQUEST_CHANGES',
      reason: 'Need lower capacity room',
      affectedArrangements: [{ type: 'VENUE_BOOKING', id: 7 }],
    });
    expect(result.outcome).toBe('REQUEST_CHANGES');
    expect(result.affectedArrangements).toEqual([{ type: 'VENUE_BOOKING', id: 7 }]);
    expect(event.status).toBe('PLANNING');
  });

  /*
   * AC:       SCRUM-56 AC3
   * Scenario: Request changes with reason but no arrangements.
   * Expected: 400; nothing written.
   * Type:     error
   */
  it('refuses request changes without an affected arrangement', async () => {
    await expect(
      access.recordSafetyCheck(safetyOfficer, 3, {
        outcome: 'REQUEST_CHANGES',
        reason: 'Need changes',
        affectedArrangements: [],
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(tables.safety_checks).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-56 AC5, AC7
   * Scenario: Second outcome after reject already moved the event to Planning.
   * Expected: 409 INVALID_STATUS; no second safety_checks row.
   * Type:     conflict
   */
  it('refuses a second outcome after the event left Awaiting Safety Check', async () => {
    await access.recordSafetyCheck(safetyOfficer, 3, {
      outcome: 'REJECT',
      reason: 'Unsafe layout',
    });
    await expect(
      access.recordSafetyCheck(safetyOfficer, 3, { outcome: 'APPROVE' })
    ).rejects.toMatchObject({ status: 409, code: 'INVALID_STATUS' });
    expect(tables.safety_checks).toHaveLength(1);
  });

  /*
   * AC:       SCRUM-56 AC9
   * Scenario: Non-SO records an outcome.
   * Expected: 403; event unchanged.
   * Type:     error
   */
  it('refuses recording by a non Safety Officer', async () => {
    await expect(
      access.recordSafetyCheck(coordinator, 3, { outcome: 'APPROVE' })
    ).rejects.toMatchObject({ status: 403 });
    expect(event.status).toBe('AWAITING_SAFETY_CHECK');
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-55 AC3; SCRUM-56 AC6
   * Scenario: Coordinator tries to move Awaiting → Preparation without an approved check.
   * Expected: 409 SAFETY_CHECK_NOT_APPROVED; status unchanged.
   * Type:     error
   */
  it('blocks Preparation when no approved safety check exists', async () => {
    await expect(
      events.changeStatus(coordinator, 3, 'PREPARATION')
    ).rejects.toMatchObject({ status: 409, code: 'SAFETY_CHECK_NOT_APPROVED' });
    expect(event.status).toBe('AWAITING_SAFETY_CHECK');
  });

  /*
   * AC:       SCRUM-56 AC8
   * Scenario: Organiser and assigned Coordinator load the event after an approve.
   * Expected: safetyCheck is present for them; an unrelated organiser does not get it.
   * Type:     normal
   */
  it('shows the outcome to the organiser and assigned coordinator only', async () => {
    await access.recordSafetyCheck(safetyOfficer, 3, { outcome: 'APPROVE', reason: 'Clear' });

    const forOrganiser = await events.getEvent(organiser, 3);
    expect(forOrganiser.safetyCheck).toEqual(expect.objectContaining({
      outcome: 'APPROVED',
      reason: 'Clear',
    }));

    const forCoordinator = await events.getEvent(coordinator, 3);
    expect(forCoordinator.safetyCheck.outcome).toBe('APPROVED');

    // Unrelated organiser in another organisation cannot see the event at all (404).
    await expect(events.getEvent(otherUser, 3)).rejects.toMatchObject({ status: 404 });
  });
});

describe('SCRUM-55/56 HTTP routes', () => {
  const app = createApp();
  const soToken = jwt.sign({ sub: 12 }, env.jwtSecret);
  const coordToken = jwt.sign({ sub: 2 }, env.jwtSecret);

  function authAs(userId, role) {
    db.fetchOne.mockResolvedValue({ id: userId, is_active: true });
    db.fetchMany.mockResolvedValue([{ role }]);
  }

  /*
   * AC:       SCRUM-55 AC4
   * Scenario: Coordinator GETs the safety queue over HTTP.
   * Expected: 403 with no events body.
   * Type:     error
   */
  it('returns 403 when a non-SO opens the safety queue', async () => {
    authAs(2, ROLES.EVENT_COORDINATOR);
    const res = await request(app)
      .get('/api/events/safety-queue')
      .set('Cookie', `${env.sessionCookieName}=${coordToken}`);
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('events');
  });

});

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
   * Setup:    Coordinator-only session; no Safety Officer role.
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
   * Setup:    Coordinator-only session; no Safety Officer role.
   * Expected: 403 before any event fetch.
   * Type:     error
   */
  it('refuses openSafetyCheck for a non Safety Officer', async () => {
    await expect(access.openSafetyCheck(coordinator, 3)).rejects.toMatchObject({ status: 403 });
    expect(db.fetchOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-55 AC1, AC2
   * Scenario: Safety Officer opens an event that is not awaiting a safety check.
   * Setup:    Event status PLANNING with ready arrangements.
   * Expected: 409 INVALID_STATUS; no review payload for a non-awaiting event.
   * Type:     error
   */
  it('refuses to open a Planning event for safety review', async () => {
    event.status = 'PLANNING';
    await expect(access.openSafetyCheck(safetyOfficer, 3)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_STATUS',
    });
  });

  /*
   * AC:       SCRUM-55 AC1, AC2
   * Scenario: Safety Officer opens an awaiting event whose venue is no longer approved.
   * Setup:    Status AWAITING_SAFETY_CHECK; booking PENDING.
   * Expected: 409 NOT_READY_FOR_SAFETY_CHECK.
   * Type:     error
   */
  it('refuses to open an awaiting event when arrangements are incomplete', async () => {
    tables.venue_bookings[0].status = 'PENDING';
    await expect(access.openSafetyCheck(safetyOfficer, 3)).rejects.toMatchObject({
      status: 409,
      code: 'NOT_READY_FOR_SAFETY_CHECK',
    });
  });
});

describe('SCRUM-56 record safety outcome', () => {
  /*
   * AC:       SCRUM-56 AC1, AC4, AC6
   * Scenario: Approve with no reason.
   * Setup:    Awaiting event with ready arrangements; outcome APPROVE and no reason.
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
   * Setup:    Awaiting event; outcome REJECT with a non-empty reason.
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
   * Setup:    Awaiting event; outcome REJECT and empty/missing reason.
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
   * AC:       SCRUM-56 AC2
   * Scenario: Request changes without a reason.
   * Setup:    Awaiting event; REQUEST_CHANGES with an arrangement but blank reason.
   * Expected: 400 VALIDATION_ERROR; nothing written.
   * Type:     error
   */
  it('refuses request changes without a reason', async () => {
    await expect(
      access.recordSafetyCheck(safetyOfficer, 3, {
        outcome: 'REQUEST_CHANGES',
        reason: '   ',
        affectedArrangements: [{ type: 'VENUE_BOOKING', id: 7 }],
      })
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(tables.safety_checks).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-56 AC1
   * Scenario: Outcome value is not approve, reject, or request changes.
   * Setup:    Awaiting event; outcome string "MAYBE".
   * Expected: 400 VALIDATION_ERROR; event unchanged.
   * Type:     error
   */
  it('refuses an unknown safety-check outcome', async () => {
    await expect(
      access.recordSafetyCheck(safetyOfficer, 3, { outcome: 'MAYBE' })
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(event.status).toBe('AWAITING_SAFETY_CHECK');
    expect(tables.safety_checks).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-56 AC1, AC2, AC3, AC7
   * Scenario: Request changes with reason and one venue booking selected.
   * Setup:    Awaiting event; REQUEST_CHANGES with reason and booking id 7.
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
   * Setup:    Awaiting event; REQUEST_CHANGES with reason and empty affectedArrangements.
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
   * AC:       SCRUM-56 AC3
   * Scenario: Request changes names a booking that is not on this event.
   * Setup:    Awaiting event; affected arrangement id 999 (unknown).
   * Expected: 400 VALIDATION_ERROR; nothing written.
   * Type:     error
   */
  it('refuses request changes for a venue booking that is not on the event', async () => {
    await expect(
      access.recordSafetyCheck(safetyOfficer, 3, {
        outcome: 'REQUEST_CHANGES',
        reason: 'Wrong room',
        affectedArrangements: [{ type: 'VENUE_BOOKING', id: 999 }],
      })
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(tables.safety_checks).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-56 AC3
   * Scenario: Request changes uses an unknown arrangement type.
   * Setup:    Awaiting event; type "STAGE" which is not venue or equipment.
   * Expected: 400 VALIDATION_ERROR; nothing written.
   * Type:     error
   */
  it('refuses request changes with an unknown arrangement type', async () => {
    await expect(
      access.recordSafetyCheck(safetyOfficer, 3, {
        outcome: 'REQUEST_CHANGES',
        reason: 'Need changes',
        affectedArrangements: [{ type: 'STAGE', id: 7 }],
      })
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(tables.safety_checks).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-56 AC5, AC7
   * Scenario: Second outcome after reject already moved the event to Planning.
   * Setup:    First REJECT succeeds; second APPROVE attempted on the same event.
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
   * Setup:    Coordinator-only user; APPROVE payload.
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
   * AC:       SCRUM-55 AC1; SCRUM-56 record gate
   * Scenario: Record while awaiting but arrangements slipped (pending booking).
   * Setup:    Status AWAITING_SAFETY_CHECK; booking PENDING.
   * Expected: 409 NOT_READY_FOR_SAFETY_CHECK; no safety_checks row.
   * Type:     error
   */
  it('refuses to record when arrangements are no longer ready', async () => {
    tables.venue_bookings[0].status = 'PENDING';
    await expect(
      access.recordSafetyCheck(safetyOfficer, 3, { outcome: 'APPROVE' })
    ).rejects.toMatchObject({ status: 409, code: 'NOT_READY_FOR_SAFETY_CHECK' });
    expect(tables.safety_checks).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-55 AC3; SCRUM-56 AC6
   * Scenario: Coordinator tries to move Awaiting → Preparation without an approved check.
   * Setup:    Awaiting event; no safety_checks row.
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
   * AC:       SCRUM-55 AC3; SCRUM-56 AC6
   * Scenario: Coordinator moves Awaiting → Preparation after an approved check exists.
   * Setup:    Approved safety_checks row seeded while status stays AWAITING so changeStatus
   *           owns the transition (recordSafetyCheck would already move to PREPARATION).
   * Expected: Status becomes PREPARATION.
   * Type:     normal
   */
  it('allows Preparation once an approved safety check exists', async () => {
    tables.safety_checks.push({
      id: 1,
      event_id: 3,
      outcome: 'APPROVED',
      reason: null,
      affected_arrangements: [],
      decided_by: 12,
      decided_at: '2026-10-17T00:00:00.000Z',
    });
    await events.changeStatus(coordinator, 3, 'PREPARATION');
    expect(event.status).toBe('PREPARATION');
  });

  /*
   * AC:       SCRUM-56 AC8
   * Scenario: Organiser and assigned Coordinator load the event after an approve.
   * Setup:    Approve recorded; organiser id 1 and coordinator id 2 are the event contacts.
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

  /*
   * AC:       SCRUM-56 AC8
   * Scenario: Users who can open the event but are not its organiser or assigned coordinator.
   * Setup:    After approve; same-org organiser id 8 (organisation 10); Lead id 20. Both may
   *           view the event via canViewEvent, but neither is the event contact.
   * Expected: getEvent succeeds and safetyCheck is omitted (not leaked to unrelated viewers).
   * Type:     boundary
   */
  it('hides the outcome from a same-org organiser and a Lead who are not the event contacts', async () => {
    await access.recordSafetyCheck(safetyOfficer, 3, { outcome: 'APPROVE', reason: 'Clear' });

    const peerOrganiser = { id: 8, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
    const forPeer = await events.getEvent(peerOrganiser, 3);
    expect(forPeer.name).toBe('Workshop');
    expect(forPeer.safetyCheck).toBeUndefined();

    const lead = { id: 20, roles: [ROLES.EVENT_COORDINATOR_LEAD] };
    const forLead = await events.getEvent(lead, 3);
    expect(forLead.name).toBe('Workshop');
    expect(forLead.safetyCheck).toBeUndefined();
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
   * Setup:    Session role EVENT_COORDINATOR (auth mocks replace the table doubles).
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

  /*
   * AC:       SCRUM-55 AC1, AC4
   * Scenario: Safety Officer GETs the safety queue over HTTP.
   * Setup:    JWT for user 12; table-backed mocks include the awaiting Workshop event.
   * Expected: 200 with the awaiting event in `{ events }`.
   * Type:     normal
   */
  it('returns the awaiting queue for a Safety Officer over HTTP', async () => {
    const res = await request(app)
      .get('/api/events/safety-queue')
      .set('Cookie', `${env.sessionCookieName}=${soToken}`);
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([
      expect.objectContaining({ id: 3, name: 'Workshop', status: 'AWAITING_SAFETY_CHECK' }),
    ]);
  });

  /*
   * AC:       SCRUM-55 AC2, AC4
   * Scenario: Safety Officer opens a safety check over HTTP.
   * Setup:    JWT for user 12; event 3 awaiting with ready arrangements.
   * Expected: 200 with attendance, venue capacity/layouts and equipment.
   * Type:     normal
   */
  it('opens safety-check details for a Safety Officer over HTTP', async () => {
    const res = await request(app)
      .get('/api/events/3/safety-check')
      .set('Cookie', `${env.sessionCookieName}=${soToken}`);
    expect(res.status).toBe(200);
    expect(res.body.safetyCheck).toEqual(expect.objectContaining({
      eventId: 3,
      expectedAttendance: 80,
      accessibilityNeeds: 'Step-free access',
    }));
    expect(res.body.safetyCheck.bookings[0]).toEqual(expect.objectContaining({
      capacity: 100,
      layouts: ['Theatre', 'Classroom'],
    }));
  });

  /*
   * AC:       SCRUM-56 AC1, AC4, AC6
   * Scenario: Safety Officer records approve over HTTP.
   * Setup:    JWT for user 12; POST outcome APPROVE with no reason.
   * Expected: 200 APPROVED; in-memory event moves to PREPARATION.
   * Type:     normal
   */
  it('records an approve outcome for a Safety Officer over HTTP', async () => {
    const res = await request(app)
      .post('/api/events/3/safety-check')
      .set('Cookie', `${env.sessionCookieName}=${soToken}`)
      .send({ outcome: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(res.body.safetyCheck.outcome).toBe('APPROVED');
    expect(event.status).toBe('PREPARATION');
  });
});

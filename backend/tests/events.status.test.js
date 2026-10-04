/**
 * SCRUM-5: Progressing Event Statuses (service and route tests)
 *
 * Acceptance criteria covered:
 *   AC1  Submitting records Draft -> Submitted -> Under Review.
 *   AC2  Approving moves Under Review -> Approved.
 *   AC3  Starting planning moves Approved -> Planning.
 *   Transitions outside the matrix fail with HTTP 400 and change nothing.
 *
 * Labels:
 *   US5-S..  service rules (events.service submitEvent / changeStatus)
 *   US5-R..  real HTTP route POST /api/events/:id/status
 *
 * The database is replaced by small in-memory tables. Each fake query keeps its table and
 * its .eq() filters, so a query only finds rows that really match (e.g. a PENDING booking
 * is not returned when the code asks for APPROVED ones).
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
  updateById: jest.fn(), insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));

const db = require('../src/config/db');
const service = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };

let event;
let tables;

function rowsFor(query) {
  return (tables[query.table] || [])
    .filter((row) => query.filters.every(([column, value]) => String(row[column]) === String(value)));
}

function historyRows() {
  return db.insertOne.mock.calls
    .filter(([table]) => table === 'event_status_history')
    .map(([, row]) => [row.from_status, row.to_status]);
}

beforeEach(() => {
  jest.clearAllMocks();
  event = {
    id: 3, organiser_id: 1, organisation_id: 10, coordinator_id: 2, status: 'DRAFT',
    name: 'Workshop', purpose: 'Learn', description: 'A workshop',
    start_at: '2026-10-01T10:00:00Z', end_at: '2026-10-01T11:00:00Z',
    expected_attendance: 10, venue_requirements: 'Room', accessibility_needs: 'None',
  };
  tables = {
    events: [event],
    venue_bookings: [{ id: 7, event_id: 3, status: 'APPROVED' }],
    equipment_requests: [],
    users: [{ id: 2, is_active: true }],
    user_roles: [{ user_id: 2, role: ROLES.EVENT_COORDINATOR }],
  };
  db.supabase.from.mockImplementation((table) => {
    const query = { table, filters: [] };
    query.select = jest.fn(() => query);
    query.eq = jest.fn((column, value) => {
      query.filters.push([column, value]);
      return query;
    });
    query.order = jest.fn(() => query);
    return query;
  });
  db.fetchOne.mockImplementation(async (query) => rowsFor(query)[0] || null);
  db.fetchMany.mockImplementation(async (query) => rowsFor(query));
  db.updateById.mockResolvedValue(event);
});

describe('SCRUM-5 status progression (service rules)', () => {
  // AC1 · Submitting records Submitted, then Under Review once the coordinator is assigned.
  it('US5-S01: submitting a draft records DRAFT -> SUBMITTED -> UNDER_REVIEW', async () => {
    await service.submitEvent(organiser, 3);
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ status: 'UNDER_REVIEW' }));
    expect(historyRows()).toEqual([['DRAFT', 'SUBMITTED'], ['SUBMITTED', 'UNDER_REVIEW']]);
  });

  // Submitting again while already under review is outside the matrix: 400, no write.
  it('US5-S02: submitting an event that is already under review fails with 400', async () => {
    event.status = 'UNDER_REVIEW';
    await expect(service.submitEvent(organiser, 3)).rejects.toMatchObject({ status: 400 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // AC1 · A rejected request can be resubmitted (Week 4 Q&A); it goes back through Submitted
  // and the old rejection reason is cleared.
  it('US5-S03: resubmitting a rejected request records REJECTED -> SUBMITTED -> UNDER_REVIEW', async () => {
    event.status = 'REJECTED';
    event.rejection_reason = 'Missing budget';
    await service.submitEvent(organiser, 3);
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      status: 'UNDER_REVIEW', rejection_reason: null,
    }));
    expect(historyRows()).toEqual([['REJECTED', 'SUBMITTED'], ['SUBMITTED', 'UNDER_REVIEW']]);
  });

  // AC2 · The coordinator approving the initial request sets Approved.
  it('US5-S04: approving an event under review sets APPROVED', async () => {
    event.status = 'UNDER_REVIEW';
    await service.changeStatus(coordinator, 3, 'APPROVED');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ status: 'APPROVED' }));
    expect(historyRows()).toEqual([['UNDER_REVIEW', 'APPROVED']]);
  });

  // AC3 · Starting planning work moves Approved to Planning.
  it('US5-S05: starting planning moves APPROVED -> PLANNING', async () => {
    event.status = 'APPROVED';
    await service.changeStatus(coordinator, 3, 'PLANNING');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ status: 'PLANNING' }));
  });

  // AC4 · Rejecting from Submitted or Under Review sets Rejected and records the reason,
  // both on the event and in the status history.
  it.each(['SUBMITTED', 'UNDER_REVIEW'])('US5-S09: rejecting from %s records the reason', async (from) => {
    event.status = from;
    await service.changeStatus(coordinator, 3, 'REJECTED', '  Budget not approved ');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      status: 'REJECTED', rejection_reason: 'Budget not approved',
    }));
    expect(db.insertOne).toHaveBeenCalledWith('event_status_history', expect.objectContaining({
      from_status: from, to_status: 'REJECTED', note: 'Budget not approved',
    }));
  });

  // AC4 · "recording the reason": a rejection with no reason (missing or blank) is refused.
  it.each([undefined, '   '])('US5-S10: rejecting without a reason (%p) fails with 400 and changes nothing', async (reason) => {
    event.status = 'UNDER_REVIEW';
    await expect(service.changeStatus(coordinator, 3, 'REJECTED', reason)).rejects.toMatchObject({
      status: 400, code: 'VALIDATION_ERROR', message: 'A reason is required to reject an event',
    });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // Confirming still requires an APPROVED venue booking; a PENDING one is not enough.
  it('US5-S06: PREPARATION -> CONFIRMED is refused when the only booking is still pending', async () => {
    event.status = 'PREPARATION';
    tables.venue_bookings[0].status = 'PENDING';
    await expect(service.changeStatus(coordinator, 3, 'CONFIRMED')).rejects.toMatchObject({
      status: 409, code: 'VENUE_NOT_APPROVED', message: 'A venue booking must be approved before confirmation',
    });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('US5-S08: PREPARATION -> CONFIRMED succeeds with an approved venue booking', async () => {
    event.status = 'PREPARATION';
    await service.changeStatus(coordinator, 3, 'CONFIRMED');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ status: 'CONFIRMED' }));
  });

  // Cancelled is final: nothing can bring a cancelled event back.
  it('US5-S07: a cancelled event cannot be moved back into planning', async () => {
    event.status = 'CANCELLED';
    await expect(service.changeStatus(coordinator, 3, 'PLANNING')).rejects.toMatchObject({ status: 400 });
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

describe('SCRUM-5 POST /api/events/:id/status (route)', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const token = jwt.sign({ sub: 2 }, env.jwtSecret);

  // Sends the request as user 2 (an active coordinator in the fake tables) with a real
  // signed session cookie, so the real auth middleware and role check run.
  function asCoordinator() {
    return request(app)
      .post('/api/events/3/status')
      .set('Cookie', `${env.sessionCookieName}=${token}`);
  }

  // End to end through Express: an invalid jump comes back as HTTP 400 with the
  // INVALID_STATUS_TRANSITION code and a readable message.
  it('US5-R01: an invalid transition returns HTTP 400', async () => {
    event.status = 'DRAFT';
    const res = await asCoordinator().send({ status: 'CONFIRMED' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'INVALID_STATUS_TRANSITION', message: 'Cannot move event from DRAFT to CONFIRMED',
    });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // AC2 · Approving through the same route succeeds.
  it('US5-R02: approving through the route returns HTTP 200 and saves APPROVED', async () => {
    event.status = 'UNDER_REVIEW';
    const res = await asCoordinator().send({ status: 'APPROVED' });
    expect(res.status).toBe(200);
    expect(db.updateById).toHaveBeenCalledWith('events', '3', expect.objectContaining({ status: 'APPROVED' }));
  });
});

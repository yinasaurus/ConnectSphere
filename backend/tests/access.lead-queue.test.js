const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
  updateById: jest.fn(), insertOne: jest.fn(),
}));

const db = require('../src/config/db');
const access = require('../src/services/access.service');
const { createApp } = require('../src/app');

function chain() {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  };
}

function expectNoEventLeak(res) {
  expect(res.body).toEqual({
    error: 'FORBIDDEN',
    message: expect.any(String),
  });
  expect(res.body).not.toHaveProperty('events');
  expect(res.body).not.toHaveProperty('assignments');
  expect(res.body).not.toHaveProperty('event');
}

describe('SCRUM-54 Lead-only unassigned queue and assignment overview', () => {
  const app = createApp();
  const token = jwt.sign({ sub: 11 }, env.jwtSecret);
  const lead = { id: 11, roles: [ROLES.EVENT_COORDINATOR_LEAD] };
  const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
  const hybrid = { id: 13, roles: [ROLES.EVENT_COORDINATOR, ROLES.EVENT_COORDINATOR_LEAD] };

  beforeEach(() => {
    jest.clearAllMocks();
    db.supabase.from.mockReturnValue(chain());
  });

  function asRole(role, method, path) {
    db.fetchOne.mockResolvedValue({ id: 11, is_active: true });
    db.fetchMany.mockResolvedValue([{ role }]);
    return request(app)[method](path).set('Cookie', `${env.sessionCookieName}=${token}`);
  }

  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Lead opens the unassigned queue.
   * Setup: One event with coordinator_id null.
   * Expected: 200 and the unassigned event is listed.
   * Type: normal
   */
  it('lets a Lead open the unassigned queue', async () => {
    db.fetchMany.mockResolvedValue([
      { id: 9, name: 'Waiting', status: 'SUBMITTED', start_at: '2026-10-01T10:00:00Z', coordinator_id: null },
    ]);
    const events = await access.listUnassignedQueue(lead);
    expect(events).toEqual([
      { id: 9, name: 'Waiting', status: 'SUBMITTED', startAt: '2026-10-01T10:00:00Z' },
    ]);
  });

  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Coordinator who is not a Lead asks for the unassigned queue.
   * Setup: Coordinator-only user; queue is not listed because the role check fails first.
   * Expected: 403 and no event list is produced.
   * Type: error
   */
  it('refuses the unassigned queue to a Coordinator who is not a Lead', async () => {
    await expect(access.listUnassignedQueue(coordinator)).rejects.toMatchObject({ status: 403 });
    expect(db.fetchMany).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC2, AC3
   * Scenario: A hybrid Coordinator + Lead opens the unassigned queue in the same session.
   * Setup: User holds both EVENT_COORDINATOR and EVENT_COORDINATOR_LEAD.
   * Expected: The Lead function is allowed because they hold Lead.
   * Type: normal
   */
  it('lets a Coordinator + Lead hybrid open the unassigned queue', async () => {
    db.fetchMany.mockResolvedValue([]);
    await expect(access.listUnassignedQueue(hybrid)).resolves.toEqual([]);
  });

  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Lead opens the overview for an assigned event whose coordinator name join is missing.
   * Setup: coordinator_id is set but the joined user row is null.
   * Expected: The assignment is still listed; coordinatorName is null rather than crashing.
   * Type: boundary
   */
  it('lists an assignment when the coordinator name join is missing', async () => {
    db.fetchMany.mockResolvedValue([
      { id: 3, name: 'Workshop', status: 'UNDER_REVIEW', coordinator_id: 2, coordinator: null },
    ]);
    const assignments = await access.listAssignmentOverview(lead);
    expect(assignments[0].coordinatorName).toBeNull();
  });

  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Lead opens the overview of all coordinator assignments.
   * Setup: One assigned event.
   * Expected: The assignment row is returned.
   * Type: normal
   */
  it('lets a Lead open the coordinator assignment overview', async () => {
    db.fetchMany.mockResolvedValue([
      {
        id: 3, name: 'Workshop', status: 'UNDER_REVIEW', coordinator_id: 2,
        coordinator: { full_name: 'Chloe Lim' },
      },
    ]);
    const assignments = await access.listAssignmentOverview(lead);
    expect(assignments).toEqual([
      {
        eventId: 3, eventName: 'Workshop', status: 'UNDER_REVIEW',
        coordinatorId: 2, coordinatorName: 'Chloe Lim',
      },
    ]);
  });

  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Coordinator who is not a Lead asks for the assignment overview.
   * Setup: Coordinator-only user.
   * Expected: 403 before any assignment rows are loaded.
   * Type: error
   */
  it('refuses the assignment overview to a Coordinator who is not a Lead', async () => {
    await expect(access.listAssignmentOverview(coordinator)).rejects.toMatchObject({ status: 403 });
    expect(db.fetchMany).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC3, AC7
   * Scenario: A non-Lead calls GET /api/events/unassigned-queue over HTTP.
   * Setup: Session role EVENT_COORDINATOR. The event "Secret Gala" is not loaded.
   * Expected: 403 with only error and message — no events array and no event name.
   * Type: error
   */
  it('returns 403 without event details when a non-Lead opens the unassigned queue over HTTP', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR, 'get', '/api/events/unassigned-queue');
    expect(res.status).toBe(403);
    expectNoEventLeak(res);
    expect(JSON.stringify(res.body)).not.toMatch(/Secret Gala/i);
  });

  /*
   * AC: SCRUM-54 AC3, AC7
   * Scenario: A Safety Officer calls GET /api/assignments/overview.
   * Setup: Session role SAFETY_OFFICER.
   * Expected: 403 with no assignments list.
   * Type: error
   */
  it('returns 403 without assignment details when a non-Lead opens the overview over HTTP', async () => {
    const res = await asRole(ROLES.SAFETY_OFFICER, 'get', '/api/assignments/overview');
    expect(res.status).toBe(403);
    expectNoEventLeak(res);
  });

  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Lead calls the queue and overview HTTP endpoints.
   * Setup: Lead role; empty lists from the database (second fetchMany is the list).
   * Expected: 200 with events/assignments arrays (empty is a valid queue).
   * Type: boundary
   */
  it('returns 200 empty collections when a Lead opens an empty queue or overview over HTTP', async () => {
    db.fetchOne.mockResolvedValue({ id: 11, is_active: true });
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }])
      .mockResolvedValueOnce([]);
    const queue = await request(app)
      .get('/api/events/unassigned-queue')
      .set('Cookie', `${env.sessionCookieName}=${token}`);
    expect(queue.status).toBe(200);
    expect(queue.body.events).toEqual([]);

    db.fetchOne.mockResolvedValue({ id: 11, is_active: true });
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }])
      .mockResolvedValueOnce([]);
    const overview = await request(app)
      .get('/api/assignments/overview')
      .set('Cookie', `${env.sessionCookieName}=${token}`);
    expect(overview.status).toBe(200);
    expect(overview.body.assignments).toEqual([]);
  });
});

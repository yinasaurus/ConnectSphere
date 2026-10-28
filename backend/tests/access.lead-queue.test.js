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
   * AC: SCRUM-54 AC2, AC3
   * Scenario: A hybrid Coordinator + Lead opens the unassigned queue over HTTP in the same session.
   * Setup: Session roles EVENT_COORDINATOR and EVENT_COORDINATOR_LEAD; empty queue.
   * Expected: 200, so the Lead function is allowed because they hold Lead.
   * Type: normal
   */
  // SCRUM-54-TC05
  it('lets a Coordinator + Lead hybrid open the unassigned queue', async () => {
    db.fetchOne.mockResolvedValue({ id: 11, is_active: true });
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR }, { role: ROLES.EVENT_COORDINATOR_LEAD }])
      .mockResolvedValueOnce([]);
    const res = await request(app)
      .get('/api/events/unassigned-queue')
      .set('Cookie', `${env.sessionCookieName}=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
  });

  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Lead opens the overview for an assigned event whose coordinator name join is missing.
   * Setup: coordinator_id is set but the joined user row is null.
   * Expected: The assignment is still listed; coordinatorName is null rather than crashing.
   * Type: boundary
   */
  // SCRUM-54-TC06
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
  // SCRUM-54-TC07
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
  // SCRUM-54-TC08
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
  // SCRUM-54-TC09
  it('returns 403 without event details when a non-Lead opens the unassigned queue over HTTP', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR, 'get', '/api/events/unassigned-queue');
    expect(res.status).toBe(403);
    expectNoEventLeak(res);
    expect(JSON.stringify(res.body)).not.toMatch(/Secret Gala/i);
  });

  /*
   * AC: SCRUM-54 AC3, AC7
   * Scenario: A Safety Officer calls GET /api/assignments/overview.
   * Setup: Session role EVENT_COORDINATOR.
   * Expected: 403 with no assignments list.
   * Type: error
   */
  // SCRUM-54-TC10
  it('returns 403 without assignment details when a non-Lead opens the overview over HTTP', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR, 'get', '/api/assignments/overview');
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
  // SCRUM-54-TC11
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

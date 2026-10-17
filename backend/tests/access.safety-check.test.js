/**
 * SCRUM-54 role gate (kept) plus SCRUM-55/56 safety review HTTP boundaries.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
  updateById: jest.fn(), insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));

const db = require('../src/config/db');
const audit = require('../src/services/audit.service');
const access = require('../src/services/access.service');
const { createApp } = require('../src/app');

function chain() {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
  };
}

function expectNoEventLeak(res) {
  expect(res.body).toEqual({
    error: 'FORBIDDEN',
    message: expect.any(String),
  });
  expect(res.body).not.toHaveProperty('safetyCheck');
  expect(res.body).not.toHaveProperty('event');
  expect(res.body).not.toHaveProperty('events');
}

describe('SCRUM-54 / SCRUM-55 Safety Officer-only safety checks', () => {
  const app = createApp();
  const token = jwt.sign({ sub: 12 }, env.jwtSecret);
  const safetyOfficer = { id: 12, roles: [ROLES.SAFETY_OFFICER] };
  const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };

  beforeEach(() => {
    jest.clearAllMocks();
    db.supabase.from.mockReturnValue(chain());
  });

  function asRole(role, method, path) {
    db.fetchOne.mockResolvedValue({ id: 12, is_active: true });
    db.fetchMany.mockResolvedValue([{ role }]);
    return request(app)[method](path).set('Cookie', `${env.sessionCookieName}=${token}`);
  }

  /*
   * AC: SCRUM-55 AC4
   * Scenario: A Coordinator who is not a Safety Officer tries to open a safety check.
   * Setup: Coordinator-only user. Event lookup must not run, so details cannot leak.
   * Expected: 403 and no event fetch.
   * Type: error
   */
  it('refuses to open a safety check for a user who is not a Safety Officer', async () => {
    await expect(access.openSafetyCheck(coordinator, 3)).rejects.toMatchObject({ status: 403 });
    expect(db.fetchOne).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-56 AC9
   * Scenario: A Coordinator tries to record a safety-check outcome.
   * Setup: Coordinator-only user and an approve payload.
   * Expected: 403, no audit write, event unchanged.
   * Type: error
   */
  it('refuses to record a safety-check outcome for a user who is not a Safety Officer', async () => {
    await expect(
      access.recordSafetyCheck(coordinator, 3, { outcome: 'APPROVE' })
    ).rejects.toMatchObject({ status: 403 });
    expect(audit.writeAudit).not.toHaveBeenCalled();
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-55 AC4, AC7
   * Scenario: A Coordinator calls GET /api/events/3/safety-check over HTTP.
   * Setup: Session role EVENT_COORDINATOR. requireRole fails before the service.
   * Expected: 403 with only error and message — no safetyCheck and no event name.
   * Type: error
   */
  it('returns 403 without event details when a non-SO opens a safety check over HTTP', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR, 'get', '/api/events/3/safety-check');
    expect(res.status).toBe(403);
    expectNoEventLeak(res);
    expect(JSON.stringify(res.body)).not.toMatch(/Helix/i);
  });

  /*
   * AC: SCRUM-56 AC9
   * Scenario: A Lead posts a safety-check outcome over HTTP.
   * Setup: Session role EVENT_COORDINATOR_LEAD.
   * Expected: 403, no audit write, no event resource in the body.
   * Type: error
   */
  it('returns 403 without event details when a non-SO records a safety check over HTTP', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR_LEAD, 'post', '/api/events/3/safety-check')
      .send({ outcome: 'APPROVE' });
    expect(res.status).toBe(403);
    expectNoEventLeak(res);
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-55 AC4
   * Scenario: A Coordinator GETs /api/events/safety-queue.
   * Expected: 403 with no events list.
   * Type: error
   */
  it('returns 403 without events when a non-SO opens the safety queue over HTTP', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR, 'get', '/api/events/safety-queue');
    expect(res.status).toBe(403);
    expectNoEventLeak(res);
  });
});

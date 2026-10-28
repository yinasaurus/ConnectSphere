/**
 * SCRUM-54 role gate over HTTP. The service-level non-SO checks are in events.safetyCheck.test.js (SCRUM-55/56).
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
   * AC: SCRUM-54 AC4, AC7; SCRUM-55 AC4
   * Scenario: A Coordinator calls GET /api/events/3/safety-check over HTTP.
   * Setup: Session role EVENT_COORDINATOR. requireRole fails before the service.
   * Expected: 403 with only error and message — no safetyCheck and no event name.
   * Type: error
   */
  // SCRUM-54-TC12
  it('returns 403 without event details when a non-SO opens a safety check over HTTP', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR, 'get', '/api/events/3/safety-check');
    expect(res.status).toBe(403);
    expectNoEventLeak(res);
    expect(JSON.stringify(res.body)).not.toMatch(/Helix/i);
  });

  /*
   * AC: SCRUM-54 AC4, AC7; SCRUM-56 AC9
   * Scenario: A Lead posts a safety-check outcome over HTTP.
   * Setup: Session role EVENT_COORDINATOR_LEAD.
   * Expected: 403, no audit write, no event resource in the body.
   * Type: error
   */
  // SCRUM-54-TC13
  it('returns 403 without event details when a non-SO records a safety check over HTTP', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR_LEAD, 'post', '/api/events/3/safety-check')
      .send({ outcome: 'APPROVE' });
    expect(res.status).toBe(403);
    expectNoEventLeak(res);
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC7; SCRUM-55 AC4
   * Scenario: A Coordinator GETs /api/events/safety-queue.
   * Setup: Session role EVENT_COORDINATOR.
   * Expected: 403 with no events list.
   * Type: error
   */
  // SCRUM-54-TC14
  it('returns 403 without events when a non-SO opens the safety queue over HTTP', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR, 'get', '/api/events/safety-queue');
    expect(res.status).toBe(403);
    expectNoEventLeak(res);
  });
});

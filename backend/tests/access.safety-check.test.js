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
  };
}

function expectNoEventLeak(res) {
  expect(res.body).toEqual({
    error: 'FORBIDDEN',
    message: expect.any(String),
  });
  expect(res.body).not.toHaveProperty('safetyCheck');
  expect(res.body).not.toHaveProperty('event');
}

describe('SCRUM-54 Safety Officer-only safety checks', () => {
  const app = createApp();
  const token = jwt.sign({ sub: 12 }, env.jwtSecret);
  const safetyOfficer = { id: 12, roles: [ROLES.SAFETY_OFFICER] };
  const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
  const hybrid = { id: 15, roles: [ROLES.EVENT_COORDINATOR, ROLES.SAFETY_OFFICER] };

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
   * AC: SCRUM-54 AC4
   * Scenario: A Safety Officer opens a safety check on an existing event.
   * Setup: Event id 3 named Helix Conference exists.
   * Expected: The check opens with that event id and name; outcome is not yet recorded.
   * Type: normal
   */
  it('lets a Safety Officer open a safety check', async () => {
    db.fetchOne.mockResolvedValue({ id: 3, name: 'Helix Conference' });
    await expect(access.openSafetyCheck(safetyOfficer, 3)).resolves.toEqual({
      eventId: 3, eventName: 'Helix Conference', outcome: null,
    });
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: A Safety Officer records a safety-check outcome.
   * Setup: Event 3 exists; outcome "Site cleared".
   * Expected: An audit row is written and the outcome is returned. The event row is not updated.
   * Type: normal
   */
  it('lets a Safety Officer record a safety-check outcome', async () => {
    db.fetchOne.mockResolvedValue({ id: 3 });
    const result = await access.recordSafetyCheck(safetyOfficer, 3, '  Site cleared  ');
    expect(result).toEqual({ eventId: 3, outcome: 'Site cleared' });
    expect(audit.writeAudit).toHaveBeenCalledWith(
      12, 'SAFETY_CHECK_RECORDED', 'event', 3, { outcome: 'Site cleared' }
    );
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC4, AC7
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
   * AC: SCRUM-54 AC4, AC7
   * Scenario: A Coordinator tries to record a safety-check outcome.
   * Setup: Coordinator-only user and a non-empty outcome.
   * Expected: 403, no audit write, event unchanged.
   * Type: error
   */
  it('refuses to record a safety-check outcome for a user who is not a Safety Officer', async () => {
    await expect(access.recordSafetyCheck(coordinator, 3, 'Site cleared')).rejects.toMatchObject({ status: 403 });
    expect(audit.writeAudit).not.toHaveBeenCalled();
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC2, AC4
   * Scenario: A hybrid Coordinator + Safety Officer records an outcome in the same session.
   * Setup: User holds both roles; event 3 exists.
   * Expected: The Safety Officer function is allowed because they hold that role.
   * Type: normal
   */
  it('lets a Coordinator + Safety Officer hybrid record a safety-check outcome', async () => {
    db.fetchOne.mockResolvedValue({ id: 3 });
    await expect(access.recordSafetyCheck(hybrid, 3, 'Passed')).resolves.toEqual({
      eventId: 3, outcome: 'Passed',
    });
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: A Safety Officer records a blank outcome.
   * Setup: Event would exist, but outcome is whitespace.
   * Expected: 400 and nothing is written. Role is valid; the outcome is not.
   * Type: boundary
   */
  it('rejects an empty safety-check outcome', async () => {
    await expect(access.recordSafetyCheck(safetyOfficer, 3, '   ')).rejects.toMatchObject({ status: 400 });
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: A Safety Officer records without an outcome field (body omitted).
   * Setup: outcome is undefined, not a string.
   * Expected: 400, same as a blank outcome; nothing is written.
   * Type: boundary
   */
  it('rejects a missing (non-string) safety-check outcome', async () => {
    await expect(access.recordSafetyCheck(safetyOfficer, 3, undefined)).rejects.toMatchObject({ status: 400 });
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: A Safety Officer records an outcome for an event that does not exist.
   * Setup: Role check passes; fetchOne returns null.
   * Expected: 404, no audit write, nothing to leak.
   * Type: error
   */
  it('returns 404 when a Safety Officer records against a missing event', async () => {
    db.fetchOne.mockResolvedValue(null);
    await expect(access.recordSafetyCheck(safetyOfficer, 99, 'Site cleared')).rejects.toMatchObject({ status: 404 });
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: A Safety Officer opens a safety check for an id that does not exist.
   * Setup: Role check passes; fetchOne returns null.
   * Expected: 404, not a leaked empty event body.
   * Type: error
   */
  it('returns 404 when a Safety Officer opens a missing event', async () => {
    db.fetchOne.mockResolvedValue(null);
    await expect(access.openSafetyCheck(safetyOfficer, 99)).rejects.toMatchObject({ status: 404 });
  });

  /*
   * AC: SCRUM-54 AC4, AC7
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
   * AC: SCRUM-54 AC4, AC7
   * Scenario: A Lead posts a safety-check outcome over HTTP.
   * Setup: Session role EVENT_COORDINATOR_LEAD.
   * Expected: 403, no audit write, no event resource in the body.
   * Type: error
   */
  it('returns 403 without event details when a non-SO records a safety check over HTTP', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR_LEAD, 'post', '/api/events/3/safety-check')
      .send({ outcome: 'Site cleared' });
    expect(res.status).toBe(403);
    expectNoEventLeak(res);
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: A Safety Officer opens then records via HTTP.
   * Setup: Safety Officer session; event 3 exists on the second fetchOne (after loadUser).
   * Expected: GET 200 and POST 200.
   * Type: normal
   */
  it('lets a Safety Officer open and record a safety check over HTTP', async () => {
    db.fetchOne
      .mockResolvedValueOnce({ id: 12, is_active: true })
      .mockResolvedValueOnce({ id: 3, name: 'Helix Conference' });
    db.fetchMany.mockResolvedValue([{ role: ROLES.SAFETY_OFFICER }]);
    const opened = await request(app)
      .get('/api/events/3/safety-check')
      .set('Cookie', `${env.sessionCookieName}=${token}`);
    expect(opened.status).toBe(200);
    expect(opened.body.safetyCheck).toEqual({
      eventId: 3, eventName: 'Helix Conference', outcome: null,
    });

    db.fetchOne
      .mockResolvedValueOnce({ id: 12, is_active: true })
      .mockResolvedValueOnce({ id: 3 });
    const recorded = await request(app)
      .post('/api/events/3/safety-check')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ outcome: 'Site cleared' });
    expect(recorded.status).toBe(200);
    expect(recorded.body.safetyCheck).toEqual({ eventId: 3, outcome: 'Site cleared' });
  });
});

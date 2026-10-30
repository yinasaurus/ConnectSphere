/**
 * SCRUM-33: only a Lead can assign or reassign an event.
 *
 * Lead assign success is SCRUM-71. Lead reassign success is SCRUM-31.
 * These tests are the refusal. Week 7 change #5 blocks the assigned Coordinator
 * as well as Organisers and every other role. A rejected attempt must not change
 * the event and must not write an audit entry (that entry is SCRUM-32).
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
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));

const db = require('../src/config/db');
const audit = require('../src/services/audit.service');
const service = require('../src/services/events.service');
const { createApp } = require('../src/app');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

const assignCallers = [
  ['a Coordinator', { id: 2, roles: [ROLES.EVENT_COORDINATOR] }],
  ['another Coordinator', { id: 4, roles: [ROLES.EVENT_COORDINATOR] }],
  ['an Event Organiser', { id: 1, roles: [ROLES.EVENT_ORGANISER] }],
  ['Venue Staff', { id: 5, roles: [ROLES.VENUE_STAFF] }],
];

const callers = [
  ['the assigned Coordinator', assignCallers[0][1]],
  ['another Coordinator', assignCallers[1][1]],
  ['an Event Organiser', assignCallers[2][1]],
  ['Venue Staff', assignCallers[3][1]],
];

let event;

function heldEvent() {
  return {
    id: 3,
    name: 'Leadership Forum',
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    status: 'PLANNING',
    purpose: 'Briefing',
    description: 'Forum',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  event = heldEvent();
  db.supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  });
  db.fetchOne.mockImplementation(async () => event);
  db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);
  db.updateById.mockImplementation(async (_table, _id, patch) => {
    Object.assign(event, patch);
    return event;
  });
  db.insertOne.mockImplementation(async (table, row) => ({ id: 1, ...row }));
  audit.writeAudit.mockResolvedValue(undefined);
  audit.notifyUser.mockResolvedValue(undefined);
});

function expectUnchanged(coordinatorId) {
  expect(db.updateById).not.toHaveBeenCalled();
  expect(audit.writeAudit).not.toHaveBeenCalled();
  expect(audit.notifyUser).not.toHaveBeenCalled();
  expect(event.coordinator_id).toBe(coordinatorId);
}

describe('SCRUM-33 service refusals', () => {
  /*
   * AC: SCRUM-33 AC1, AC2, AC3
   * Scenario: Someone who is not a Lead assigns a Coordinator to an open request.
   * Setup: Event 3 is Submitted and has no Coordinator, so a Lead assign would succeed.
   *   The caller is a Coordinator, another Coordinator, an Organiser, or Venue Staff.
   *   Nobody holds this event yet, so the first caller is a Coordinator rather than
   *   the assigned one. Venue Staff stands in for any other user.
   * Expected: 403 FORBIDDEN before the event is written. coordinator_id stays null.
   *   No audit entry. Lead success itself is US71-B01.
   * Type: error
   */
  it.each(assignCallers)('US33-B01: %s cannot assign a Coordinator', async (_label, user) => {
    event.coordinator_id = null;
    event.status = 'SUBMITTED';

    await expect(service.assignPrimaryCoordinator(user, 3, 4)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expectUnchanged(null);
  });

  /*
   * AC: SCRUM-33 AC1, AC2, AC3
   * Scenario: Someone who is not a Lead replaces the Coordinator on an event that has one.
   * Setup: Event 3 is held by Coordinator 2. The caller tries to put Coordinator 4 on it.
   *   This Lead reassign action already rejected a Coordinator. Week 7 change #5
   *   is what closes their request and accept, covered by US33-B03 and US33-B04.
   * Expected: 403 FORBIDDEN. The event stays with Coordinator 2. No audit entry.
   *   A Lead reassignment is US31-B01 and still writes the SCRUM-32 audit.
   * Type: error
   */
  it.each(callers)('US33-B02: %s cannot reassign a Coordinator', async (_label, user) => {
    await expect(service.reassignEventCoordinator(user, 3, 4)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expectUnchanged(2);
  });

  /*
   * AC: SCRUM-33 AC1, AC2, AC3
   * Scenario: Someone who is not a Lead asks another Coordinator to take the event.
   * Setup: Event 3 is held by Coordinator 2. The request names Coordinator 4.
   *   The assigned Coordinator's request used to be stored. It must not be stored now.
   * Expected: 403 FORBIDDEN. No handover row, no notice, no audit entry.
   *   Coordinator 2 still holds the event.
   * Type: error
   */
  it.each(callers)('US33-B03: %s cannot request a reassignment', async (_label, user) => {
    await expect(service.requestCoordinatorChange(user, 3, 4)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(db.insertOne).not.toHaveBeenCalled();
    expectUnchanged(2);
  });

  /*
   * AC: SCRUM-33 AC1, AC2, AC3
   * Scenario: Someone who is not a Lead accepts a handover that would change the event.
   * Setup: A PENDING row already names that caller, which is the case that used to
   *   succeed for the incoming Coordinator. The role check has to win before that row is read.
   * Expected: 403 FORBIDDEN. The event stays with Coordinator 2. No audit entry and no notice.
   * Type: error
   */
  it.each(callers)('US33-B04: %s cannot accept a reassignment', async (_label, user) => {
    db.fetchOne.mockResolvedValue({
      id: 9,
      event_id: 3,
      from_coordinator_id: 2,
      to_coordinator_id: user.id,
      status: 'PENDING',
      coordinator_id: 2,
    });

    await expect(service.acceptCoordinatorChange(user, 3)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(db.fetchOne).not.toHaveBeenCalled();
    expectUnchanged(2);
  });

  /*
   * AC: SCRUM-33 AC2, AC3
   * Scenario: A Lead asks for a handover on an event they do not hold.
   * Setup: Event 3 is held by Coordinator 2. Caller 11 is a Lead and is not
   *   Coordinator 2. The role check lets a Lead through, so the holder check
   *   has to refuse this request.
   * Expected: 403 FORBIDDEN. No handover row, no notice, and no audit entry.
   *   Coordinator 2 still holds the event.
   * Type: error
   */
  it('US33-B05: a Lead who does not hold the event cannot request a reassignment', async () => {
    const lead = { id: 11, roles: [ROLES.EVENT_COORDINATOR_LEAD] };

    await expect(service.requestCoordinatorChange(lead, 3, 4)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(db.insertOne).not.toHaveBeenCalled();
    expectUnchanged(2);
  });
});

describe('SCRUM-33 HTTP refusals', () => {
  const app = createApp();

  function session(userId, role) {
    const token = jwt.sign({ sub: userId }, env.jwtSecret);
    db.fetchOne.mockResolvedValueOnce({ id: userId, is_active: true });
    db.fetchMany.mockResolvedValueOnce([{ role }]);
    return {
      post(path) {
        return request(app).post(path).set('Cookie', `${env.sessionCookieName}=${token}`);
      },
    };
  }

  /*
   * AC: SCRUM-33 AC2, AC3
   * Scenario: An Organiser calls the Lead assign route.
   * Setup: Session user 1 is an Event Organiser. Event 3 is Submitted and unassigned,
   *   which is the case a Lead is allowed to assign. Body names Coordinator 4.
   * Expected: 403 from the route, before the service writes the event or an audit entry.
   * Type: error
   */
  it('US33-R01: an Organiser cannot assign through the API', async () => {
    event.coordinator_id = null;
    event.status = 'SUBMITTED';

    const res = await session(1, ROLES.EVENT_ORGANISER)
      .post('/api/events/3/assign-coordinator')
      .send({ coordinatorId: 4 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
    expectUnchanged(null);
  });

  /*
   * AC: SCRUM-33 AC2, AC3
   * Scenario: The assigned Coordinator calls the Lead reassign route.
   * Setup: Session user 2 is that Coordinator and not a Lead. Event 3 is held by user 2.
   *   Body names Coordinator 4. This route already required a Lead. Week 7 change #5
   *   closes the old request and accept routes, covered by US33-R03 and US33-R04.
   * Expected: 403. The event stays with Coordinator 2. No audit entry.
   * Type: error
   */
  it('US33-R02: the assigned Coordinator cannot reassign through the API', async () => {
    const res = await session(2, ROLES.EVENT_COORDINATOR)
      .post('/api/events/3/reassign-coordinator')
      .send({ coordinatorId: 4 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
    expectUnchanged(2);
  });

  /*
   * AC: SCRUM-33 AC2, AC3
   * Scenario: The assigned Coordinator uses the old request route.
   * Setup: Session user 2 is that Coordinator. Event 3 is held by user 2.
   *   The route now requires the Lead role, same as the service.
   * Expected: 403. No handover row and no audit entry. Coordinator 2 still holds the event.
   * Type: error
   */
  it('US33-R03: the assigned Coordinator cannot request a handover through the API', async () => {
    const res = await session(2, ROLES.EVENT_COORDINATOR)
      .post('/api/events/3/reassign')
      .send({ coordinatorId: 4 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
    expect(db.insertOne).not.toHaveBeenCalled();
    expectUnchanged(2);
  });

  /*
   * AC: SCRUM-33 AC2, AC3
   * Scenario: The incoming Coordinator uses the old accept route.
   * Setup: Session user 4 is a Coordinator, not a Lead. A pending handover would
   *   previously have let them take event 3 from Coordinator 2.
   * Expected: 403 before the event is read. Coordinator 2 still holds it. No audit entry.
   * Type: error
   */
  it('US33-R04: a Coordinator cannot accept a handover through the API', async () => {
    const res = await session(4, ROLES.EVENT_COORDINATOR)
      .post('/api/events/3/reassign/accept');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
    expect(db.fetchOne).toHaveBeenCalledTimes(1);
    expectUnchanged(2);
  });
});

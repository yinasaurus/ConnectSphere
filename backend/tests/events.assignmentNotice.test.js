/**
 * SCRUM-45: Notify Event Organisers and Coordinators.
 *
 * AC1  Organiser is told about submission, clarification requests, approval, rejection and
 *      important changes.
 * AC2  Coordinator is told when the Lead assigns or reassigns an event to or from them, and
 *      about clarification responses and important updates.
 * AC3  Only the relevant Organiser or Coordinator is notified.
 * AC4  Notification status is new or viewed.            -> notifications.status.test.js
 * AC5  Organiser is told when a Coordinator is assigned or changed.
 *
 * Owned elsewhere (not repeated here):
 *   AC1 rejection and important changes, AC2 important updates  -> events.notifications.test.js
 *       (SCRUM-44-N01, N02, N05 in the SCRUM-44 sheet).
 *   Reassignment request / accept notices, in full               -> events.assignedCoordinator.test.js
 *       (SCRUM-29-TC09, TC10, TC12, TC16). SCRUM-29 refers back to this file for the Lead assign
 *       notice (SCRUM-45-TC04, TC09), so that notice is tested end to end once.
 *   New / viewed on the Notifications page                       -> Notifications.test.jsx (SCRUM-44).
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
const events = require('../src/services/events.service');
const { createApp } = require('../src/app');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

const lead = { id: 11, roles: [ROLES.EVENT_COORDINATOR_LEAD] };
const organiser = { id: 1, roles: [ROLES.EVENT_ORGANISER], organisationId: 10 };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR], fullName: 'Chloe Lim' };
const otherCoordinator = { id: 4, roles: [ROLES.EVENT_COORDINATOR], fullName: 'Dan Ong' };

let event;
let builder;

function submittedUnassigned() {
  return {
    id: 3,
    name: 'Leadership Forum',
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: null,
    status: 'SUBMITTED',
    purpose: 'Briefing',
    description: 'Forum',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  event = submittedUnassigned();
  builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };
  db.supabase.from.mockReturnValue(builder);
  db.fetchOne.mockImplementation(async () => event);
  db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);
  db.updateById.mockImplementation(async (_table, _id, patch) => {
    Object.assign(event, patch);
    return event;
  });
  db.insertOne.mockImplementation(async (table, row) => ({ id: 1, ...row }));
});

describe('SCRUM-45 AC1: Organiser notices on existing paths', () => {
  /*
   * AC:       SCRUM-45 AC1 (event submission)
   * Scenario: Organiser submits a complete draft.
   * Setup:    DRAFT "Leadership Forum" owned by Organiser 1 with every required field filled.
   * Expected: Status SUBMITTED. One EVENT_SUBMITTED notice, to Organiser 1 only, naming the
   *           event. No Coordinator is chosen or told.
   * Type:     normal
   * Side note: SCRUM-28 owns the submit rules (queue, no Coordinator); this test owns the notice.
   */
  // SCRUM-45-TC01
  it('SCRUM-45 AC1: submitting an event notifies its Organiser only', async () => {
    event.status = 'DRAFT';
    event.coordinator_id = null;
    event.start_at = '2026-12-01T10:00:00.000Z';
    event.end_at = '2026-12-01T12:00:00.000Z';
    event.expected_attendance = 40;
    event.venue_requirements = 'Hall';
    event.accessibility_needs = 'Step-free';
    db.fetchOne.mockResolvedValue(event);

    await events.submitEvent(organiser, 3);

    expect(event.status).toBe('SUBMITTED');
    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'EVENT_SUBMITTED',
      'Event submitted',
      expect.stringMatching(/Leadership Forum/),
      3
    );
  });

  /*
   * AC:       SCRUM-45 AC1 (clarification request)
   * Scenario: Assigned Coordinator requests clarification.
   * Setup:    UNDER_REVIEW, Coordinator 2, Organiser 1.
   * Expected: One CLARIFICATION_REQUESTED notice, to Organiser 1 only, naming the event.
   * Type:     normal
   */
  // SCRUM-45-TC02
  it('SCRUM-45 AC1: a clarification request notifies only that event Organiser', async () => {
    event.status = 'UNDER_REVIEW';
    event.coordinator_id = 2;
    event.sub_state = 'IN_REVIEW';
    db.fetchOne.mockResolvedValue(event);

    await events.requestClarification(coordinator, 3, 'Please confirm banquet layout numbers.');

    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'CLARIFICATION_REQUESTED',
      expect.any(String),
      expect.stringMatching(/Leadership Forum/),
      3
    );
  });

  /*
   * AC:       SCRUM-45 AC1 (approval)
   * Scenario: Assigned Coordinator approves an Under Review request.
   * Setup:    UNDER_REVIEW, Coordinator 2 (the actor), Organiser 1.
   * Expected: One EVENT_STATUS_CHANGED notice, to Organiser 1 only. The Coordinator who
   *           approved is not told about their own action.
   * Type:     normal
   * Side note: rejection and the reason are SCRUM-44-N05; not repeated here.
   */
  // SCRUM-45-TC03
  it('SCRUM-45 AC1: approving notifies only that event Organiser', async () => {
    event.status = 'UNDER_REVIEW';
    event.coordinator_id = 2;
    event.sub_state = 'IN_REVIEW';
    // A copy, so the update below does not change the status the notice is built from.
    db.fetchOne.mockImplementation(async () => ({ ...event }));

    await events.changeStatus(coordinator, 3, 'APPROVED');

    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'EVENT_STATUS_CHANGED',
      'Event request approved',
      expect.stringMatching(/Leadership Forum/),
      3
    );
  });
});

describe('SCRUM-45 AC2, AC3, AC5: Lead assignment notices', () => {
  /*
   * AC:       SCRUM-45 AC2, AC3, AC5
   * Scenario: Lead assigns Coordinator 2 to Organiser 1's Submitted event.
   * Setup:    Unassigned SUBMITTED event "Leadership Forum"; active Coordinator 2.
   * Expected: Exactly two COORDINATOR_ASSIGNED notices, to Coordinator 2 and Organiser 1;
   *           bodies name the event; Coordinator 4 and the Lead are not told.
   * Type:     normal
   * Side note: this is the one end-to-end assign notice; SCRUM-29 refers to it.
   */
  // SCRUM-45-TC04
  it('SCRUM-45 AC2/AC5: Lead assign notifies the new Coordinator and the Organiser only', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 2, full_name: 'Chloe Lim', is_active: true })
      .mockResolvedValue(event);

    await events.assignPrimaryCoordinator(lead, 3, 2);

    expect(audit.notifyUser).toHaveBeenCalledTimes(2);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2,
      'COORDINATOR_ASSIGNED',
      'Event assigned to you',
      expect.stringMatching(/Leadership Forum/),
      3
    );
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'COORDINATOR_ASSIGNED',
      'Coordinator assigned',
      expect.stringMatching(/Leadership Forum/),
      3
    );
    const recipients = audit.notifyUser.mock.calls.map(([userId]) => userId);
    expect(recipients).not.toContain(4);
    expect(recipients).not.toContain(11);
  });

  /*
   * AC:       SCRUM-45 AC2, AC5
   * Scenario: Event has no organiser_id; Lead still assigns a Coordinator.
   * Setup:    organiser_id null; otherwise ready to assign.
   * Expected: One notice, to the Coordinator only; the assign still succeeds.
   * Type:     boundary
   */
  // SCRUM-45-TC05
  it('SCRUM-45 AC2: Lead assign with no organiser notifies only the Coordinator', async () => {
    event.organiser_id = null;
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 2, full_name: 'Chloe Lim', is_active: true })
      .mockResolvedValue(event);

    await events.assignPrimaryCoordinator(lead, 3, 2);

    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2,
      'COORDINATOR_ASSIGNED',
      expect.any(String),
      expect.any(String),
      3
    );
  });

  /*
   * AC:       SCRUM-45 AC2, AC5
   * Scenario: Assign is refused because a Coordinator is already set.
   * Setup:    coordinator_id already 2, status UNDER_REVIEW.
   * Expected: 409 ALREADY_ASSIGNED; no notice is created.
   * Type:     error
   */
  // SCRUM-45-TC06
  it('SCRUM-45 AC2: a refused Lead assign creates no assignment notices', async () => {
    event.coordinator_id = 2;
    event.status = 'UNDER_REVIEW';
    db.fetchOne.mockResolvedValueOnce(event);

    await expect(events.assignPrimaryCoordinator(lead, 3, 4)).rejects.toMatchObject({
      status: 409,
      code: 'ALREADY_ASSIGNED',
    });
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-45 AC2, AC5
   * Scenario: Lead assigns when the event name is missing.
   * Setup:    name null; otherwise a ready Submitted unassigned event.
   * Expected: Both notices still go out, with "An event" in the body.
   * Type:     boundary
   */
  // SCRUM-45-TC07
  it('SCRUM-45 AC2: Lead assign with a missing event name uses the An event fallback', async () => {
    event.name = null;
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 2, full_name: 'Chloe Lim', is_active: true })
      .mockResolvedValue(event);

    await events.assignPrimaryCoordinator(lead, 3, 2);

    expect(audit.notifyUser).toHaveBeenCalledTimes(2);
    expect(audit.notifyUser.mock.calls.every(([, , , body]) => /An event/.test(body))).toBe(true);
  });
});

describe('SCRUM-45 AC2: Coordinator notice for a clarification response', () => {
  /*
   * AC:       SCRUM-45 AC2 (clarification)
   * Scenario: Organiser responds to an ACTION_REQUIRED clarification.
   * Setup:    UNDER_REVIEW + ACTION_REQUIRED; Coordinator 2; Organiser 1 (the actor).
   * Expected: One CLARIFICATION_PROVIDED notice, to Coordinator 2 only.
   * Type:     normal
   */
  // SCRUM-45-TC08
  it('SCRUM-45 AC2: a clarification response notifies only the assigned Coordinator', async () => {
    event.status = 'UNDER_REVIEW';
    event.coordinator_id = 2;
    event.sub_state = 'ACTION_REQUIRED';
    db.fetchOne.mockResolvedValue(event);

    await events.respondClarification(organiser, 3, 'Attendance confirmed at 40.');

    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2,
      'CLARIFICATION_PROVIDED',
      expect.any(String),
      expect.stringMatching(/Leadership Forum|Attendance confirmed/i),
      3
    );
  });
});

describe('SCRUM-45 assignment notice HTTP routes', () => {
  const app = createApp();
  const token = jwt.sign({ sub: 11 }, env.jwtSecret);

  /*
   * AC:       SCRUM-45 AC2, AC5
   * Scenario: Lead assigns via the real assign-coordinator route.
   * Setup:    Cookie for Lead 11; Submitted unassigned event; candidate 2 is an active Coordinator.
   * Expected: 200; COORDINATOR_ASSIGNED requested for users 2 and 1.
   * Type:     normal
   * Side note: the same notice without the route is SCRUM-45-TC04.
   */
  // SCRUM-45-TC09
  it('SCRUM-45 AC2/AC5: POST assign-coordinator notifies Coordinator and Organiser', async () => {
    db.fetchOne
      .mockResolvedValueOnce({ id: 11, is_active: true })
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 2, full_name: 'Chloe Lim', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }])
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR }]);

    const res = await request(app)
      .post('/api/events/3/assign-coordinator')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ coordinatorId: 2 });

    expect(res.status).toBe(200);
    // Route params are strings; service passes eventId through as received.
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2,
      'COORDINATOR_ASSIGNED',
      expect.any(String),
      expect.any(String),
      expect.anything()
    );
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'COORDINATOR_ASSIGNED',
      expect.any(String),
      expect.any(String),
      expect.anything()
    );
  });

  /*
   * AC:       SCRUM-45 AC2, AC5
   * Scenario: Incoming Coordinator accepts through the real HTTP route.
   * Setup:    Cookie for Coordinator 4; pending reassignment from 2; event owned by Organiser 1.
   * Expected: 200; Organiser and outgoing Coordinator notified; incoming not notified again.
   * Type:     normal
   * Side note: the same notices without the route are SCRUM-29-TC10 and TC12.
   */
  // SCRUM-45-TC10
  it('SCRUM-45 AC2/AC5: POST reassign/accept notifies Organiser and outgoing Coordinator', async () => {
    const acceptApp = createApp();
    const acceptToken = jwt.sign({ sub: 4 }, env.jwtSecret);
    event.coordinator_id = 2;
    event.status = 'PLANNING';
    const pending = {
      id: 9,
      event_id: 3,
      from_coordinator_id: 2,
      to_coordinator_id: 4,
      status: 'PENDING',
    };
    db.fetchOne
      .mockResolvedValueOnce({ id: 4, is_active: true })
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(event)
      .mockResolvedValue(event);
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR }]);

    const res = await request(acceptApp)
      .post('/api/events/3/reassign/accept')
      .set('Cookie', `${env.sessionCookieName}=${acceptToken}`);

    expect(res.status).toBe(200);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'COORDINATOR_CHANGED',
      expect.any(String),
      expect.any(String),
      expect.anything()
    );
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2,
      'COORDINATOR_UNASSIGNED',
      expect.any(String),
      expect.any(String),
      expect.anything()
    );
    const recipients = audit.notifyUser.mock.calls.map(([userId]) => userId);
    expect(recipients).not.toContain(4);
  });
});

describe('SCRUM-45 reassignment error path (the notices themselves are SCRUM-29)', () => {
  /*
   * AC:       SCRUM-45 AC2, AC5
   * Scenario: Accept with no matching pending request.
   * Setup:    fetchOne returns null for the reassignment row.
   * Expected: 404; no notices.
   * Type:     error
   * Side note: the request and accept notices are SCRUM-29-TC09, TC10, TC12 and TC16;
   *           SCRUM-29-TC07 checks the same 'refused, nobody told' rule for a request.
   */
  // SCRUM-45-TC17
  it('SCRUM-45 AC2: accepting with no pending reassignment creates no notices', async () => {
    db.fetchOne.mockResolvedValueOnce(null);

    await expect(events.acceptCoordinatorChange(otherCoordinator, 3)).rejects.toMatchObject({
      status: 404,
    });
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });
});

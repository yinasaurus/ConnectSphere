/**
 * SCRUM-45: Notify Event Organisers and Coordinators — assignment / reassignment notices
 * (and smoke checks that other AC1 paths still notify only the relevant parties).
 *
 * SCRUM-29 also covers assignment notices: the E2E assign notice is tested once here;
 * SCRUM-29 should refer to this suite rather than duplicating it.
 *
 * SCRUM-33: a Coordinator request or accept is rejected and sends no notice.
 * Reassignment notices are asserted on the Lead reassign action.
 *
 * Already covered elsewhere (do not re-implement):
 *   AC1 approve/reject → events.decision / events.notifications (EVENT_STATUS_CHANGED)
 *   AC1 clarification request → requestClarification tests / EventDetail SCRUM-16
 *   AC1 important changes → events.notifications.test.js (SCRUM-44)
 *   AC4 new/viewed UI → Notifications.jsx + notifications.status.test.js
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

describe('SCRUM-45 Lead assignment notices (AC2, AC3, AC5)', () => {
  /*
   * AC:       SCRUM-45 AC2, AC3, AC5
   * Scenario: Lead assigns Coordinator 2 to Organiser 1's Submitted event.
   * Setup:    Unassigned SUBMITTED event "Leadership Forum"; active Coordinator 2.
   * Expected: Exactly two COORDINATOR_ASSIGNED notices — to Coordinator 2 and Organiser 1;
   *           bodies name the event; no other user ids.
   * Type:     normal
   */
  it('US45-B01: Lead assign notifies the new Coordinator and the Organiser only', async () => {
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
   * Expected: One notice to the Coordinator only; assign still succeeds.
   * Type:     boundary
   */
  it('US45-B02: Lead assign with no organiser notifies only the Coordinator', async () => {
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
   * Scenario: Assign is refused because a Coordinator is already set (reassignment path).
   * Setup:    coordinator_id already 2.
   * Expected: 409; zero notifyUser calls.
   * Type:     error
   */
  it('US45-B03: a refused Lead assign creates no assignment notices', async () => {
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
   * Setup:    name null; otherwise ready Submitted unassigned event.
   * Expected: Both notices use the "An event" fallback in the body.
   * Type:     boundary
   */
  it('US45-B09: Lead assign with a missing event name uses the An event fallback', async () => {
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

describe('SCRUM-45 reassignment notices (AC2, AC3, AC5)', () => {
  /*
   * AC:       SCRUM-33 AC2, AC3 (this used to be the SCRUM-45 request notice)
   * Scenario: The assigned Coordinator asks another Coordinator to take the event.
   * Setup:    Event assigned to Coordinator 2, who is not a Lead. Week 7 change #5
   *           blocks that caller. The Lead reassignment notice is US45-B05.
   * Expected: 403 FORBIDDEN. Nobody is notified, no handover row is stored, and
   *           the Coordinator on the event is still 2.
   * Type:     error
   */
  it('US45-B04: a Coordinator reassignment request is rejected and notifies nobody', async () => {
    event.coordinator_id = 2;
    event.status = 'PLANNING';

    await expect(events.requestCoordinatorChange(coordinator, 3, 4)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });

    expect(audit.notifyUser).not.toHaveBeenCalled();
    expect(db.insertOne).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBe(2);
  });

  /*
   * AC:       SCRUM-45 AC2, AC3, AC5
   * Scenario: The Lead replaces the Coordinator. There is no earlier request, so the
   *           incoming Coordinator has not been told yet.
   * Setup:    Event assigned to Coordinator 2. Lead 11 chooses active Coordinator 4.
   *           SCRUM-33: a Coordinator accept is no longer how this notice is sent.
   * Expected: Organiser 1 gets COORDINATOR_CHANGED, outgoing 2 gets COORDINATOR_UNASSIGNED,
   *           and incoming 4 gets COORDINATOR_ASSIGNED. Nobody else is told.
   * Type:     normal
   */
  it('US45-B05: a Lead reassignment notifies the Organiser and both Coordinators', async () => {
    event.coordinator_id = 2;
    event.status = 'PLANNING';
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 4, full_name: 'Dan Ong', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);

    await events.reassignEventCoordinator(lead, 3, 4);

    expect(audit.notifyUser).toHaveBeenCalledTimes(3);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'COORDINATOR_CHANGED',
      'Coordinator changed',
      expect.stringMatching(/Leadership Forum/),
      3
    );
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2,
      'COORDINATOR_UNASSIGNED',
      'You are no longer assigned',
      expect.stringMatching(/Leadership Forum/),
      3
    );
    expect(audit.notifyUser).toHaveBeenCalledWith(
      4,
      'COORDINATOR_ASSIGNED',
      'Event assigned to you',
      expect.stringMatching(/Leadership Forum/),
      3
    );
  });

  /*
   * AC:       SCRUM-33 AC2, AC3
   * Scenario: A Coordinator accepts a handover. They are not a Lead.
   * Setup:    Caller is Coordinator 4. Whether a pending row exists does not matter,
   *           because the role check happens first.
   * Expected: 403 FORBIDDEN and no notices. The older 404 for a missing request
   *           applies only after a Lead gets past this check.
   * Type:     error
   */
  it('US45-B06: a Coordinator cannot accept a reassignment, so no notices are sent', async () => {
    await expect(events.acceptCoordinatorChange(otherCoordinator, 3)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(audit.notifyUser).not.toHaveBeenCalled();
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-45 AC2, AC5
   * Scenario: The Lead reassigns an event that has no Organiser on the record.
   * Setup:    organiser_id null. Event assigned to Coordinator 2. Replacement is
   *           active Coordinator 4.
   * Expected: Outgoing Coordinator 2 and incoming Coordinator 4 are told. There is
   *           no Organiser notice and no third call.
   * Type:     boundary
   */
  it('US45-B10: a Lead reassignment with no organiser notifies the two Coordinators', async () => {
    event.organiser_id = null;
    event.coordinator_id = 2;
    event.status = 'PLANNING';
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 4, full_name: 'Dan Ong', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);

    await events.reassignEventCoordinator(lead, 3, 4);

    expect(audit.notifyUser).toHaveBeenCalledTimes(2);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2,
      'COORDINATOR_UNASSIGNED',
      expect.any(String),
      expect.any(String),
      3
    );
    expect(audit.notifyUser).toHaveBeenCalledWith(
      4,
      'COORDINATOR_ASSIGNED',
      expect.any(String),
      expect.any(String),
      3
    );
  });
});

describe('SCRUM-45 AC1 smoke (existing paths; no duplicate product behaviour)', () => {
  /*
   * AC:       SCRUM-45 AC1 (submission — team choice: no notice; Lead uses unassigned queue)
   * Scenario: Organiser submits a complete draft.
   * Setup:    DRAFT owned by organiser 1 with required fields.
   * Expected: Status SUBMITTED; notifyUser never called.
   * Type:     boundary
   */
  it('US45-B07: submitting an event does not create a submission notice', async () => {
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
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-45 AC1 (clarification request → Organiser)
   * Scenario: Assigned Coordinator requests clarification.
   * Setup:    UNDER_REVIEW, coordinator 2, organiser 1.
   * Expected: One CLARIFICATION_REQUESTED to organiser 1 only.
   * Type:     normal
   */
  it('US45-B08: clarification request notifies only that event Organiser', async () => {
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
   * AC:       SCRUM-45 AC1 (approval → Organiser)
   * Scenario: Assigned Coordinator approves an Under Review request.
   * Setup:    UNDER_REVIEW, coordinator 2, organiser 1.
   * Expected: Organiser 1 receives EVENT_STATUS_CHANGED; only organiser/coordinator ids notified.
   * Type:     normal
   */
  it('US45-B11: approving notifies only that event Organiser (and assigned Coordinator if distinct)', async () => {
    event.status = 'UNDER_REVIEW';
    event.coordinator_id = 2;
    event.sub_state = 'IN_REVIEW';
    db.fetchOne.mockResolvedValue(event);

    await events.changeStatus(coordinator, 3, 'APPROVED');

    const orgNotices = audit.notifyUser.mock.calls.filter(
      ([userId, type]) => userId === 1 && type === 'EVENT_STATUS_CHANGED'
    );
    expect(orgNotices.length).toBeGreaterThanOrEqual(1);
    expect(audit.notifyUser.mock.calls.every(([userId]) => userId === 1 || userId === 2)).toBe(true);
  });

  /*
   * AC:       SCRUM-45 AC2 (clarification response → Coordinator)
   * Scenario: Organiser responds to an ACTION_REQUIRED clarification.
   * Setup:    UNDER_REVIEW + ACTION_REQUIRED; coordinator 2.
   * Expected: One CLARIFICATION_PROVIDED to Coordinator 2 only.
   * Type:     normal
   */
  it('US45-B12: clarification response notifies only the assigned Coordinator', async () => {
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

describe('SCRUM-45 assignment notice HTTP route', () => {
  const app = createApp();
  const token = jwt.sign({ sub: 11 }, env.jwtSecret);

  /*
   * AC:       SCRUM-45 AC2, AC5
   * Scenario: Lead assigns via the real assign-coordinator route.
   * Setup:    Cookie for Lead 11; Submitted unassigned event; candidate 2 active Coordinator.
   * Expected: 200; COORDINATOR_ASSIGNED requested for users 2 and 1.
   * Type:     normal
   */
  it('US45-R01: POST assign-coordinator notifies Coordinator and Organiser', async () => {
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
   * Scenario: The Lead reassigns through the real HTTP route, so the relevant users are told.
   * Setup:    Cookie for Lead 11. Event 3 is held by Coordinator 2. Body names active
   *           Coordinator 4. SCRUM-33 rejects a Coordinator accept on /reassign/accept,
   *           so this notice is sent from the Lead route instead.
   * Expected: 200. Organiser, outgoing Coordinator, and incoming Coordinator are each told once.
   * Type:     normal
   */
  it('US45-R02: POST reassign-coordinator notifies the Organiser and both Coordinators', async () => {
    event.coordinator_id = 2;
    event.status = 'PLANNING';
    db.fetchOne
      .mockResolvedValueOnce({ id: 11, is_active: true })
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 4, full_name: 'Dan Ong', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }])
      .mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);

    const res = await request(app)
      .post('/api/events/3/reassign-coordinator')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ coordinatorId: 4 });

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
    expect(audit.notifyUser).toHaveBeenCalledWith(
      4,
      'COORDINATOR_ASSIGNED',
      expect.any(String),
      expect.any(String),
      expect.anything()
    );
  });
});

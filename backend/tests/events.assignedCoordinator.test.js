/**
 * SCRUM-29: View and notify the assigned Coordinator.
 *
 * What this suite covers (and what it deliberately does not repeat):
 *   AC1  Assigned Coordinator shown on the event record  -> display tests below (US29-D*)
 *   AC3  After a reassign the Organiser sees the new one  -> display + accept tests (US29-D04, US29-N03)
 *   AC4  Notified on every assign/reassign, not only first -> repeat tests (US29-N01, US29-N02)
 *   AC5  Previous Coordinator told they are unassigned     -> helper tests (US29-H*)
 *   AC2  Coordinator notified immediately on assignment    -> tested end to end ONCE in
 *        events.assignmentNotice.test.js (SCRUM-45-TC04, TC09). Not duplicated here (story note).
 *
 * Not built here: the Lead's reassign action is SCRUM-31. The shared helper
 * notifyCoordinatorReassigned is what that action will call, so its notices are tested now.
 * Channel: in-app only (agreed). Previous Coordinator being a "relevant user" is an assumption
 * to confirm with the customer.
 */
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
const { ROLES } = require('../src/constants/roles');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const { env } = require('../src/config/env');

const lead = { id: 11, roles: [ROLES.EVENT_COORDINATOR_LEAD] };
const organiser = { id: 1, roles: [ROLES.EVENT_ORGANISER], organisationId: 10 };
const otherOrganiser = { id: 9, roles: [ROLES.EVENT_ORGANISER], organisationId: 99 };
const attendee = { id: 50, roles: [ROLES.ATTENDEE] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR], fullName: 'Chloe Lim' };
const otherCoordinator = { id: 4, roles: [ROLES.EVENT_COORDINATOR], fullName: 'Dan Ong' };

let event;
let builder;

function plannedEvent() {
  return {
    id: 3,
    name: 'Leadership Forum',
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    coordinator: { full_name: 'Chloe Lim' },
    status: 'PLANNING',
    purpose: 'Briefing',
    description: 'Forum',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  event = plannedEvent();
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

describe('SCRUM-29 AC1 + AC3: the event record shows the assigned Coordinator', () => {
  /*
   * AC:       SCRUM-29 AC1
   * Scenario: The Organiser opens their own event after a Coordinator was assigned.
   * Setup:    Event owned by organisation 10, coordinator_id 2 joined as "Chloe Lim".
   * Expected: coordinatorId 2 and coordinatorName "Chloe Lim" on the returned event.
   * Type:     normal
   */
  // SCRUM-29-TC01
  it('US29-D01: Organiser sees the assigned Coordinator on their event', async () => {
    const result = await events.getEvent(organiser, 3);
    expect(result.coordinatorId).toBe(2);
    expect(result.coordinatorName).toBe('Chloe Lim');
  });

  /*
   * AC:       SCRUM-29 AC1
   * Scenario: The event has no Coordinator yet.
   * Setup:    coordinator_id null, no joined coordinator row.
   * Expected: coordinatorId null and coordinatorName null (page shows "Unassigned").
   * Type:     boundary
   */
  // SCRUM-29-TC02
  it('US29-D02: an unassigned event has no Coordinator name', async () => {
    event.coordinator_id = null;
    event.coordinator = null;
    event.status = 'SUBMITTED';
    const result = await events.getEvent(organiser, 3);
    expect(result.coordinatorId).toBeNull();
    expect(result.coordinatorName).toBeNull();
  });

  /*
   * AC:       SCRUM-29 AC1
   * Scenario: An Organiser from a different organisation asks for the event.
   * Setup:    organisationId 99 against an event owned by organisation 10.
   * Expected: 404 NOT_FOUND, so the Coordinator is not leaked across organisations.
   * Type:     error
   */
  // SCRUM-29-TC03
  it('US29-D03: another organisation cannot see the Coordinator', async () => {
    await expect(events.getEvent(otherOrganiser, 3)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  /*
   * AC:       SCRUM-29 AC3
   * Scenario: The Coordinator changes from Chloe (2) to Dan (4); the Organiser reloads.
   * Setup:    Pending 2 -> 4; Dan accepts; the stored row then joins "Dan Ong".
   * Expected: The event the Organiser loads next shows coordinatorId 4 / "Dan Ong",
   *           and no longer shows Chloe.
   * Type:     normal
   * Limit:    the database is mocked, so the test itself sets the joined name when
   *           coordinator_id changes. It proves accept writes the new id and the next read
   *           maps it; it cannot prove the real database join.
   */
  // SCRUM-29-TC04
  it('US29-D04: after a reassignment the Organiser sees the new Coordinator', async () => {
    const pending = {
      id: 9,
      event_id: 3,
      from_coordinator_id: 2,
      to_coordinator_id: 4,
      status: 'PENDING',
    };
    db.fetchOne
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(event)
      .mockResolvedValue(event);
    db.updateById.mockImplementation(async (table, _id, patch) => {
      Object.assign(event, patch);
      // The real database re-joins the new Coordinator on the next read.
      if (patch.coordinator_id === 4) event.coordinator = { full_name: 'Dan Ong' };
      return event;
    });

    await events.acceptCoordinatorChange(otherCoordinator, 3);
    const seenByOrganiser = await events.getEvent(organiser, 3);

    expect(seenByOrganiser.coordinatorId).toBe(4);
    expect(seenByOrganiser.coordinatorName).toBe('Dan Ong');
  });

  /*
   * AC:       SCRUM-29 AC1 (Attendee view stays public, SCRUM-39 AC1)
   * Scenario: An Attendee opens a Confirmed, registration-enabled event.
   * Setup:    Confirmed event with a Coordinator assigned.
   * Expected: No coordinatorName or coordinatorId on the Attendee copy.
   * Type:     boundary
   */
  // SCRUM-29-TC05
  it('US29-D05: Attendees do not see who the Coordinator is', async () => {
    event.status = 'CONFIRMED';
    event.registration_required = true;
    const result = await events.getEvent(attendee, 3);
    expect(result).not.toHaveProperty('coordinatorName');
    expect(result).not.toHaveProperty('coordinatorId');
  });
});

describe('SCRUM-29 AC1 over HTTP and AC5 guard', () => {
  /*
   * AC:       SCRUM-29 AC1
   * Scenario: The Organiser's browser asks the real route for their event.
   * Setup:    Cookie for Organiser 1 (organisation 10); event assigned to Chloe (2).
   * Expected: 200 and event.coordinatorName "Chloe Lim" in the JSON the page receives.
   * Type:     normal
   */
  // SCRUM-29-TC06
  it('US29-R01: GET /api/events/:id returns the Coordinator name to the Organiser', async () => {
    const app = createApp();
    const token = jwt.sign({ sub: 1 }, env.jwtSecret);
    db.fetchOne
      .mockResolvedValueOnce({ id: 1, is_active: true, organisation_id: 10 })
      .mockResolvedValue(event);
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_ORGANISER }]);

    const res = await request(app)
      .get('/api/events/3')
      .set('Cookie', `${env.sessionCookieName}=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.event.coordinatorName).toBe('Chloe Lim');
  });

  /*
   * AC:       SCRUM-29 AC4 (a notice is only sent for a real, permitted request)
   * Scenario: Dan (4), who does not hold the event, tries to ask Eve (5) to take over.
   * Setup:    Event assigned to Chloe (2).
   * Expected: 403 FORBIDDEN; no reassignment row is written and nobody is notified.
   * Type:     error
   */
  // SCRUM-29-TC07
  it('US29-E01: a non-owner cannot request a reassignment and nobody is notified', async () => {
    await expect(events.requestCoordinatorChange(otherCoordinator, 3, 5)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(db.insertOne).not.toHaveBeenCalled();
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });
});

describe('SCRUM-29 AC4: notified each time, not only the first time', () => {
  /*
   * AC:       SCRUM-29 AC4
   * Scenario: The Lead assigns Chloe to an unassigned event, and the same assignment happens
   *           again later. (No unassign feature exists; the test resets the row by hand to
   *           stand in for the event being unassigned.)
   * Setup:    Submitted unassigned event; assign Chloe; reset to unassigned; assign again.
   * Expected: Chloe gets COORDINATOR_ASSIGNED twice — nothing de-duplicates by event/user.
   * Type:     normal
   */
  // SCRUM-29-TC08
  it('US29-N01: assigning the same Coordinator again sends a fresh notice', async () => {
    const assignOnce = async () => {
      event.coordinator_id = null;
      event.coordinator = null;
      event.status = 'SUBMITTED';
      db.fetchOne
        .mockResolvedValueOnce(event)
        .mockResolvedValueOnce({ id: 2, full_name: 'Chloe Lim', is_active: true })
        .mockResolvedValue(event);
      await events.assignPrimaryCoordinator(lead, 3, 2);
    };

    await assignOnce();
    await assignOnce();

    const toChloe = audit.notifyUser.mock.calls.filter(
      ([userId, type]) => userId === 2 && type === 'COORDINATOR_ASSIGNED'
    );
    expect(toChloe).toHaveLength(2);
  });

  /*
   * AC:       SCRUM-29 AC4
   * Scenario: Chloe asks Dan to take over the same event twice.
   * Setup:    Event assigned to Chloe (2); two reassignment requests to Dan (4). The service
   *           does not de-duplicate (decision: the request notice counts for AC4). Whether a
   *           second pending request should replace the first is an open product question.
   * Expected: Dan gets COORDINATOR_REASSIGN twice.
   * Type:     boundary
   */
  // SCRUM-29-TC09
  it('US29-N02: a repeat reassignment request notifies the same Coordinator again', async () => {
    db.fetchOne.mockResolvedValue(event);

    await events.requestCoordinatorChange(coordinator, 3, 4);
    await events.requestCoordinatorChange(coordinator, 3, 4);

    const toDan = audit.notifyUser.mock.calls.filter(
      ([userId, type]) => userId === 4 && type === 'COORDINATOR_REASSIGN'
    );
    expect(toDan).toHaveLength(2);
  });

  /*
   * AC:       SCRUM-29 AC3, AC4, AC5
   * Scenario: Full change of Coordinator through the request/accept path.
   * Setup:    Chloe (2) assigned; Chloe asks Dan (4); Dan accepts.
   * Expected: Dan was told on the request; on accept the Organiser (1) and Chloe (2) are
   *           told; Dan is not told twice for the same change.
   * Type:     normal
   */
  // SCRUM-29-TC10
  it('US29-N03: one reassignment tells Dan once, the Organiser once and Chloe once', async () => {
    db.fetchOne.mockResolvedValue(event);
    await events.requestCoordinatorChange(coordinator, 3, 4);

    const pending = {
      id: 9,
      event_id: 3,
      from_coordinator_id: 2,
      to_coordinator_id: 4,
      status: 'PENDING',
    };
    db.fetchOne
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(event)
      .mockResolvedValue(event);
    await events.acceptCoordinatorChange(otherCoordinator, 3);

    const byUser = (id) => audit.notifyUser.mock.calls.filter(([userId]) => userId === id);
    expect(byUser(4)).toHaveLength(1);
    expect(byUser(1)).toHaveLength(1);
    expect(byUser(2)).toHaveLength(1);
    expect(byUser(2)[0][1]).toBe('COORDINATOR_UNASSIGNED');
  });
});

describe('SCRUM-29 AC5: the previous Coordinator is whoever held the event', () => {
  /*
   * AC:       SCRUM-29 AC5
   * Scenario: An older request from Chloe (2) to Eve (5) is still pending, but the event
   *           has since moved to Dan (4). Eve accepts.
   * Setup:    Event coordinator_id 4; pending request from 2 to 5.
   * Expected: Dan (the real previous Coordinator) gets COORDINATOR_UNASSIGNED; Chloe, who
   *           no longer held the event, is not told she lost it.
   * Type:     conflict
   */
  // SCRUM-29-TC11
  it('US29-N04: a stale pending request tells the real previous Coordinator, not the sender', async () => {
    event.coordinator_id = 4;
    const stale = {
      id: 9,
      event_id: 3,
      from_coordinator_id: 2,
      to_coordinator_id: 5,
      status: 'PENDING',
    };
    db.fetchOne
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(event)
      .mockResolvedValue(event);

    await events.acceptCoordinatorChange({ id: 5, roles: [ROLES.EVENT_COORDINATOR] }, 3);

    const unassigned = audit.notifyUser.mock.calls.filter(([, type]) => type === 'COORDINATOR_UNASSIGNED');
    expect(unassigned.map(([userId]) => userId)).toEqual([4]);
  });
});

describe('SCRUM-29 AC3 + AC5: notifyCoordinatorReassigned (shared by accept now, SCRUM-31 later)', () => {
  const row = () => ({ id: 3, name: 'Leadership Forum', organiser_id: 1 });

  /*
   * AC:       SCRUM-29 AC3, AC5
   * Scenario: Reassign with no earlier request, as the Lead's action will do.
   * Setup:    Outgoing 2, incoming 4, notifyIncoming true.
   * Expected: Organiser gets COORDINATOR_CHANGED, Chloe gets COORDINATOR_UNASSIGNED, Dan
   *           gets COORDINATOR_ASSIGNED; each body names the event; three notices exactly.
   * Type:     normal
   */
  // SCRUM-29-TC12
  it('US29-H01: with notifyIncoming, all three relevant users are told', async () => {
    await events.notifyCoordinatorReassigned(row(), 2, 4, { notifyIncoming: true });

    expect(audit.notifyUser).toHaveBeenCalledTimes(3);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1, 'COORDINATOR_CHANGED', 'Coordinator changed', expect.stringMatching(/Leadership Forum/), 3
    );
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2, 'COORDINATOR_UNASSIGNED', 'You are no longer assigned', expect.stringMatching(/Leadership Forum/), 3
    );
    expect(audit.notifyUser).toHaveBeenCalledWith(
      4, 'COORDINATOR_ASSIGNED', 'Event assigned to you', expect.stringMatching(/Leadership Forum/), 3
    );
  });

  /*
   * AC:       SCRUM-29 AC4 / SCRUM-45 (no double notice on the request/accept path)
   * Scenario: Default options, as the accept path calls it.
   * Setup:    Outgoing 2, incoming 4, no options.
   * Expected: Only Organiser and outgoing are told; the incoming user is not.
   * Type:     boundary
   */
  // SCRUM-29-TC13
  it('US29-H02: by default the incoming Coordinator is not told again', async () => {
    await events.notifyCoordinatorReassigned(row(), 2, 4);

    expect(audit.notifyUser).toHaveBeenCalledTimes(2);
    const recipients = audit.notifyUser.mock.calls.map(([userId]) => userId);
    expect(recipients).toEqual(expect.arrayContaining([1, 2]));
    expect(recipients).not.toContain(4);
  });

  /*
   * AC:       SCRUM-29 AC5
   * Scenario: Event had no previous Coordinator.
   * Setup:    outgoing null, notifyIncoming true.
   * Expected: Organiser and incoming told; no UNASSIGNED notice, no crash.
   * Type:     boundary
   */
  // SCRUM-29-TC14
  it('US29-H03: no previous Coordinator means no unassigned notice', async () => {
    await events.notifyCoordinatorReassigned(row(), null, 4, { notifyIncoming: true });

    const types = audit.notifyUser.mock.calls.map(([, type]) => type);
    expect(types).toEqual(['COORDINATOR_CHANGED', 'COORDINATOR_ASSIGNED']);
  });

  /*
   * AC:       SCRUM-29 AC5
   * Scenario: Reassigned to the person who already holds it.
   * Setup:    outgoing 2, incoming 2, notifyIncoming true.
   * Expected: Nobody is told they are unassigned; the Coordinator is not told "no longer".
   * Type:     boundary
   */
  // SCRUM-29-TC15
  it('US29-H04: the same person as outgoing and incoming is never told they are unassigned', async () => {
    await events.notifyCoordinatorReassigned(row(), 2, 2, { notifyIncoming: true });

    const types = audit.notifyUser.mock.calls.map(([, type]) => type);
    expect(types).not.toContain('COORDINATOR_UNASSIGNED');
  });

  /*
   * AC:       SCRUM-29 AC3
   * Scenario: Event has no Organiser id and no name.
   * Setup:    organiser_id null, name null.
   * Expected: Organiser skipped; remaining body uses the "An event" fallback.
   * Type:     boundary
   */
  // SCRUM-29-TC16
  it('US29-H05: a missing Organiser is skipped and a missing name falls back', async () => {
    await events.notifyCoordinatorReassigned({ id: 3, name: null, organiser_id: null }, 2, 4);

    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2, 'COORDINATOR_UNASSIGNED', expect.any(String), expect.stringMatching(/An event/), 3
    );
  });
});

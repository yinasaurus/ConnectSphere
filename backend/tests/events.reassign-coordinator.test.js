/**
 * SCRUM-31: a Lead reassigns an event that already has a Coordinator.
 *
 * Labels:
 *   US31-B..  service rules (reassignEventCoordinator)
 *   US31-R..  HTTP route (auth cookie + Lead role + body validation)
 *
 * Notices are SCRUM-29 (US29-H01). The non-Lead refusal is SCRUM-33.
 * The audit row is SCRUM-32, in events.reassignAudit.test.js.
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
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

const lead = { id: 11, roles: [ROLES.EVENT_COORDINATOR_LEAD] };
const previousCoordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };

let event;

function assignedEvent() {
  return {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    status: 'UNDER_REVIEW',
    name: 'Leadership Forum',
    purpose: 'Plan',
    description: 'A forum',
    coordinator: { full_name: 'Chloe Lim' },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  event = assignedEvent();
  db.supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  });
  db.fetchOne.mockImplementation(async () => event);
  db.fetchMany.mockResolvedValue([]);
  db.updateById.mockImplementation(async (_table, _id, patch) => {
    Object.assign(event, patch);
    // The next read joins the new Coordinator's name, the same way the database would.
    if (patch.coordinator_id === 4) {
      event.coordinator = { full_name: 'Daniel Ong' };
    }
    return event;
  });
});

function queueReplacement() {
  db.fetchOne
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce({ id: 4, full_name: 'Daniel Ong', is_active: true })
    .mockResolvedValue(event);
  db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);
}

describe('SCRUM-31 reassign coordinator (service rules)', () => {
  /*
   * AC: SCRUM-31 AC1, AC2, AC3
   * Scenario: A Lead confirms a different active Coordinator on an event Chloe already holds.
   * Setup: Event 3 is UNDER_REVIEW with coordinator_id 2 (Chloe Lim). User 4 (Daniel Ong)
   *   is an active Coordinator. Status is one where Chloe would still be allowed to edit
   *   if she were still assigned, so a later refusal is because she was replaced.
   * Expected: The record stores coordinator 4 and the name Daniel Ong. The status stays
   *   UNDER_REVIEW. Chloe's edit is refused and the name she tried to write is not stored.
   *   Notice wording is US29-H01. This test does not check that a notice was sent.
   * Type: normal
   */
  it('US31-B01: a Lead replaces the assigned Coordinator and the previous one can no longer edit', async () => {
    queueReplacement();

    const result = await service.reassignEventCoordinator(lead, 3, 4);

    expect(result.coordinatorId).toBe(4); // AC3: the record now points at the new Coordinator
    expect(result.coordinatorName).toBe('Daniel Ong');
    expect(result.status).toBe('UNDER_REVIEW'); // status is not part of this change
    expect(db.updateById).toHaveBeenCalledTimes(1);
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      coordinator_id: 4,
    }));
    expect(db.insertOne).not.toHaveBeenCalled();

    await expect(service.updateEvent(previousCoordinator, 3, { name: 'Taken over' })).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(event.name).toBe('Leadership Forum'); // AC2: Chloe's edit did not land
    expect(event.coordinator_id).toBe(4);
    expect(db.updateById).toHaveBeenCalledTimes(1);
  });

  /*
   * AC: SCRUM-31 AC1, AC3
   * Scenario: The Lead reassigns an event whose status is outside review.
   * Setup: The same event and the same two Coordinators. Status is Draft (before review),
   *   Confirmed (after venue and technical arrangements, Week 9), or Completed (finished).
   *   Shiyin, 24 Oct 2026: reassignment is allowed in any status.
   * Expected: coordinator_id becomes 4 and the status value is the one the test started with.
   * Type: boundary
   */
  it.each(['DRAFT', 'CONFIRMED', 'COMPLETED'])(
    'US31-B02: a Lead can reassign while the event is %s',
    async (status) => {
      event.status = status;
      queueReplacement();

      const result = await service.reassignEventCoordinator(lead, 3, 4);

      expect(result.coordinatorId).toBe(4);
      expect(result.status).toBe(status);
      expect(event.coordinator_id).toBe(4);
    }
  );

  /*
   * AC: SCRUM-31 AC4
   * Scenario: The Lead selects the Coordinator who already holds the event.
   * Setup: Event 3 is held by coordinator 2. The request asks for coordinator 2 again.
   *   The candidate user is not loaded, so a refusal cannot depend on that lookup.
   * Expected: 409 ALREADY_ASSIGNED. coordinator_id stays 2 and nothing is written.
   * Type: boundary
   */
  it('US31-B03: reassigning to the Coordinator already assigned is rejected and the event is unchanged', async () => {
    await expect(service.reassignEventCoordinator(lead, 3, 2)).rejects.toMatchObject({
      status: 409,
      code: 'ALREADY_ASSIGNED',
    });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBe(2);
    expect(event.status).toBe('UNDER_REVIEW');
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-31 AC1
   * Scenario: The Lead selects a Coordinator whose account is inactive.
   * Setup: Event 3 is held by coordinator 2. User 9 exists with is_active false.
   *   Inactive accounts are not on the active-Coordinator list.
   * Expected: 409 INVALID_COORDINATOR. coordinator_id stays 2.
   * Type: error
   */
  it('US31-B04: an inactive Coordinator is rejected and the event is unchanged', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 9, full_name: 'Inactive', is_active: false });

    await expect(service.reassignEventCoordinator(lead, 3, 9)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_COORDINATOR',
    });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBe(2);
  });

  /*
   * AC: SCRUM-31 boundary with SCRUM-71. Not AC2. AC2 is the previous Coordinator
   *   losing edit access after a successful reassignment.
   * Scenario: The event has no Coordinator yet, so there is nobody to replace.
   * Setup: coordinator_id is null. Status is SUBMITTED, which is the first-assignment case
   *   owned by SCRUM-71. This action must not take that write over.
   * Expected: 409 NOT_ASSIGNED. The event stays unassigned.
   * Type: conflict
   */
  it('US31-B05: an event with no Coordinator cannot be reassigned', async () => {
    event.coordinator_id = null;
    event.status = 'SUBMITTED';

    await expect(service.reassignEventCoordinator(lead, 3, 4)).rejects.toMatchObject({
      status: 409,
      code: 'NOT_ASSIGNED',
    });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBeNull();
  });

  /*
   * AC: SCRUM-31 error path. Not AC3. AC3 is a successful reassignment updating the record.
   * Scenario: The event id does not exist.
   * Setup: The event lookup returns null. No Coordinator is loaded.
   * Expected: 404. Nothing is written.
   * Type: error
   */
  it('US31-B06: reassigning a missing event returns 404 and writes nothing', async () => {
    db.fetchOne.mockResolvedValueOnce(null);

    await expect(service.reassignEventCoordinator(lead, 99, 4)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

describe('SCRUM-31 POST /api/events/:id/reassign-coordinator (route)', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const token = jwt.sign({ sub: 11 }, env.jwtSecret);

  /*
   * AC: SCRUM-31 AC1, AC3
   * Scenario: The Lead reassigns through the real HTTP route.
   * Setup: Session user 11 is a Lead. Event 3 is UNDER_REVIEW and held by coordinator 2.
   *   Body coordinatorId 4 is an active Coordinator.
   * Expected: 200. The stored coordinator id is 4 and the status in the response is unchanged.
   * Type: normal
   */
  it('US31-R01: a Lead can reassign a Coordinator through the API', async () => {
    db.fetchOne
      .mockResolvedValueOnce({ id: 11, is_active: true })
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 4, full_name: 'Daniel Ong', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }])
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR }]);

    const res = await request(app)
      .post('/api/events/3/reassign-coordinator')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ coordinatorId: 4 });

    expect(res.status).toBe(200);
    expect(res.body.event.coordinatorId).toBe(4);
    expect(res.body.event.coordinatorName).toBe('Daniel Ong');
    expect(res.body.event.status).toBe('UNDER_REVIEW');
    expect(db.updateById).toHaveBeenCalledWith('events', '3', expect.objectContaining({
      coordinator_id: 4,
    }));
  });

  /*
   * AC: SCRUM-31 AC4
   * Scenario: The Lead posts the Coordinator who already holds the event.
   * Setup: Session is a Lead. Event 3 is held by coordinator 2. Body coordinatorId is 2.
   * Expected: 409. The event row is not written.
   * Type: boundary
   */
  it('US31-R02: the API rejects the Coordinator who is already assigned', async () => {
    db.fetchOne
      .mockResolvedValueOnce({ id: 11, is_active: true })
      .mockResolvedValueOnce(event);
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }]);

    const res = await request(app)
      .post('/api/events/3/reassign-coordinator')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ coordinatorId: 2 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_ASSIGNED');
    expect(db.updateById).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBe(2);
  });

  /*
   * AC: SCRUM-31 AC1
   * Scenario: The Lead posts a Coordinator who is not active.
   * Setup: Session is a Lead. Event 3 is held by coordinator 2. User 9 is inactive.
   * Expected: 409. The event row is not written.
   * Type: error
   */
  it('US31-R03: the API rejects an inactive Coordinator and leaves the event unchanged', async () => {
    db.fetchOne
      .mockResolvedValueOnce({ id: 11, is_active: true })
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 9, full_name: 'Inactive', is_active: false });
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }]);

    const res = await request(app)
      .post('/api/events/3/reassign-coordinator')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ coordinatorId: 9 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_COORDINATOR');
    expect(db.updateById).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBe(2);
  });

  /*
   * AC: SCRUM-31 AC1
   * Scenario: The request does not name a Coordinator.
   * Setup: Session is a Lead. The body is empty, so there is no selection from the list.
   * Expected: 400. The service does not write the event.
   * Type: error
   */
  it('US31-R04: a request with no Coordinator is rejected', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 11, is_active: true });
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }]);

    const res = await request(app)
      .post('/api/events/3/reassign-coordinator')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

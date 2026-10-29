/**
 * SCRUM-32: an audit entry is written when a reassignment is confirmed.
 * A request that is still pending is not confirmed, so it writes nothing.
 * The database is mocked. writeAudit is the audit_logs insert.
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
const outgoing = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const incoming = { id: 4, roles: [ROLES.EVENT_COORDINATOR] };

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
  db.updateById.mockImplementation(async (_table, _id, patch) => {
    Object.assign(event, patch);
    return event;
  });
  db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);
  audit.writeAudit.mockResolvedValue(undefined);
  audit.notifyUser.mockResolvedValue(undefined);
});

describe('SCRUM-32 audit a confirmed reassignment', () => {
  /*
   * AC: SCRUM-32 AC1, AC2
   * Scenario: A Lead replaces the Coordinator on an event.
   * Setup: Event 3 is held by Coordinator 2. Lead 11 chooses active Coordinator 4.
   *   The change is saved, so it is confirmed. A refused change is a different test.
   * Expected: One audit call. The actor is the Lead. The old Coordinator is 2 and the
   *   new one is 4. This test does not assert when. The insert test checks that
   *   created_at is left off the row so the database default records it.
   * Type: normal
   */
  it('records who changed the Coordinator, and the old and new Coordinator, when a Lead reassigns', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 4, full_name: 'Daniel Ong', is_active: true })
      .mockResolvedValue(event);

    await service.reassignEventCoordinator(lead, 3, 4);

    expect(audit.writeAudit).toHaveBeenCalledTimes(1);
    // AC2: who is the actor, and the metadata is the old and new Coordinator.
    expect(audit.writeAudit).toHaveBeenCalledWith(11, 'COORDINATOR_REASSIGNED', 'event', 3, {
      fromCoordinatorId: 2,
      toCoordinatorId: 4,
    });
  });

  /*
   * AC: SCRUM-32 AC1
   * Scenario: The Lead reassigns the same event twice, to two different Coordinators.
   * Setup: Event 3 starts with Coordinator 2. The first confirmed change is to 4.
   *   The second is to 5. Both replacements are active Coordinators.
   * Expected: Two audit entries, one for each confirmed change, with that change's
   *   old and new Coordinator. One entry must not be reused for both.
   * Type: normal
   */
  it('writes a separate audit entry for each confirmed reassignment', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 4, full_name: 'Daniel Ong', is_active: true })
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 5, full_name: 'Eve Tan', is_active: true })
      .mockResolvedValue(event);

    await service.reassignEventCoordinator(lead, 3, 4);
    await service.reassignEventCoordinator(lead, 3, 5);

    // AC1: one entry for each confirmed change, and no third entry.
    expect(audit.writeAudit).toHaveBeenCalledTimes(2);
    expect(audit.writeAudit).toHaveBeenNthCalledWith(1, 11, 'COORDINATOR_REASSIGNED', 'event', 3, {
      fromCoordinatorId: 2,
      toCoordinatorId: 4,
    });
    expect(audit.writeAudit).toHaveBeenNthCalledWith(2, 11, 'COORDINATOR_REASSIGNED', 'event', 3, {
      fromCoordinatorId: 4,
      toCoordinatorId: 5,
    });
  });

  /*
   * AC: SCRUM-32 AC1
   * Scenario: The Lead tries to reassign the event to the Coordinator who already holds it.
   * Setup: Event 3 is held by Coordinator 2. The Lead chooses 2. That change is refused
   *   before anything is saved, so it is not a confirmed reassignment.
   * Expected: No audit entry. The Coordinator on the event is still 2.
   * Type: error
   */
  it('does not write an audit entry when the reassignment is refused', async () => {
    db.fetchOne.mockResolvedValueOnce(event);

    await expect(service.reassignEventCoordinator(lead, 3, 2)).rejects.toMatchObject({
      status: 409,
      code: 'ALREADY_ASSIGNED',
    });
    expect(audit.writeAudit).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBe(2);
  });

  /*
   * AC: SCRUM-32 AC1, AC2
   * Scenario: The incoming Coordinator accepts a pending reassignment.
   * Setup: Coordinator 2 holds event 3 and has asked Coordinator 4 to take it.
   *   The request is still PENDING until Coordinator 4 accepts. Accepting saves the
   *   new Coordinator, which is the confirmed reassignment.
   * Expected: One audit entry. Who is Coordinator 4, the person who confirmed it.
   *   The old Coordinator is 2 and the new one is 4.
   * Type: normal
   */
  it('records the audit entry when the incoming Coordinator accepts', async () => {
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

    await service.acceptCoordinatorChange(incoming, 3);

    expect(audit.writeAudit).toHaveBeenCalledTimes(1);
    expect(audit.writeAudit).toHaveBeenCalledWith(4, 'COORDINATOR_REASSIGNED', 'event', 3, {
      fromCoordinatorId: 2,
      toCoordinatorId: 4,
    });
  });

  /*
   * AC: SCRUM-32 AC1
   * Scenario: A Coordinator accepts a reassignment, but there is no pending request for them.
   * Setup: Event 3 is held by Coordinator 2. Nothing is pending for Coordinator 4.
   * Expected: The accept is refused and no audit entry is written, because the Coordinator
   *   on the event did not change.
   * Type: error
   */
  it('does not write an audit entry when there is nothing to accept', async () => {
    db.fetchOne.mockResolvedValueOnce(null);

    await expect(service.acceptCoordinatorChange(incoming, 3)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(audit.writeAudit).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBe(2);
  });

  /*
   * AC: SCRUM-32 AC1
   * Scenario: The current Coordinator asks someone else to take the event, and nobody has accepted.
   * Setup: Coordinator 2 holds event 3 and requests Coordinator 4. The request stays PENDING.
   * Expected: No audit entry. Asking is not a confirmed reassignment, and the Coordinator
   *   on the event is still 2.
   * Type: boundary
   */
  it('does not write an audit entry for a reassignment that has only been requested', async () => {
    db.fetchOne.mockResolvedValue(event);

    await service.requestCoordinatorChange(outgoing, 3, 4);

    expect(audit.writeAudit).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBe(2);
  });

  /*
   * AC: SCRUM-32 AC1, AC2
   * Scenario: The Lead reassigns through the HTTP route.
   * Setup: Session user 11 is a Lead. Event 3 is held by Coordinator 2. The body names
   *   active Coordinator 4. The route is the same one SCRUM-31 added.
   * Expected: 200, and the same audit entry as the service call. The event id on the
   *   entry is the route param, which Express passes as a string.
   * Type: normal
   */
  it('writes the audit entry when a Lead reassigns over HTTP', async () => {
    const { createApp } = require('../src/app');
    const app = createApp();
    const token = jwt.sign({ sub: 11 }, env.jwtSecret);
    db.fetchOne
      .mockResolvedValueOnce({ id: 11, is_active: true })
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 4, full_name: 'Daniel Ong', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }])
      .mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);

    const res = await request(app)
      .post('/api/events/3/reassign-coordinator')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ coordinatorId: 4 });

    expect(res.status).toBe(200);
    // AC1: the route writes one entry, not a second one from notices or the reload.
    expect(audit.writeAudit).toHaveBeenCalledTimes(1);
    expect(audit.writeAudit).toHaveBeenCalledWith(11, 'COORDINATOR_REASSIGNED', 'event', '3', {
      fromCoordinatorId: 2,
      toCoordinatorId: 4,
    });
  });

  /*
   * AC: SCRUM-32 AC1, AC2
   * Scenario: The incoming Coordinator accepts through the HTTP route.
   * Setup: Session user 4 is a Coordinator. A pending request asks them to take event 3
   *   from Coordinator 2. The route is POST /api/events/:id/reassign/accept.
   * Expected: 200, and one audit entry. Who is Coordinator 4. The old Coordinator is 2
   *   and the new one is 4. The event id is the route param, which Express passes as a string.
   * Type: normal
   */
  it('writes the audit entry when the incoming Coordinator accepts over HTTP', async () => {
    const { createApp } = require('../src/app');
    const app = createApp();
    const token = jwt.sign({ sub: 4 }, env.jwtSecret);
    const pending = {
      id: 9,
      event_id: 3,
      from_coordinator_id: 2,
      to_coordinator_id: 4,
      status: 'PENDING',
    };
    db.fetchOne
      .mockResolvedValueOnce({ id: 4, is_active: true, full_name: 'Daniel Ong' })
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(event)
      .mockResolvedValue(event);
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);

    const res = await request(app)
      .post('/api/events/3/reassign/accept')
      .set('Cookie', `${env.sessionCookieName}=${token}`);

    expect(res.status).toBe(200);
    expect(audit.writeAudit).toHaveBeenCalledTimes(1);
    expect(audit.writeAudit).toHaveBeenCalledWith(4, 'COORDINATOR_REASSIGNED', 'event', '3', {
      fromCoordinatorId: 2,
      toCoordinatorId: 4,
    });
  });
});

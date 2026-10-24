/**
 * SCRUM-57: a Lead's assignment overview lists only the allocations they made.
 *
 * Who may open the overview is SCRUM-54. The unassigned queue is SCRUM-65.
 * Those checks are not repeated here.
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
const access = require('../src/services/access.service');
const events = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');

const lead = { id: 11, roles: [ROLES.EVENT_COORDINATOR_LEAD] };
const otherLead = { id: 12, roles: [ROLES.EVENT_COORDINATOR_LEAD] };

function chain() {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  };
}

function row(overrides) {
  return {
    id: 3,
    name: 'Leadership Forum',
    status: 'PLANNING',
    coordinator_id: 2,
    assigned_by_lead_id: 11,
    coordinator: { full_name: 'Chloe Lim' },
    ...overrides,
  };
}

let event;

beforeEach(() => {
  jest.clearAllMocks();
  event = {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: null,
    status: 'SUBMITTED',
    name: 'Leadership Forum',
    purpose: 'Plan',
    description: 'A forum',
  };
  db.supabase.from.mockReturnValue(chain());
  db.fetchOne.mockImplementation(async () => event);
  db.fetchMany.mockResolvedValue([]);
  db.updateById.mockImplementation(async (_table, _id, patch) => {
    Object.assign(event, patch);
    return event;
  });
});

describe('SCRUM-57 assignment overview for this Lead', () => {
  /*
   * AC: SCRUM-57 AC1
   * Scenario: A Lead opens the overview after assigning two Coordinators.
   * Setup: Chloe holds Leadership Forum. Daniel holds the Workshop. Both rows
   *   record assigned_by_lead_id 11, this Lead.
   * Expected: Both Coordinators are listed with their events.
   * Type: normal
   */
  it('US57-B01: the overview lists Coordinators this Lead assigned, with those events', async () => {
    db.fetchMany.mockResolvedValue([
      row({ id: 3, name: 'Leadership Forum', coordinator_id: 2, coordinator: { full_name: 'Chloe Lim' } }),
      row({
        id: 8, name: 'Workshop', coordinator_id: 4, coordinator: { full_name: 'Daniel Ong' },
      }),
    ]);

    const assignments = await access.listAssignmentOverview(lead);

    expect(assignments).toEqual([
      {
        eventId: 3, eventName: 'Leadership Forum', status: 'PLANNING',
        coordinatorId: 2, coordinatorName: 'Chloe Lim',
      },
      {
        eventId: 8, eventName: 'Workshop', status: 'PLANNING',
        coordinatorId: 4, coordinatorName: 'Daniel Ong',
      },
    ]);
  });

  /*
   * AC: SCRUM-57 AC2
   * Scenario: Two Leads have each assigned a Coordinator. This Lead opens the overview.
   * Setup: Leadership Forum was assigned by user 11. The Summit was assigned by user 12.
   *   Both have Coordinators and a status the overview would otherwise show.
   * Expected: Only Leadership Forum is returned. The Summit is left out.
   * Type: boundary
   */
  it('US57-B02: an event assigned by another Lead is not in this overview', async () => {
    db.fetchMany.mockResolvedValue([
      row({ id: 3, name: 'Leadership Forum', assigned_by_lead_id: 11 }),
      row({
        id: 9, name: 'Summit', assigned_by_lead_id: 12, coordinator_id: 4,
        coordinator: { full_name: 'Daniel Ong' },
      }),
    ]);

    const assignments = await access.listAssignmentOverview(lead);

    expect(assignments.map((item) => item.eventName)).toEqual(['Leadership Forum']);
  });

  /*
   * AC: SCRUM-57 AC3
   * Scenario: One event has a Coordinator and one is still unassigned.
   * Setup: Leadership Forum is assigned by this Lead. Waiting has coordinator_id null.
   *   The unassigned queue is a different function and is not changed here.
   * Expected: The overview contains Leadership Forum only.
   * Type: boundary
   */
  it('US57-B03: an unassigned event is not in this overview', async () => {
    db.fetchMany.mockResolvedValue([
      row({ id: 3, name: 'Leadership Forum' }),
      row({ id: 9, name: 'Waiting', coordinator_id: null, coordinator: null, status: 'SUBMITTED' }),
    ]);

    const assignments = await access.listAssignmentOverview(lead);

    expect(assignments.map((item) => item.eventName)).toEqual(['Leadership Forum']);
  });

  /*
   * AC: SCRUM-57 AC5
   * Scenario: This Lead assigned events that are still active and events that are finished or not started.
   * Setup: Planning and Confirmed stay. Draft, Completed, Cancelled, and Rejected are the four
   *   statuses the AC leaves out. Confirmed stays because AC5 leaves it off that list.
   *   Every row is assigned by this Lead and has a Coordinator.
   * Expected: The Planning event and the Confirmed event are returned.
   * Type: boundary
   */
  it('US57-B04: Draft, Completed, Cancelled, and Rejected events are left out', async () => {
    db.fetchMany.mockResolvedValue([
      row({ id: 1, name: 'Still planning', status: 'PLANNING' }),
      row({ id: 6, name: 'Ready', status: 'CONFIRMED' }),
      row({ id: 2, name: 'Draft event', status: 'DRAFT' }),
      row({ id: 3, name: 'Finished', status: 'COMPLETED' }),
      row({ id: 4, name: 'Called off', status: 'CANCELLED' }),
      row({ id: 5, name: 'Turned down', status: 'REJECTED' }),
    ]);

    const assignments = await access.listAssignmentOverview(lead);

    expect(assignments.map((item) => item.eventName)).toEqual(['Still planning', 'Ready']);
  });

  /*
   * AC: SCRUM-57 AC4
   * Scenario: This Lead assigns a Coordinator, then later reassigns the same event.
   * Setup: The event starts Submitted with no Coordinator. User 2 and user 4 are
   *   active Coordinators. The overview is read after each write, from the stored row.
   * Expected: After assign, the overview shows Chloe. After reassign, the next read
   *   shows Daniel, and the stored lead id is still this Lead.
   * Type: normal
   */
  it('US57-B05: the next open shows the assignment this Lead just made or changed', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 2, full_name: 'Chloe Lim', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);

    await events.assignPrimaryCoordinator(lead, 3, 2);

    expect(event.assigned_by_lead_id).toBe(11);
    expect(event.coordinator_id).toBe(2);
    db.fetchMany.mockResolvedValueOnce([
      row({
        coordinator_id: event.coordinator_id,
        assigned_by_lead_id: event.assigned_by_lead_id,
        status: event.status,
        coordinator: { full_name: 'Chloe Lim' },
      }),
    ]);
    const afterAssign = await access.listAssignmentOverview(lead);
    expect(afterAssign).toEqual([
      {
        eventId: 3, eventName: 'Leadership Forum', status: 'UNDER_REVIEW',
        coordinatorId: 2, coordinatorName: 'Chloe Lim',
      },
    ]);

    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 4, full_name: 'Daniel Ong', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR }]);

    await events.reassignEventCoordinator(lead, 3, 4);

    expect(event.coordinator_id).toBe(4);
    expect(event.assigned_by_lead_id).toBe(11);
    expect(event.status).toBe('UNDER_REVIEW');
    db.fetchMany.mockResolvedValueOnce([
      row({
        coordinator_id: 4,
        assigned_by_lead_id: 11,
        status: 'UNDER_REVIEW',
        coordinator: { full_name: 'Daniel Ong' },
      }),
    ]);
    const afterReassign = await access.listAssignmentOverview(lead);
    expect(afterReassign[0].coordinatorId).toBe(4);
    expect(afterReassign[0].coordinatorName).toBe('Daniel Ong');
  });

  /*
   * AC: SCRUM-57 AC2
   * Scenario: Another Lead reassigns an event this Lead had assigned.
   * Setup: The event is already held by Chloe and recorded as assigned by user 11.
   *   User 4 is an active Coordinator. User 12 is the other Lead.
   * Expected: assigned_by_lead_id becomes 12. This Lead's overview no longer includes it.
   * Type: conflict
   */
  it('US57-B06: after another Lead reassigns the event, it leaves this overview', async () => {
    event.coordinator_id = 2;
    event.status = 'PLANNING';
    event.assigned_by_lead_id = 11;
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 4, full_name: 'Daniel Ong', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);

    await events.reassignEventCoordinator(otherLead, 3, 4);

    expect(event.assigned_by_lead_id).toBe(12);
    db.fetchMany.mockResolvedValueOnce([
      row({
        coordinator_id: 4,
        assigned_by_lead_id: 12,
        coordinator: { full_name: 'Daniel Ong' },
      }),
    ]);
    const assignments = await access.listAssignmentOverview(lead);
    expect(assignments).toEqual([]);
  });

  /*
   * AC: SCRUM-57 AC4
   * Scenario: Coordinators hand the event to each other after this Lead assigned it.
   * Setup: Leadership Forum is held by Chloe and recorded as assigned by user 11.
   *   A pending request asks Daniel (user 4) to take it. Daniel accepts.
   * Expected: The event update stores Daniel as Coordinator and leaves assigned_by_lead_id
   *   at 11. The next overview open still lists the event for this Lead, under Daniel.
   * Type: boundary
   */
  it('US57-B07: a Coordinator handoff leaves the event on the Lead who assigned it', async () => {
    const daniel = { id: 4, roles: [ROLES.EVENT_COORDINATOR] };
    event.coordinator_id = 2;
    event.status = 'PLANNING';
    event.assigned_by_lead_id = 11;
    db.fetchOne.mockResolvedValueOnce({
      id: 9,
      event_id: 3,
      from_coordinator_id: 2,
      to_coordinator_id: 4,
      status: 'PENDING',
    });
    db.updateById.mockImplementation(async (table, _id, patch) => {
      if (table === 'events') Object.assign(event, patch);
      return patch;
    });

    await events.acceptCoordinatorChange(daniel, 3);

    const eventPatch = db.updateById.mock.calls.find((call) => call[0] === 'events')[2];
    expect(eventPatch.coordinator_id).toBe(4);
    expect(eventPatch).not.toHaveProperty('assigned_by_lead_id');
    expect(event.assigned_by_lead_id).toBe(11);
    expect(event.coordinator_id).toBe(4);

    db.fetchMany.mockResolvedValueOnce([
      row({
        coordinator_id: 4,
        assigned_by_lead_id: 11,
        status: 'PLANNING',
        coordinator: { full_name: 'Daniel Ong' },
      }),
    ]);
    const assignments = await access.listAssignmentOverview(lead);
    expect(assignments).toEqual([
      {
        eventId: 3, eventName: 'Leadership Forum', status: 'PLANNING',
        coordinatorId: 4, coordinatorName: 'Daniel Ong',
      },
    ]);
  });
});

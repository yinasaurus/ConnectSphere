/**
 * SCRUM-30: a submitted request stays visible and flagged Unassigned until a Coordinator is assigned.
 *
 * AC1  Every newly submitted event is flagged Unassigned (Submitted, no Coordinator).
 * AC2  That event stays visible to the organiser who submitted it and to the Lead.
 * AC3  Assigning a Coordinator removes the flag. The event stays visible.
 *
 * The queue screen is SCRUM-65. Choosing the Coordinator is SCRUM-71.
 * Submit already stores coordinator_id null (SCRUM-28); these tests do not repeat that write.
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
const service = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');
const { EVENT_STATUS } = require('../src/constants/statuses');

const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
const otherOrgOrganiser = { id: 8, organisationId: 99, roles: [ROLES.EVENT_ORGANISER] };
const lead = { id: 11, roles: [ROLES.EVENT_COORDINATOR_LEAD] };

let event;

beforeEach(() => {
  jest.clearAllMocks();
  event = {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: null,
    status: EVENT_STATUS.SUBMITTED,
    name: 'Town Hall',
  };
  db.supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  });
  db.fetchOne.mockImplementation(async () => event);
  db.fetchMany.mockResolvedValue([event]);
  db.updateById.mockImplementation(async (_table, _id, patch) => {
    Object.assign(event, patch);
    return event;
  });
});

describe('SCRUM-30 unassigned flag stays visible', () => {
  /*
   * AC: SCRUM-30 AC1, AC2
   * Scenario: A request has just been submitted and still has no Coordinator.
   * Setup: Event 3 is SUBMITTED, coordinator_id null, organisation 10, owned by organiser 1.
   *         The default event list is what the dashboard and Events page call.
   * Expected: The submitting organiser and the Lead both receive it, still flagged
   *           (Submitted, no Coordinator). The Lead's unassigned queue includes the same event.
   * Type: normal
   */
  it('US30-B01: a submitted event with no Coordinator is visible to the organiser and the Lead', async () => {
    const forOrganiser = await service.listEvents(organiser);
    const forLead = await service.listEvents(lead);
    const queue = await service.listUnassignedQueue(lead);

    expect(forOrganiser).toHaveLength(1);
    expect(forOrganiser[0].name).toBe('Town Hall');
    expect(forOrganiser[0].status).toBe(EVENT_STATUS.SUBMITTED);
    expect(forOrganiser[0].coordinatorId).toBeNull();
    expect(service.isInUnassignedQueue(forOrganiser[0])).toBe(true);

    expect(forLead.map((row) => row.id)).toEqual([3]);
    expect(service.isInUnassignedQueue(forLead[0])).toBe(true);
    expect(queue.map((row) => row.id)).toEqual([3]);
  });

  /*
   * AC: SCRUM-30 AC2
   * Scenario: Someone from another organisation tries to see the unassigned request.
   * Setup: Same Submitted event in organisation 10. Caller is an organiser in organisation 99.
   * Expected: It is not in their list. Opening it is 404, the same as a missing event.
   * Type: boundary
   */
  it('US30-B02: an organiser from another organisation cannot see the unassigned event', async () => {
    const listed = await service.listEvents(otherOrgOrganiser);

    expect(listed).toHaveLength(0);
    await expect(service.getEvent(otherOrgOrganiser, 3)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  /*
   * AC: SCRUM-30 AC1
   * Scenario: The organiser saved a draft and has not submitted it.
   * Setup: Event 3 is DRAFT with coordinator_id null, in the organiser's organisation.
   * Expected: It stays on their list (they must not lose the draft) but it is not flagged
   *           Unassigned. Only a submitted request is.
   * Type: boundary
   */
  it('US30-B03: a draft with no Coordinator stays visible but is not flagged Unassigned', async () => {
    event.status = EVENT_STATUS.DRAFT;

    const listed = await service.listEvents(organiser);

    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(3);
    expect(service.isInUnassignedQueue(listed[0])).toBe(false);
  });

  /*
   * AC: SCRUM-30 AC3
   * Scenario: The Lead assigns an active Coordinator.
   * Setup: Event 3 is Submitted and unassigned. User 2 is an active Coordinator.
   * Expected: coordinatorId is 2, so the flag is gone. The organiser and the Lead can
   *           still open the event. It is no longer in the unassigned queue.
   * Type: normal
   */
  it('US30-B04: assigning a Coordinator removes the flag and leaves the event visible', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 2, full_name: 'Chloe Lim', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);

    const assigned = await service.assignPrimaryCoordinator(lead, 3, 2);

    expect(assigned.coordinatorId).toBe(2);
    expect(service.isInUnassignedQueue(assigned)).toBe(false);

    const seenByOrganiser = await service.getEvent(organiser, 3);
    expect(seenByOrganiser.id).toBe(3);
    expect(seenByOrganiser.coordinatorId).toBe(2);
    expect(service.isInUnassignedQueue(seenByOrganiser)).toBe(false);

    db.fetchMany.mockResolvedValue([event]);
    const stillForOrganiser = await service.listEvents(organiser);
    const stillForLead = await service.listEvents(lead);
    const queue = await service.listUnassignedQueue(lead);

    expect(stillForOrganiser.map((row) => row.id)).toEqual([3]);
    expect(stillForLead.map((row) => row.id)).toEqual([3]);
    expect(queue).toHaveLength(0);
  });

  /*
   * AC: SCRUM-30 AC1, AC2
   * Scenario: The Lead tries to assign someone who is not an active Coordinator.
   * Setup: Event 3 is Submitted and unassigned. User 9 exists but is inactive.
   * Expected: Assignment is refused. The event is still flagged and still visible
   *           to the submitting organiser and the Lead.
   * Type: error
   */
  it('US30-B05: a refused assignment leaves the event visible and still Unassigned', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 9, full_name: 'Inactive', is_active: false });

    await expect(service.assignPrimaryCoordinator(lead, 3, 9)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_COORDINATOR',
    });

    db.fetchMany.mockResolvedValue([event]);
    const forOrganiser = await service.listEvents(organiser);
    const forLead = await service.listEvents(lead);

    expect(forOrganiser).toHaveLength(1);
    expect(service.isInUnassignedQueue(forOrganiser[0])).toBe(true);
    expect(forLead).toHaveLength(1);
    expect(service.isInUnassignedQueue(forLead[0])).toBe(true);
    expect(event.coordinator_id).toBeNull();
    expect(event.status).toBe(EVENT_STATUS.SUBMITTED);
  });
});

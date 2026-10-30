/**
 * SCRUM-84: a Coordinator sees only events assigned to them.
 * SCRUM-54 AC6 (view, but not change, events assigned to someone else) is superseded.
 */
jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
  updateById: jest.fn(), insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));

const db = require('../src/config/db');
const service = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');

describe('SCRUM-84 coordinator view', () => {
  const coordinator = { id: 4, roles: [ROLES.EVENT_COORDINATOR] };
  const lead = { id: 9, roles: [ROLES.EVENT_COORDINATOR, ROLES.EVENT_COORDINATOR_LEAD] };
  const venueStaff = { id: 6, roles: [ROLES.VENUE_STAFF] };
  const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };

  let mine;
  let theirs;
  let queued;
  let query;

  beforeEach(() => {
    jest.clearAllMocks();
    mine = {
      id: 3,
      organiser_id: 1,
      organisation_id: 10,
      coordinator_id: 4,
      status: 'PLANNING',
      name: 'Mine',
      purpose: 'Planning',
      description: 'Assigned to this coordinator',
      start_at: '2026-11-01T00:00:00Z',
      end_at: '2026-11-01T02:00:00Z',
    };
    theirs = { ...mine, id: 8, coordinator_id: 2, name: 'Theirs' };
    queued = { ...mine, id: 11, coordinator_id: null, status: 'SUBMITTED', name: 'Queue' };
    query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    };
    db.supabase.from.mockReturnValue(query);
    db.fetchOne.mockImplementation(async () => mine);
    db.fetchMany.mockResolvedValue([mine, theirs, queued]);
  });

  /*
   * AC: SCRUM-84 AC1
   * Scenario: The assigned Coordinator opens their event.
   * Setup: Event 3 has coordinator_id 4. The caller is coordinator 4.
   * Expected: The event name is returned.
   * Type: normal
   */
  it('AC1: lets the assigned Coordinator open the event', async () => {
    const visible = await service.getEvent(coordinator, 3);
    expect(visible.name).toBe('Mine');
    expect(visible.id).toBe(3);
  });

  /*
   * AC: SCRUM-84 AC2
   * Scenario: A Coordinator asks for an event id that does not exist.
   * Setup: The database returns no row.
   * Expected: 404 Event not found. This is not the access-denied message.
   * Type: error
   */
  it('AC2: a missing event is still not found', async () => {
    db.fetchOne.mockResolvedValueOnce(null);
    await expect(service.getEvent(coordinator, 99)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Event not found',
    });
  });

  /*
   * AC: SCRUM-39 AC1
   * Scenario: An Organiser from another organisation opens an event.
   * Setup: Caller organisation is 20. The event belongs to organisation 10. The caller is not a Coordinator.
   * Expected: 404, so an outsider is not told the event exists. This stays 404 after SCRUM-84;
   *           the access-denied message is only for a Coordinator.
   * Type: boundary
   */
  it('AC2: an organiser outside the organisation still gets not found', async () => {
    await expect(service.getEvent({ ...organiser, organisationId: 20 }, 3)).rejects.toMatchObject({
      status: 404,
      message: 'Event not found',
    });
  });

  /*
   * AC: SCRUM-84 AC1
   * Scenario: A Lead who is also a Coordinator opens an unassigned queue event.
   * Setup: coordinator_id is null. The caller holds both Lead and Coordinator.
   * Expected: The event is returned. Week 9 keeps the full list for the Lead.
   * Type: boundary
   */
  it('AC1: a Coordinator who is also a Lead can open an unassigned event', async () => {
    db.fetchOne.mockResolvedValueOnce(queued);
    const visible = await service.getEvent(lead, 11);
    expect(visible.name).toBe('Queue');
  });

  /*
   * AC: SCRUM-84 AC1
   * Scenario: Venue Staff open an event assigned to a Coordinator.
   * Setup: Caller is Venue Staff only. The event is assigned to coordinator 4.
   * Expected: They can still open it. AC1 limits a Coordinator; Venue Staff are not limited.
   * Type: boundary
   */
  it('AC1: Venue Staff can still open an event', async () => {
    const visible = await service.getEvent(venueStaff, 3);
    expect(visible.name).toBe('Mine');
  });

  /*
   * AC: SCRUM-84 AC3
   * Scenario: A Coordinator loads the event list.
   * Setup: The database would return their event, another Coordinator's event, and a queued one.
   * Expected: Only their event is returned, and the query is limited to their coordinator id.
   * Type: normal
   */
  it('AC3: the Coordinator list is only events assigned to them', async () => {
    const listed = await service.listEvents(coordinator);
    expect(listed.map((event) => event.name)).toEqual(['Mine']);
    expect(query.eq).toHaveBeenCalledWith('coordinator_id', 4);
  });

  /*
   * AC: SCRUM-84 AC3
   * Scenario: A Lead who is also a Coordinator loads the event list.
   * Setup: The same three rows are returned by the database.
   * Expected: All three stay. The query is not limited to one coordinator id.
   * Type: boundary
   */
  it('AC3: a Lead still receives every event in the list', async () => {
    const listed = await service.listEvents(lead);
    expect(listed.map((event) => event.name)).toEqual(['Mine', 'Theirs', 'Queue']);
    expect(query.eq).not.toHaveBeenCalledWith('coordinator_id', expect.anything());
  });

  /*
   * AC: SCRUM-84 AC3
   * Scenario: A Coordinator who is also an Organiser loads the event list.
   * Setup: Caller id 4 holds both roles and belongs to organisation 10. The rows are
   *        their event, another Coordinator's event in that organisation, and a queued one.
   * Expected: All three are returned. The query keeps assignments and that organisation.
   *           This records the current rule; it does not decide whether AC2 should deny
   *           the Organiser path.
   * Type: boundary
   */
  it('AC3: a Coordinator who is also an Organiser sees assignments and their organisation', async () => {
    const both = {
      id: 4,
      organisationId: 10,
      roles: [ROLES.EVENT_COORDINATOR, ROLES.EVENT_ORGANISER],
    };

    const listed = await service.listEvents(both);

    expect(listed.map((event) => event.name)).toEqual(['Mine', 'Theirs', 'Queue']);
    expect(query.or).toHaveBeenCalledWith('coordinator_id.eq.4,organisation_id.eq.10');
  });

  /*
   * AC: SCRUM-39 AC1
   * Scenario: An Organiser loads their organisation's events.
   * Setup: Caller is an Organiser of organisation 10, not a Coordinator.
   * Expected: The query is limited to that organisation, not to a coordinator id.
   * Type: boundary
   */
  /*
   * AC: SCRUM-84 AC2
   * Scenario: A Coordinator saves a new draft, then opens it again.
   * Setup: The caller is a Coordinator and not an Organiser. The saved row has no coordinator.
   * Expected: The save response includes the draft. A later open is access denied,
   *           because a draft is not an event assigned to them.
   * Type: boundary
   */
  it('AC2: a Coordinator receives the draft they saved, then cannot open it', async () => {
    const draftRow = {
      id: 12,
      name: 'Draft night',
      status: 'DRAFT',
      organiser_id: 4,
      coordinator_id: null,
      organisation_id: 10,
    };
    db.insertOne.mockResolvedValue(draftRow);

    const created = await service.createEvent(coordinator, { name: 'Draft night' });

    expect(created.name).toBe('Draft night');
    expect(created.status).toBe('DRAFT');
    expect(created.coordinatorId).toBeNull();

    db.fetchOne.mockResolvedValueOnce(draftRow);
    await expect(service.getEvent(coordinator, 12)).rejects.toMatchObject({
      status: 403,
      message: 'Access denied. You can only view events assigned to you.',
    });
  });

  /*
   * AC: SCRUM-84 AC2
   * Scenario: The assigned Coordinator submits the event, then opens it again.
   * Setup: The event is a complete Draft assigned to coordinator 4. Submit clears the coordinator.
   * Expected: The submit response is Submitted with no coordinator. A later open is access
   *           denied, because the event is now in the unassigned queue.
   * Type: boundary
   */
  it('AC2: a Coordinator receives the event they submitted, then cannot open it', async () => {
    const draft = {
      ...mine,
      status: 'DRAFT',
      expected_attendance: 40,
      venue_requirements: 'Lecture theatre',
      accessibility_needs: 'Step-free access',
    };
    db.fetchOne.mockImplementation(async () => draft);
    db.insertOne.mockResolvedValue({ id: 1 });
    db.updateById.mockResolvedValue({ id: 3 });

    const submitted = await service.submitEvent(coordinator, 3);

    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.coordinatorId).toBeNull();

    db.fetchOne.mockResolvedValueOnce({ ...draft, status: 'SUBMITTED', coordinator_id: null });
    await expect(service.getEvent(coordinator, 3)).rejects.toMatchObject({
      status: 403,
      message: 'Access denied. You can only view events assigned to you.',
    });
  });

  it('an organiser list stays inside their organisation', async () => {
    db.fetchMany.mockResolvedValue([mine]);
    const listed = await service.listEvents(organiser);
    expect(listed.map((event) => event.name)).toEqual(['Mine']);
    expect(query.eq).toHaveBeenCalledWith('organisation_id', 10);
    expect(query.eq).not.toHaveBeenCalledWith('coordinator_id', expect.anything());
  });
});

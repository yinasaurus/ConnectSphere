jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
  updateById: jest.fn(), insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));
const db = require('../src/config/db');
const service = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');
const { EVENT_STATUS } = require('../src/constants/statuses');

// SCRUM-38: once an event request leaves Draft, the organiser can no longer
// edit it directly — changes must go through the assigned coordinator.
describe('SCRUM-38 restrict direct organiser edits after submission', () => {
  const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
  const otherOrganiser = { id: 6, organisationId: 20, roles: [ROLES.EVENT_ORGANISER] };
  const assignedCoordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
  const venueStaff = { id: 5, roles: [ROLES.VENUE_STAFF] };
  const hybridOwner = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR] };
  let event;

  beforeEach(() => {
    jest.clearAllMocks();
    event = {
      id: 3, organiser_id: 1, organisation_id: 10, coordinator_id: 2, status: EVENT_STATUS.DRAFT,
      name: 'Workshop', purpose: 'Learn', description: 'A workshop',
    };
    db.supabase.from.mockReturnValue({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis() });
    db.fetchOne.mockImplementation(async () => event);
    db.fetchMany.mockResolvedValue([]);
    db.updateById.mockResolvedValue(event);
  });

  it('allows the organiser to edit their own request while it is still Draft', async () => {
    await service.updateEvent(organiser, 3, { name: 'Updated title' });
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ name: 'Updated title' }));
  });

  it.each(
    Object.values(EVENT_STATUS).filter((status) => status !== EVENT_STATUS.DRAFT)
  )('blocks the owning organiser from directly editing after submission (status %s)', async (status) => {
    event.status = status;
    await expect(service.updateEvent(organiser, 3, { name: 'Sneaky edit' }))
      .rejects.toMatchObject({ status: 409, code: 'EDIT_LOCKED' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('blocks even a single-field direct edit once submitted', async () => {
    event.status = EVENT_STATUS.SUBMITTED;
    await expect(service.updateEvent(organiser, 3, { description: 'Just one field' }))
      .rejects.toMatchObject({ status: 409, code: 'EDIT_LOCKED' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('lets the assigned coordinator edit the event after submission', async () => {
    event.status = EVENT_STATUS.UNDER_REVIEW;
    await service.updateEvent(assignedCoordinator, 3, { name: 'Coordinator-reviewed title' });
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ name: 'Coordinator-reviewed title' }));
  });

  it('lets a hybrid organiser/coordinator user who is the assigned coordinator for their own request edit it after submission', async () => {
    event.status = EVENT_STATUS.UNDER_REVIEW;
    event.coordinator_id = 1; // hybridOwner is both the organiser and the assigned coordinator
    await service.updateEvent(hybridOwner, 3, { name: 'Self-reviewed title' });
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ name: 'Self-reviewed title' }));
  });

  it('rejects an unrelated role (Venue Staff) from editing a submitted request', async () => {
    event.status = EVENT_STATUS.SUBMITTED;
    await expect(service.updateEvent(venueStaff, 3, { name: 'Not my event' }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('rejects an organiser from a different organisation, distinct from the EDIT_LOCKED case', async () => {
    event.status = EVENT_STATUS.SUBMITTED;
    await expect(service.updateEvent(otherOrganiser, 3, { name: 'Not my event' }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

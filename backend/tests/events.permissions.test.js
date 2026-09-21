jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
  updateById: jest.fn(), insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));
const db = require('../src/config/db');
const service = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');

describe('SCUM-13 event ownership and assigned coordinator permissions', () => {
  const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
  const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
  let event;
  beforeEach(() => {
    jest.clearAllMocks();
    event = {
      id: 3, organiser_id: 1, organisation_id: 10, coordinator_id: 2, status: 'DRAFT',
      name: 'Workshop', purpose: 'Learn', description: 'A workshop',
      start_at: '2026-10-01T10:00:00Z', end_at: '2026-10-01T11:00:00Z',
      expected_attendance: 10, venue_requirements: 'Room', accessibility_needs: 'None',
    };
    db.supabase.from.mockReturnValue({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis() });
    db.fetchOne.mockImplementation(async () => event);
    db.fetchMany.mockResolvedValue([]);
    db.updateById.mockResolvedValue(event);
  });

  it('allows the owner to update their draft', async () => {
    await service.updateEvent(organiser, 3, { name: 'Updated' });
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ name: 'Updated' }));
  });

  it.each([
    { id: 4, organisationId: 20, roles: [ROLES.EVENT_ORGANISER] },
    { id: 4, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] },
    { id: 4, roles: [ROLES.EVENT_COORDINATOR] },
  ])('rejects edits by a non-owner or unassigned coordinator', async (user) => {
    await expect(service.updateEvent(user, 3, { name: 'Denied' })).rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('allows the assigned coordinator to edit', async () => {
    await service.updateEvent(coordinator, 3, { purpose: 'Updated' });
    expect(db.updateById).toHaveBeenCalled();
  });

  it.each([organiser, coordinator])('allows owner/assigned coordinator submission', async (user) => {
    await service.submitEvent(user, 3);
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ status: 'UNDER_REVIEW' }));
  });

  it('rejects submission by an unassigned coordinator', async () => {
    await expect(service.submitEvent({ ...coordinator, id: 4 }, 3)).rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('allows an assigned coordinator to review', async () => {
    event.status = 'UNDER_REVIEW';
    await service.changeStatus(coordinator, 3, 'PLANNING');
    expect(db.updateById).toHaveBeenCalled();
  });

  it.each([organiser, { ...coordinator, id: 4 }])('rejects review by the wrong user', async (user) => {
    event.status = 'UNDER_REVIEW';
    await expect(service.changeStatus(user, 3, 'PLANNING')).rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

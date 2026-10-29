jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
  updateById: jest.fn(), insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));
const db = require('../src/config/db');
const service = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');

function historyRows() {
  return db.insertOne.mock.calls
    .filter(([table]) => table === 'event_status_history')
    .map(([, row]) => [row.from_status, row.to_status]);
}

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
    db.supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    });
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
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      status: 'SUBMITTED',
      coordinator_id: null,
    }));
  });

  it('rejects submission by an unassigned coordinator', async () => {
    await expect(service.submitEvent({ ...coordinator, id: 4 }, 3)).rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  describe('SCRUM-64 opening a submitted event request for review', () => {
    beforeEach(() => {
      event.status = 'SUBMITTED';
    });

    /*
    * AC:       SCRUM-64 (AC1: assigned Coordinator opens a Submitted request, moving it to Under Review)
    * Scenario: Assigned Coordinator opens a Submitted request, moving it to Under Review.
    * Setup:    Event is SUBMITTED, assigned to the caller; openForReview() is called.
    * Expected: event_status_history records SUBMITTED -> UNDER_REVIEW. (The write itself — updateById with
    *           status UNDER_REVIEW — is proven by SCRUM-5's US5-S01b; this test's own job is the history
    *           trail, so the two doesn't duplicate each other.)
    * Type:     normal
    */
    // SCRUM-64-TC01
    it('lets the assigned coordinator open a submitted request, moving it to Under Review', async () => {
      await service.openForReview(coordinator, 3);
      expect(historyRows()).toEqual([['SUBMITTED', 'UNDER_REVIEW']]);
    });

    /*
    * AC:       SCRUM-64 (AC2: opening a request still in the unassigned queue is rejected)
    * Scenario: Opening a request still in the unassigned queue (no Coordinator) is rejected.
    * Setup:    Event is SUBMITTED with coordinator_id=null; caller is a Coordinator.
    * Expected: Rejected with 409 NOT_ASSIGNED; updateById is not called.
    * Type:     error
    */
    // SCRUM-64-TC02
    it('rejects opening a request still in the unassigned queue (no coordinator assigned)', async () => {
      event.coordinator_id = null;
      await expect(service.openForReview(coordinator, 3)).rejects.toMatchObject({ status: 409, code: 'NOT_ASSIGNED' });
      expect(db.updateById).not.toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-64 (AC3: opening a request assigned to a different Coordinator is rejected)
    * Scenario: Opening a request assigned to a different Coordinator is rejected.
    * Setup:    Event is SUBMITTED, assigned to coordinator id 2; caller is a different Coordinator (id 4).
    * Expected: Rejected with 403; updateById is not called.
    * Type:     error
    */
    // SCRUM-64-TC03
    it('rejects opening a request assigned to a different coordinator', async () => {
      await expect(service.openForReview({ ...coordinator, id: 4 }, 3)).rejects.toMatchObject({ status: 403 });
      expect(db.updateById).not.toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-64 (AC4: a Draft request never appears in any Coordinator's reviewable list)
    * Scenario: A Draft request cannot be opened for review.
    * Setup:    Event status is DRAFT; caller is the assigned Coordinator.
    * Expected: Rejected with 409 INVALID_STATUS_TRANSITION; updateById is not called.
    * Type:     error
    */
    // SCRUM-64-TC04
    it('a Draft request cannot be opened for review (never reachable from the reviewable queue)', async () => {
      event.status = 'DRAFT';
      await expect(service.openForReview(coordinator, 3)).rejects.toMatchObject({ status: 409, code: 'INVALID_STATUS_TRANSITION' });
      expect(db.updateById).not.toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-64 (AC4: a Draft request never appears in any Coordinator's reviewable list)
    * Scenario: A Draft request is excluded when listing events filtered by Submitted status.
    * Setup:    One event exists with status DRAFT; listEvents() is called with filters.status='SUBMITTED'.
    * Expected: Returned list has length 0 — the Draft row is excluded.
    * Type:     boundary
    */
    // SCRUM-64-TC05
    it('a Draft request is excluded when listing by Submitted status', async () => {
      event.status = 'DRAFT';
      db.fetchMany.mockResolvedValue([event].filter((row) => row.status === 'SUBMITTED'));
      const results = await service.listEvents(coordinator, { status: 'SUBMITTED' });
      expect(results).toHaveLength(0);
    });

    /*
    * AC:       SCRUM-64 (AC5: opening an already Under Review request is idempotent)
    * Scenario: Opening an already Under-Review request is idempotent.
    * Setup:    Event is already UNDER_REVIEW; openForReview() is called again by the assigned Coordinator.
    * Expected: Resolves without error; updateById is NOT called again (no re-trigger of the transition).
    * Type:     boundary
    */
    // SCRUM-64-TC06
    it('opening an already Under Review request is idempotent (no error, no re-trigger)', async () => {
      event.status = 'UNDER_REVIEW';
      await expect(service.openForReview(coordinator, 3)).resolves.toBeDefined();
      expect(db.updateById).not.toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-64 (AC6: only users with the Event Coordinator role can perform this action)
    * Scenario: An Organiser attempting to open a request for review is rejected.
    * Setup:    Event is SUBMITTED; caller is the owning Organiser, not a Coordinator.
    * Expected: Rejected with 403; updateById is not called.
    * Type:     error
    */
    // SCRUM-64-TC07
    it('rejects an organiser attempting to open a request for review', async () => {
      await expect(service.openForReview(organiser, 3)).rejects.toMatchObject({ status: 403 });
      expect(db.updateById).not.toHaveBeenCalled();
    });

    /*
    * AC:       SCRUM-64 (general 404 guard)
    * Scenario: Opening a request for an event that does not exist returns 404.
    * Setup:    fetchOne resolves null for event id 999.
    * Expected: Rejected with 404; updateById is not called.
    * Type:     error
    */
    // SCRUM-64-TC08
    it('rejects opening a request that does not exist', async () => {
      db.fetchOne.mockResolvedValueOnce(null);
      await expect(service.openForReview(coordinator, 999)).rejects.toMatchObject({ status: 404 });
      expect(db.updateById).not.toHaveBeenCalled();
    });
  });

  it('allows an assigned coordinator to review', async () => {
    event.status = 'UNDER_REVIEW';
    await service.changeStatus(coordinator, 3, 'APPROVED');
    expect(db.updateById).toHaveBeenCalled();
  });

  it.each([organiser, { ...coordinator, id: 4 }])('rejects review by the wrong user', async (user) => {
    event.status = 'UNDER_REVIEW';
    await expect(service.changeStatus(user, 3, 'PLANNING')).rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

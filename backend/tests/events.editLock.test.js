jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
  updateById: jest.fn(), insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));
const db = require('../src/config/db');
const service = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');
const { EVENT_STATUS, EVENT_SUB_STATE } = require('../src/constants/statuses');

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

  /*
   * AC:       SCRUM-38 (organiser may edit Draft)
   * Scenario: Owning Organiser patches their Draft request.
   * Setup:    status DRAFT; organiser_id matches caller.
   * Expected: Row is updated with the new name.
   * Type:     normal
   */
  it('allows the organiser to edit their own request while it is still Draft', async () => {
    await service.updateEvent(organiser, 3, { name: 'Updated title' });
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ name: 'Updated title' }));
  });

  /*
   * AC:       SCRUM-38 (no direct organiser edit after submit)
   * Scenario: Owning Organiser tries to PATCH after leaving Draft (any later status).
   * Setup:    status matrix excludes DRAFT; sub_state not ACTION_REQUIRED.
   * Expected: 409 EDIT_LOCKED; updateById never called.
   * Type:     error
   */
  it.each(
    Object.values(EVENT_STATUS).filter((status) => status !== EVENT_STATUS.DRAFT)
  )('blocks the owning organiser from directly editing after submission (status %s)', async (status) => {
    event.status = status;
    await expect(service.updateEvent(organiser, 3, { name: 'Sneaky edit' }))
      .rejects.toMatchObject({ status: 409, code: 'EDIT_LOCKED' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-38
   * Scenario: Organiser changes only one non-critical field after submit.
   * Setup:    SUBMITTED; payload is description only.
   * Expected: Still 409 EDIT_LOCKED — lock is not field-scoped for organisers.
   * Type:     boundary
   */
  it('blocks even a single-field direct edit once submitted', async () => {
    event.status = EVENT_STATUS.SUBMITTED;
    await expect(service.updateEvent(organiser, 3, { description: 'Just one field' }))
      .rejects.toMatchObject({ status: 409, code: 'EDIT_LOCKED' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-38 (assigned Coordinator may edit after submit)
   * Scenario: Assigned Coordinator patches title while Under Review.
   * Setup:    coordinator_id matches caller; status UNDER_REVIEW.
   * Expected: updateById receives the new name.
   * Type:     normal
   */
  it('lets the assigned coordinator edit the event after submission', async () => {
    event.status = EVENT_STATUS.UNDER_REVIEW;
    await service.updateEvent(assignedCoordinator, 3, { name: 'Coordinator-reviewed title' });
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ name: 'Coordinator-reviewed title' }));
  });

  /*
   * AC:       SCRUM-38
   * Scenario: Hybrid organiser/coordinator who is the assigned coordinator edits own request.
   * Setup:    Same user id is organiser_id and coordinator_id; UNDER_REVIEW.
   * Expected: Edit succeeds because the assigned-coordinator path applies.
   * Type:     boundary
   */
  it('lets a hybrid organiser/coordinator user who is the assigned coordinator for their own request edit it after submission', async () => {
    event.status = EVENT_STATUS.UNDER_REVIEW;
    event.coordinator_id = 1; // hybridOwner is both the organiser and the assigned coordinator
    await service.updateEvent(hybridOwner, 3, { name: 'Self-reviewed title' });
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ name: 'Self-reviewed title' }));
  });

  /*
   * AC:       SCRUM-38 / SCRUM-54
   * Scenario: Venue Staff tries to PATCH a submitted request.
   * Setup:    SUBMITTED; caller has VENUE_STAFF only.
   * Expected: 403 FORBIDDEN; nothing written.
   * Type:     error
   */
  it('rejects an unrelated role (Venue Staff) from editing a submitted request', async () => {
    event.status = EVENT_STATUS.SUBMITTED;
    await expect(service.updateEvent(venueStaff, 3, { name: 'Not my event' }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-38
   * Scenario: Organiser from another organisation tries to edit.
   * Setup:    SUBMITTED; caller organisation differs; not the owner.
   * Expected: 403 FORBIDDEN (not EDIT_LOCKED) — wrong identity, not post-submit lock.
   * Type:     error
   */
  it('rejects an organiser from a different organisation, distinct from the EDIT_LOCKED case', async () => {
    event.status = EVENT_STATUS.SUBMITTED;
    await expect(service.updateEvent(otherOrganiser, 3, { name: 'Not my event' }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

/**
 * SCRUM-40: Edit Event Details (product 1C / 2A / 3A / 4A).
 * Assigned Coordinator may direct-edit before Confirmed; Confirmed locks every field;
 * Organiser amends only Draft or clarification ACTION_REQUIRED; ordinary fields via
 * updateEvent, critical Confirmed changes via change requests (SCRUM-69).
 */
describe('SCRUM-40 edit event details before Confirmed', () => {
  const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
  const assignedCoordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
  const otherCoordinator = { id: 7, roles: [ROLES.EVENT_COORDINATOR] };
  let event;

  const beforeConfirmed = [
    EVENT_STATUS.SUBMITTED,
    EVENT_STATUS.UNDER_REVIEW,
    EVENT_STATUS.APPROVED,
    EVENT_STATUS.PLANNING,
    EVENT_STATUS.AWAITING_SAFETY_CHECK,
    EVENT_STATUS.PREPARATION,
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    event = {
      id: 3,
      organiser_id: 1,
      organisation_id: 10,
      coordinator_id: 2,
      status: EVENT_STATUS.PLANNING,
      name: 'Workshop',
      purpose: 'Learn',
      description: 'A workshop',
      start_at: '2026-11-20T10:00:00Z',
      end_at: '2026-11-20T12:00:00Z',
      expected_attendance: 40,
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

  /*
   * AC:       SCRUM-40 AC1 / product 1C
   * Scenario: Assigned Coordinator edits ordinary fields in each status before Confirmed.
   * Setup:    coordinator_id = 2; status from the beforeConfirmed matrix.
   * Expected: updateById writes name and purpose; no EDIT_LOCKED.
   * Type:     normal
   */
  it.each(beforeConfirmed)(
    'AC1/1C: assigned Coordinator can edit ordinary fields while status is %s',
    async (status) => {
      event.status = status;
      await service.updateEvent(assignedCoordinator, 3, { name: 'Planning title', purpose: 'Updated purpose' });
      expect(db.updateById).toHaveBeenCalledWith(
        'events',
        3,
        expect.objectContaining({ name: 'Planning title', purpose: 'Updated purpose' })
      );
    }
  );

  /*
   * AC:       SCRUM-40 AC2
   * Scenario: A different Coordinator tries to edit a Planning event.
   * Setup:    Event assigned to id 2; caller is id 7.
   * Expected: 403 FORBIDDEN; row unchanged.
   * Type:     error
   */
  it('AC2: unassigned Coordinator cannot direct-edit a Planning event', async () => {
    await expect(service.updateEvent(otherCoordinator, 3, { name: 'Hijack' }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-40 AC2 / product 3A
   * Scenario: Owning Organiser tries a direct edit while Planning.
   * Setup:    PLANNING; organiser is not the assigned coordinator.
   * Expected: 409 EDIT_LOCKED — use Coord edit or change request instead.
   * Type:     error
   */
  it('AC2/3A: owning Organiser cannot direct-edit while Planning', async () => {
    await expect(service.updateEvent(organiser, 3, { description: 'Organiser tweak' }))
      .rejects.toMatchObject({ status: 409, code: 'EDIT_LOCKED' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-40 product 3A
   * Scenario: Organiser amends fields after clarification was requested.
   * Setup:    UNDER_REVIEW + ACTION_REQUIRED; owning organiser.
   * Expected: description patch is written.
   * Type:     normal
   */
  it('AC/3A: Organiser can amend while Under Review + ACTION_REQUIRED', async () => {
    event.status = EVENT_STATUS.UNDER_REVIEW;
    event.sub_state = EVENT_SUB_STATE.ACTION_REQUIRED;
    await service.updateEvent(organiser, 3, { description: 'Clarified description' });
    expect(db.updateById).toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({ description: 'Clarified description' })
    );
  });

  /*
   * AC:       SCRUM-40 AC3 / product 2A
   * Scenario: Assigned Coordinator tries any direct field edit on Confirmed.
   * Setup:    CONFIRMED; payloads cover ordinary and former "significant" fields.
   * Expected: 409 EDIT_LOCKED for every case; nothing written (use change request).
   * Type:     error
   */
  it.each([
    ['ordinary name', { name: 'Still locked' }],
    ['ordinary description', { description: 'Still locked' }],
    ['critical startAt', { startAt: '2026-12-01T10:00:00Z', endAt: '2026-12-01T12:00:00Z' }],
    ['critical expectedAttendance', { expectedAttendance: 99 }],
  ])('AC3/2A: Confirmed rejects direct edit of %s', async (_label, payload) => {
    event.status = EVENT_STATUS.CONFIRMED;
    await expect(service.updateEvent(assignedCoordinator, 3, payload))
      .rejects.toMatchObject({ status: 409, code: 'EDIT_LOCKED' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-40 product 2A (terminal statuses)
   * Scenario: Assigned Coordinator patches after the event is closed out.
   * Setup:    COMPLETED / CANCELLED / REJECTED.
   * Expected: 409 EDIT_LOCKED; nothing written.
   * Type:     error
   */
  it.each([
    EVENT_STATUS.COMPLETED,
    EVENT_STATUS.CANCELLED,
    EVENT_STATUS.REJECTED,
  ])('AC/2A: assigned Coordinator cannot direct-edit terminal status %s', async (status) => {
    event.status = status;
    await expect(service.updateEvent(assignedCoordinator, 3, { name: 'Too late' }))
      .rejects.toMatchObject({ status: 409, code: 'EDIT_LOCKED' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-40 AC4
   * Scenario: Assigned Coordinator submits an end time before the start time.
   * Setup:    PLANNING; startAt after endAt.
   * Expected: 400 VALIDATION_ERROR; updateById not called.
   * Type:     error
   */
  it('AC4: rejects an invalid date range and writes nothing', async () => {
    await expect(service.updateEvent(assignedCoordinator, 3, {
      startAt: '2026-11-20T14:00:00Z',
      endAt: '2026-11-20T12:00:00Z',
    })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-40 AC4 / product 4A
   * Scenario: Assigned Coordinator saves an ordinary (non-critical) field before Confirmed.
   * Setup:    PLANNING; specialRequests only.
   * Expected: special_requests is written via updateById.
   * Type:     normal
   */
  it('AC4/4A: valid ordinary-field edit before Confirmed is saved', async () => {
    await service.updateEvent(assignedCoordinator, 3, {
      specialRequests: 'Extra chairs near the stage',
    });
    expect(db.updateById).toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({ special_requests: 'Extra chairs near the stage' })
    );
  });
});

describe('SCRUM-40 edit lock HTTP route', () => {
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  const { createApp } = require('../src/app');
  const { env } = require('../src/config/env');
  const app = createApp();
  const token = jwt.sign({ sub: 2 }, env.jwtSecret);
  let event;

  beforeEach(() => {
    jest.clearAllMocks();
    event = {
      id: 3,
      organiser_id: 1,
      organisation_id: 10,
      coordinator_id: 2,
      status: EVENT_STATUS.CONFIRMED,
      name: 'Workshop',
      purpose: 'Learn',
      description: 'A workshop',
      start_at: '2026-11-20T10:00:00Z',
      end_at: '2026-11-20T12:00:00Z',
      expected_attendance: 40,
      registration_open: false,
    };
    db.supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    });
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);
    db.updateById.mockResolvedValue(event);
  });

  /*
   * AC:       SCRUM-40 AC3 / product 2A
   * Scenario: Assigned Coordinator PATCHes a Confirmed event over HTTP.
   * Setup:    Session user 2 is the assigned coordinator; status CONFIRMED; ordinary name field.
   * Expected: 409 EDIT_LOCKED; updateById not called.
   * Type:     error
   */
  it('US40-R01 (AC3/2A): PATCH Confirmed returns EDIT_LOCKED for the assigned Coordinator', async () => {
    db.fetchOne
      .mockResolvedValueOnce({ id: 2, is_active: true })
      .mockResolvedValueOnce(event);
    const res = await request(app)
      .patch('/api/events/3')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ name: 'Still locked over HTTP' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'EDIT_LOCKED' });
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

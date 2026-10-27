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
  // SCRUM-38-TC01
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
  // SCRUM-38-TC02 (parametrized - one test per non-Draft status, currently 10 statuses)
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
  // SCRUM-38-TC03
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
  // SCRUM-38-TC04
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
  // SCRUM-38-TC05
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
  // SCRUM-38-TC06
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
  // SCRUM-38-TC07
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
   * Scenario: Assigned Coordinator edits ordinary fields while the event is Planning.
   *           (Submitted, Under Review, Approved, Awaiting Safety Check and Preparation are not
   *           on the locked list, so they use the same check and are not repeated here.)
   * Setup:    coordinator_id = 2; status PLANNING.
   * Expected: updateById writes name and purpose; no EDIT_LOCKED.
   * Type:     normal
   */
  // SCRUM-40-TC01
  it('AC1/1C: assigned Coordinator can edit ordinary fields while status is PLANNING', async () => {
    await service.updateEvent(assignedCoordinator, 3, { name: 'Planning title', purpose: 'Updated purpose' });
    expect(db.updateById).toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({ name: 'Planning title', purpose: 'Updated purpose' })
    );
  });

  /*
   * AC:       SCRUM-40 AC2
   * Scenario: A different Coordinator tries to edit a Planning event.
   * Setup:    Event assigned to id 2; caller is id 7.
   * Expected: 403 FORBIDDEN; row unchanged.
   * Type:     error
   */
  // SCRUM-40-TC02
  it('AC2: unassigned Coordinator cannot direct-edit a Planning event', async () => {
    await expect(service.updateEvent(otherCoordinator, 3, { name: 'Hijack' }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
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
   * Scenario: Assigned Coordinator tries a direct field edit on Confirmed.
   *           (The lock does not look at which field is sent, so one ordinary field and the
   *           date and time fields are enough; the other fields are not repeated.)
   * Setup:    CONFIRMED; an ordinary field, then the former "significant" start and end.
   * Expected: 409 EDIT_LOCKED for every case; nothing written (use change request).
   * Type:     error
   */
  it.each([
    // SCRUM-40-TC03
    ['ordinary name', { name: 'Still locked' }],
    // SCRUM-40-TC04
    ['critical startAt', { startAt: '2026-12-01T10:00:00Z', endAt: '2026-12-01T12:00:00Z' }],
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
    // SCRUM-40-TC13
    EVENT_STATUS.COMPLETED,
    // SCRUM-40-TC14
    EVENT_STATUS.CANCELLED,
    // SCRUM-40-TC15
    EVENT_STATUS.REJECTED,
  ])('AC/2A: assigned Coordinator cannot direct-edit terminal status %s', async (status) => {
    event.status = status;
    await expect(service.updateEvent(assignedCoordinator, 3, { name: 'Too late' }))
      .rejects.toMatchObject({ status: 409, code: 'EDIT_LOCKED' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-40 AC4
   * Scenario: Assigned Coordinator submits a negative expected attendance.
   * Setup:    PLANNING; expectedAttendance -5.
   * Expected: 400 VALIDATION_ERROR naming expectedAttendance; updateById not called.
   * Type:     error
   */
  // SCRUM-40-TC06
  it('AC4: rejects a negative expected attendance and writes nothing', async () => {
    await expect(service.updateEvent(assignedCoordinator, 3, { expectedAttendance: -5 }))
      .rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
        details: { fields: ['expectedAttendance'] },
      });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-40 AC4 / product 4A
   * Scenario: Assigned Coordinator saves an ordinary (non-critical) field before Confirmed.
   * Setup:    PLANNING; specialRequests only.
   * Expected: special_requests is written via updateById.
   * Type:     normal
   */
  // SCRUM-40-TC07
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
  // SCRUM-40-TC05
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

// SCRUM-38-TC08
// Regression guard: the tests above all call service.updateEvent() directly. This one
// confirms the 409/EDIT_LOCKED response actually survives the real route + auth
// middleware + error handler, not just the service function in isolation.
describe('SCRUM-38 EDIT_LOCKED through the real HTTP route', () => {
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  const { createApp } = require('../src/app');
  const { env } = require('../src/config/env');
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    db.supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    });
    db.fetchMany.mockResolvedValue([]);
  });

  it('PATCH /api/events/:id returns 409 EDIT_LOCKED when the owning organiser edits a submitted request directly', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 1, is_active: true }); // auth: signed-in user
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_ORGANISER }]); // auth: their roles
    db.fetchOne.mockResolvedValueOnce({ // service: the event being patched
      id: 3, organiser_id: 1, organisation_id: 10, coordinator_id: 2, status: EVENT_STATUS.SUBMITTED, name: 'Workshop',
    });

    const token = jwt.sign({ sub: 1 }, env.jwtSecret);
    const res = await request(app)
      .patch('/api/events/3')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ name: 'Sneaky edit' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EDIT_LOCKED');
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

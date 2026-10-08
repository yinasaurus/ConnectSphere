/**
 * SCRUM-71: Lead assigns a Coordinator to a Submitted event that has none.
 *
 * Labels:
 *   US71-B..  service rules (assignPrimaryCoordinator / listAssignableCoordinators)
 *   US71-R..  HTTP route (auth cookie + Lead role + body validation)
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
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };

let event;

function submittedUnassigned() {
  return {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: null,
    status: 'SUBMITTED',
    name: 'Workshop',
    purpose: 'Learn',
    description: 'A workshop',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  event = submittedUnassigned();
  db.supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  });
  db.fetchOne.mockImplementation(async () => event);
  db.fetchMany.mockResolvedValue([]);
  db.updateById.mockImplementation(async (_table, _id, patch) => {
    Object.assign(event, patch);
    return event;
  });
});

describe('SCRUM-71 assign primary coordinator (service rules)', () => {
  /*
   * AC: SCRUM-71 AC1, AC3, AC4
   * Scenario: A Lead assigns an active Coordinator to a Submitted event that has none.
   * Setup: Event 3 is SUBMITTED with coordinator_id null. Candidate 2 is an active Coordinator.
   * Expected: The event is written with exactly that coordinator_id and is no longer unassigned.
   *   Status moves to UNDER_REVIEW (coordinator assigned). No organiser notification (SCRUM-29/45).
   * Type: normal
   */
  it('US71-B01: a Lead assigns an active Coordinator to a Submitted unassigned event', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 2, full_name: 'Chloe Lim', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);

    const result = await service.assignPrimaryCoordinator(lead, 3, 2);

    expect(db.updateById).toHaveBeenCalledTimes(1);
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      coordinator_id: 2,
      status: 'UNDER_REVIEW',
    }));
    expect(result.coordinatorId).toBe(2); // AC3: exactly one primary Coordinator
    expect(result.coordinatorId).not.toBeNull(); // AC4: no longer unassigned
    expect(audit.notifyUser).not.toHaveBeenCalled();
    expect(audit.writeAudit).toHaveBeenCalledWith(
      11,
      'COORDINATOR_ASSIGNED',
      'event',
      3,
      { coordinatorId: 2 }
    );
  });

  /*
   * AC: SCRUM-71 AC2
   * Scenario: The Lead picks a Coordinator whose account is inactive.
   * Setup: Event is Submitted and unassigned. User 9 exists but is_active is false.
   *   The Coordinator role is not loaded; inactive accounts are refused before the role check.
   * Expected: 409 INVALID_COORDINATOR. updateById is not called so the event stays unassigned.
   * Type: error
   */
  it('US71-B02: assigning an inactive Coordinator is rejected and the event is unchanged', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 9, full_name: 'Inactive', is_active: false });

    await expect(service.assignPrimaryCoordinator(lead, 3, 9)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_COORDINATOR',
    });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBeNull();
  });

  /*
   * AC: SCRUM-71 AC2
   * Scenario: The chosen user is active but is not a Coordinator (e.g. Venue Staff).
   * Setup: Event is Submitted and unassigned. User 5 is active with VENUE_STAFF only.
   * Expected: 409. The event is not written.
   * Type: error
   */
  it('US71-B03: assigning a user who is not a Coordinator is rejected and the event is unchanged', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 5, full_name: 'Elena Wong', is_active: true });
    db.fetchMany.mockResolvedValue([{ role: ROLES.VENUE_STAFF }]);

    await expect(service.assignPrimaryCoordinator(lead, 3, 5)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_COORDINATOR',
    });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBeNull();
  });

  /*
   * AC: SCRUM-71 AC2
   * Scenario: The chosen user id does not exist.
   * Setup: Event is Submitted and unassigned. fetchOne for the candidate returns null.
   * Expected: 409. The event is not written.
   * Type: error
   */
  it('US71-B04: assigning a missing user is rejected and the event is unchanged', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(null);

    await expect(service.assignPrimaryCoordinator(lead, 3, 99)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_COORDINATOR',
    });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-71 AC5
   * Scenario: The event already has a Coordinator. The Lead tries this assign action anyway.
   * Setup: Event 3 is still SUBMITTED and already has coordinator_id 2. The Lead asks to assign user 4.
   *   Status stays Submitted so a failure cannot be explained by the AC1 Submitted-only rule.
   * Expected: 409 ALREADY_ASSIGNED. Original coordinator_id 2 is kept. This is reassignment (SCRUM-31).
   * Type: conflict
   */
  it('US71-B05: an event that already has a Coordinator cannot be assigned through this action', async () => {
    event.coordinator_id = 2;
    event.status = 'SUBMITTED';

    await expect(service.assignPrimaryCoordinator(lead, 3, 4)).rejects.toMatchObject({
      status: 409,
      code: 'ALREADY_ASSIGNED',
    });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBe(2);
  });

  /*
   * AC: SCRUM-71 AC1
   * Scenario: The event has no Coordinator but is not Submitted (e.g. still a Draft).
   * Setup: coordinator_id is null; status is DRAFT, UNDER_REVIEW, or PLANNING.
   * Expected: 409 INVALID_STATUS. The event is not written.
   * Type: error
   */
  it.each(['DRAFT', 'UNDER_REVIEW', 'PLANNING'])(
    'US71-B06: a Lead cannot assign a Coordinator while the event is %s',
    async (status) => {
      event.status = status;
      event.coordinator_id = null;

      await expect(service.assignPrimaryCoordinator(lead, 3, 2)).rejects.toMatchObject({
        status: 409,
        code: 'INVALID_STATUS',
      });
      expect(db.updateById).not.toHaveBeenCalled();
    }
  );

  /*
   * AC: SCRUM-71 AC6
   * Scenario: A user who is not a Lead calls the assign service.
   * Setup: Caller is a Coordinator, Organiser, or Venue Staff. Event is otherwise assignable.
   * Expected: 403. The event stays unassigned.
   * Type: error
   */
  it.each([
    ['Event Coordinator', coordinator],
    ['Event Organiser', organiser],
    ['Venue Staff', { id: 5, roles: [ROLES.VENUE_STAFF] }],
  ])('US71-B07: %s cannot assign a Coordinator', async (_label, user) => {
    await expect(service.assignPrimaryCoordinator(user, 3, 2)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(event.coordinator_id).toBeNull();
  });

  /*
   * AC: SCRUM-71 AC6
   * Scenario: A hybrid Lead+Coordinator account assigns (every held role works in one session).
   * Setup: User holds EVENT_COORDINATOR and EVENT_COORDINATOR_LEAD. Event is Submitted and unassigned.
   * Expected: Assignment succeeds because they hold Lead, not because they are a Coordinator.
   * Type: normal
   */
  it('US71-B08: a hybrid Lead and Coordinator can assign', async () => {
    const hybrid = { id: 13, roles: [ROLES.EVENT_COORDINATOR, ROLES.EVENT_COORDINATOR_LEAD] };
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 2, full_name: 'Chloe Lim', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);

    await service.assignPrimaryCoordinator(hybrid, 3, 2);
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ coordinator_id: 2 }));
  });

  /*
   * AC: SCRUM-71 AC4
   * Scenario: After a successful assign, a second assign on the same event is refused.
   * Setup: First call writes coordinator_id 2. Event object now has a Coordinator.
   * Expected: Second call is ALREADY_ASSIGNED; coordinator_id stays 2. The event is not unassigned.
   * Type: conflict
   */
  it('US71-B09: after assignment the event is no longer treated as unassigned', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 2, full_name: 'Chloe Lim', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);

    await service.assignPrimaryCoordinator(lead, 3, 2);
    expect(event.coordinator_id).toBe(2);

    await expect(service.assignPrimaryCoordinator(lead, 3, 4)).rejects.toMatchObject({
      code: 'ALREADY_ASSIGNED',
    });
    expect(event.coordinator_id).toBe(2);
  });

  /*
   * AC: SCRUM-71 AC2
   * Scenario: The Lead dropdown must not offer inactive Coordinators.
   * Setup: Role rows include user 2 (active) and user 9 (inactive).
   * Expected: Only the active Coordinator is returned.
   * Type: boundary
   */
  it('US71-B10: the assignable list omits inactive Coordinators', async () => {
    db.fetchMany
      .mockResolvedValueOnce([{ user_id: 2 }, { user_id: 9 }])
      .mockResolvedValueOnce([
        { id: 2, full_name: 'Chloe Lim', is_active: true },
        { id: 9, full_name: 'Inactive', is_active: false },
      ]);

    const coordinators = await service.listAssignableCoordinators(lead);
    expect(coordinators).toEqual([{ id: 2, fullName: 'Chloe Lim' }]);
  });

  /*
   * AC: SCRUM-71 AC6
   * Scenario: A Coordinator asks for the assignable list.
   * Setup: Caller has EVENT_COORDINATOR only.
   * Expected: 403. No list is returned.
   * Type: error
   */
  it('US71-B11: a non-Lead cannot list assignable Coordinators', async () => {
    await expect(service.listAssignableCoordinators(coordinator)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  /*
   * AC: SCRUM-71 AC1
   * Scenario: The event id does not exist.
   * Setup: fetchOne for the event returns null.
   * Expected: 404. Nothing is written.
   * Type: error
   */
  it('US71-B12: assigning to a missing event returns 404 and writes nothing', async () => {
    db.fetchOne.mockResolvedValueOnce(null);

    await expect(service.assignPrimaryCoordinator(lead, 99, 2)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-71 AC2
   * Scenario: There are no Coordinator role rows, so the Lead has nobody to pick.
   * Setup: user_roles query returns [].
   * Expected: An empty list, not an error.
   * Type: boundary
   */
  it('US71-B13: the assignable list is empty when no Coordinators exist', async () => {
    db.fetchMany.mockResolvedValueOnce([]);
    await expect(service.listAssignableCoordinators(lead)).resolves.toEqual([]);
  });
});

describe('SCRUM-71 POST /api/events/:id/assign-coordinator (route)', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const token = jwt.sign({ sub: 11 }, env.jwtSecret);

  function asRole(role) {
    db.fetchOne.mockResolvedValueOnce({ id: 11, is_active: true });
    db.fetchMany.mockResolvedValue([{ role }]);
    return request(app)
      .post('/api/events/3/assign-coordinator')
      .set('Cookie', `${env.sessionCookieName}=${token}`);
  }

  /*
   * AC: SCRUM-71 AC1
   * Scenario: Lead assigns through the real HTTP route (auth, role, validation, service).
   * Setup: Session user 11 is Lead. Event 3 is Submitted and unassigned. Candidate 2 is an active Coordinator.
   * Expected: 200 and the event is written with coordinator_id 2.
   * Type: normal
   */
  it('US71-R01: a Lead can assign a Coordinator through the API', async () => {
    db.fetchOne
      .mockResolvedValueOnce({ id: 11, is_active: true })
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 2, full_name: 'Chloe Lim', is_active: true })
      .mockResolvedValue(event);
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }])
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR }]);

    const res = await request(app)
      .post('/api/events/3/assign-coordinator')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ coordinatorId: 2 });

    expect(res.status).toBe(200);
    expect(db.updateById).toHaveBeenCalledWith('events', '3', expect.objectContaining({ coordinator_id: 2 }));
  });

  /*
   * AC: SCRUM-71 AC6
   * Scenario: Non-Lead roles hit the route's requireRole check.
   * Setup: Session loads with each non-Lead role. Event is otherwise assignable.
   * Expected: 403 before the service writes anything.
   * Type: error
   */
  it.each([
    ROLES.EVENT_COORDINATOR,
    ROLES.EVENT_ORGANISER,
    ROLES.VENUE_STAFF,
    ROLES.TECHNICAL_SUPPORT,
    ROLES.ATTENDEE,
  ])('US71-R02: %s cannot call the assign endpoint (403)', async (role) => {
    const res = await asRole(role).send({ coordinatorId: 2 });
    expect(res.status).toBe(403);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-71 AC1
   * Scenario: The body is missing coordinatorId.
   * Setup: Lead session. Empty JSON body.
   * Expected: 400 from the validator. The event is not written.
   * Type: error
   */
  it('US71-R03: a missing coordinatorId returns 400', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR_LEAD).send({});
    expect(res.status).toBe(400);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: none (authentication, not AC6 — AC6 is a signed-in user without the Lead role)
   * Scenario: No session cookie.
   * Setup: Anonymous POST to the assign path.
   * Expected: 401. The event is not written.
   * Type: error
   */
  it('US71-R04: a request without a session is rejected with 401', async () => {
    const res = await request(app).post('/api/events/3/assign-coordinator').send({ coordinatorId: 2 });
    expect(res.status).toBe(401);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-71 AC1, AC2
   * Scenario: Lead loads the assignable Coordinators list through HTTP.
   * Setup: Session is Lead. Role rows and users include one active Coordinator.
   * Expected: 200 and the JSON list (inactive accounts would already be filtered in the service).
   * Type: normal
   */
  it('US71-R05: a Lead can list assignable Coordinators through the API', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 11, is_active: true });
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }])
      .mockResolvedValueOnce([{ user_id: 2 }])
      .mockResolvedValueOnce([{ id: 2, full_name: 'Chloe Lim', is_active: true }]);

    const res = await request(app)
      .get('/api/events/assignable-coordinators')
      .set('Cookie', `${env.sessionCookieName}=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.coordinators).toEqual([{ id: 2, fullName: 'Chloe Lim' }]);
  });

  /*
   * AC: SCRUM-71 AC6
   * Scenario: A Coordinator calls GET assignable-coordinators.
   * Setup: Session role is EVENT_COORDINATOR.
   * Expected: 403.
   * Type: error
   */
  it('US71-R06: a Coordinator cannot list assignable Coordinators (403)', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 11, is_active: true });
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);

    const res = await request(app)
      .get('/api/events/assignable-coordinators')
      .set('Cookie', `${env.sessionCookieName}=${token}`);

    expect(res.status).toBe(403);
  });
});

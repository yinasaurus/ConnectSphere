/**
 * SCRUM-34: Event Organiser requests a change after submission.
 * SCRUM-35: Assigned Event Coordinator reviews and decides that request.
 *
 *   SCRUM-34 AC1  Organiser can request a change; unassigned Submitted is refused.
 *   SCRUM-34 AC2  Only date/time, expected attendance, venue requirements and equipment
 *                 requirements may be proposed.
 *   SCRUM-35 AC1  Only the assigned coordinator can approve or reject.
 *   SCRUM-35 AC2  Approve copies the proposed fields onto the event (including Confirmed);
 *                 reject leaves the event unchanged. Event status is not moved.
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

const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const otherCoordinator = { id: 9, roles: [ROLES.EVENT_COORDINATOR] };
const venueStaff = { id: 6, roles: [ROLES.VENUE_STAFF] };

const WINDOW = {
  startAt: '2026-11-20T09:00:00.000Z',
  endAt: '2026-11-20T17:00:00.000Z',
};

function planningEvent(overrides = {}) {
  return {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    status: 'PLANNING',
    name: 'Workshop',
    start_at: '2026-11-10T09:00:00.000Z',
    end_at: '2026-11-10T17:00:00.000Z',
    expected_attendance: 40,
    venue_requirements: 'Lecture theatre',
    equipment_notes: '2 mics',
    ...overrides,
  };
}

function pendingRequest(overrides = {}) {
  return {
    id: 50,
    event_id: 3,
    requested_by: 1,
    decided_by: null,
    status: 'PENDING',
    start_at: WINDOW.startAt,
    end_at: WINDOW.endAt,
    expected_attendance: 80,
    venue_requirements: 'Banquet',
    equipment_notes: '4 mics',
    decision_reason: null,
    decided_at: null,
    ...overrides,
  };
}

let event;

beforeEach(() => {
  jest.clearAllMocks();
  event = planningEvent();
  db.supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  });
  db.fetchOne.mockImplementation(async () => event);
  db.fetchMany.mockResolvedValue([]);
  db.updateById.mockImplementation(async (_table, id, patch) => ({ id, ...patch }));
  db.insertOne.mockImplementation(async (_table, row) => ({ id: 50, ...row }));
});

describe('SCRUM-34 createChangeRequest', () => {
  /*
   * AC:       SCRUM-34 AC1 + AC2
   * Scenario: Organiser proposes a new window, attendance and venue/equipment notes.
   * Setup:    Planning event owned by user 1, assigned to coordinator 2; no pending request.
   * Expected: A PENDING row is written with only those fields; audit is CHANGE_REQUEST_CREATED.
   * Type:     normal
   */
  it('AC1+AC2: organiser can request permitted date, attendance, venue and equipment changes', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(null);

    const result = await service.createChangeRequest(organiser, 3, {
      startAt: WINDOW.startAt,
      endAt: WINDOW.endAt,
      expectedAttendance: 80,
      venueRequirements: 'Banquet',
      equipmentNotes: '4 mics',
    });

    expect(result.status).toBe('PENDING');
    expect(db.insertOne).toHaveBeenCalledWith(
      'event_change_requests',
      expect.objectContaining({
        event_id: 3,
        requested_by: 1,
        status: 'PENDING',
        expected_attendance: 80,
        venue_requirements: 'Banquet',
        equipment_notes: '4 mics',
      })
    );
    expect(audit.writeAudit).toHaveBeenCalledWith(
      1,
      'CHANGE_REQUEST_CREATED',
      'event_change_request',
      50,
      expect.objectContaining({ eventId: 3 })
    );
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC2
   * Scenario: Organiser includes a field that is not in the permitted set.
   * Setup:    Same Planning event; payload also has accessibilityNeeds.
   * Expected: 400; nothing is inserted.
   * Type:     negative
   */
  it('AC2: unknown fields are refused', async () => {
    await expect(service.createChangeRequest(organiser, 3, {
      expectedAttendance: 80,
      accessibilityNeeds: 'Step-free',
    })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC2
   * Scenario: Organiser posts an empty body.
   * Expected: 400; nothing is inserted.
   * Type:     boundary
   */
  it('AC2: at least one permitted field is required', async () => {
    await expect(service.createChangeRequest(organiser, 3, {})).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Organiser tries to change a Draft (they should edit the draft instead).
   * Expected: 409 CHANGE_NOT_ALLOWED; nothing is inserted.
   * Type:     negative
   */
  it.each(['DRAFT', 'CANCELLED', 'REJECTED', 'COMPLETED'])(
    'AC1: %s events cannot receive a change request',
    async (status) => {
      event = planningEvent({ status });
      db.fetchOne.mockImplementation(async () => event);
      await expect(service.createChangeRequest(organiser, 3, { expectedAttendance: 80 }))
        .rejects.toMatchObject({ status: 409, code: 'CHANGE_NOT_ALLOWED' });
      expect(db.insertOne).not.toHaveBeenCalled();
    }
  );

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Submitted event still in the unassigned queue.
   * Expected: 409 NO_COORDINATOR; nothing is inserted.
   * Type:     negative
   */
  it('AC1: unassigned Submitted events cannot receive a change request', async () => {
    event = planningEvent({ status: 'SUBMITTED', coordinator_id: null });
    db.fetchOne.mockImplementation(async () => event);
    await expect(service.createChangeRequest(organiser, 3, { expectedAttendance: 80 }))
      .rejects.toMatchObject({ status: 409, code: 'NO_COORDINATOR' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: A PENDING change request already exists for the event.
   * Expected: 409 PENDING_CHANGE_EXISTS.
   * Type:     negative
   */
  it('AC1: a second pending request is refused', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 49, status: 'PENDING' });
    await expect(service.createChangeRequest(organiser, 3, { expectedAttendance: 80 }))
      .rejects.toMatchObject({ status: 409, code: 'PENDING_CHANGE_EXISTS' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Assigned coordinator (not the owner) tries to create a request.
   * Expected: 403; event and table unchanged.
   * Type:     security
   */
  it('AC1: only the owning organiser can create a change request', async () => {
    await expect(service.createChangeRequest(coordinator, 3, { expectedAttendance: 80 }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });
});

describe('SCRUM-35 decideChangeRequest', () => {
  /*
   * AC:       SCRUM-35 AC1 + AC2
   * Scenario: Assigned coordinator approves a pending request on a Planning event.
   * Setup:    Request proposes new times, attendance, venue and equipment notes.
   * Expected: Those columns are written onto the event; status stays PLANNING; request APPROVED.
   * Type:     normal
   */
  it('AC1+AC2: assigned coordinator approve copies proposed fields and leaves status', async () => {
    const pending = pendingRequest();
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pending);

    const result = await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(result.status).toBe('APPROVED');
    expect(db.updateById).toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({
        start_at: WINDOW.startAt,
        end_at: WINDOW.endAt,
        expected_attendance: 80,
        venue_requirements: 'Banquet',
        equipment_notes: '4 mics',
      })
    );
    expect(db.updateById).toHaveBeenCalledWith(
      'event_change_requests',
      50,
      expect.objectContaining({ status: 'APPROVED', decided_by: 2 })
    );
    const eventPatch = db.updateById.mock.calls.find((call) => call[0] === 'events')[2];
    expect(eventPatch.status).toBeUndefined();
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-35 AC2
   * Scenario: Assigned coordinator approves a request on a Confirmed event.
   * Setup:    Event CONFIRMED; request changes start/end. Direct PATCH would be EDIT_LOCKED.
   * Expected: events row is updated via updateById (the change-request path), status stays CONFIRMED.
   * Type:     normal
   */
  it('AC2: approving a Confirmed change request updates fields without using updateEvent', async () => {
    event = planningEvent({ status: 'CONFIRMED' });
    const pending = pendingRequest({
      expected_attendance: null,
      venue_requirements: null,
      equipment_notes: null,
    });
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pending);

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(db.updateById).toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({
        start_at: WINDOW.startAt,
        end_at: WINDOW.endAt,
      })
    );
    const eventPatch = db.updateById.mock.calls.find((call) => call[0] === 'events')[2];
    expect(eventPatch.status).toBeUndefined();
  });

  /*
   * AC:       SCRUM-35 AC2
   * Scenario: Assigned coordinator rejects, optionally with a reason.
   * Expected: Request REJECTED with the reason; events table is not written.
   * Type:     normal
   */
  it('AC2: reject leaves the event unchanged and stores an optional reason', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest());

    const result = await service.decideChangeRequest(coordinator, 3, 50, {
      approve: false,
      reason: 'Venue already booked that week',
    });

    expect(result.status).toBe('REJECTED');
    expect(db.updateById).toHaveBeenCalledWith(
      'event_change_requests',
      50,
      expect.objectContaining({
        status: 'REJECTED',
        decision_reason: 'Venue already booked that week',
      })
    );
    expect(db.updateById).not.toHaveBeenCalledWith('events', expect.anything(), expect.anything());
  });

  /*
   * AC:       SCRUM-35 AC1
   * Scenario: Another coordinator, or venue staff, tries to decide.
   * Expected: 403; no writes.
   * Type:     security
   */
  it.each([
    ['another coordinator', otherCoordinator],
    ['venue staff', venueStaff],
    ['organiser', organiser],
  ])('AC1: %s cannot decide a change request', async (_label, actor) => {
    await expect(service.decideChangeRequest(actor, 3, 50, { approve: true }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-35 AC1
   * Scenario: Coordinator decides a request that is already APPROVED.
   * Expected: 409 ALREADY_DECIDED; event not written again.
   * Type:     negative
   */
  it('AC1: an already decided request cannot be decided again', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({ status: 'APPROVED' }));

    await expect(service.decideChangeRequest(coordinator, 3, 50, { approve: false }))
      .rejects.toMatchObject({ status: 409, code: 'ALREADY_DECIDED' });
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

describe('SCRUM-34/35 listChangeRequests', () => {
  /*
   * AC:       SCRUM-34 AC1 / SCRUM-35 AC1
   * Scenario: Owner and assigned coordinator list requests; another coordinator cannot.
   * Type:     security
   */
  it('owner and assigned coordinator can list requests', async () => {
    db.fetchMany.mockResolvedValue([pendingRequest()]);
    const rows = await service.listChangeRequests(organiser, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(50);
  });

  it('another coordinator cannot list change requests', async () => {
    await expect(service.listChangeRequests(otherCoordinator, 3))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});

describe('SCRUM-34/35 HTTP routes', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const organiserToken = jwt.sign({ sub: 1 }, env.jwtSecret);
  const coordinatorToken = jwt.sign({ sub: 2 }, env.jwtSecret);

  function asUser(userId, role) {
    db.fetchOne.mockResolvedValueOnce({
      id: userId,
      is_active: true,
      organisation_id: 10,
    });
    db.fetchMany.mockResolvedValue([{ role }]);
  }

  it('organiser can POST a change request (201)', async () => {
    asUser(1, ROLES.EVENT_ORGANISER);
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/events/3/change-requests')
      .set('Cookie', `${env.sessionCookieName}=${organiserToken}`)
      .send({ expectedAttendance: 80 });

    expect(res.status).toBe(201);
    expect(res.body.changeRequest.status).toBe('PENDING');
    expect(db.insertOne).toHaveBeenCalled();
  });

  it('coordinator cannot POST a change request (403)', async () => {
    asUser(2, ROLES.EVENT_COORDINATOR);

    const res = await request(app)
      .post('/api/events/3/change-requests')
      .set('Cookie', `${env.sessionCookieName}=${coordinatorToken}`)
      .send({ expectedAttendance: 80 });

    expect(res.status).toBe(403);
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  it('assigned coordinator can approve through the API (200)', async () => {
    asUser(2, ROLES.EVENT_COORDINATOR);
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest());

    const res = await request(app)
      .post('/api/events/3/change-requests/50/decision')
      .set('Cookie', `${env.sessionCookieName}=${coordinatorToken}`)
      .send({ approve: true });

    expect(res.status).toBe(200);
    expect(res.body.changeRequest.status).toBe('APPROVED');
  });

  it('organiser cannot call the decision endpoint (403)', async () => {
    asUser(1, ROLES.EVENT_ORGANISER);

    const res = await request(app)
      .post('/api/events/3/change-requests/50/decision')
      .set('Cookie', `${env.sessionCookieName}=${organiserToken}`)
      .send({ approve: true });

    expect(res.status).toBe(403);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('a request without a session is rejected with 401', async () => {
    const res = await request(app)
      .post('/api/events/3/change-requests')
      .send({ expectedAttendance: 80 });
    expect(res.status).toBe(401);
    expect(db.insertOne).not.toHaveBeenCalled();
  });
});

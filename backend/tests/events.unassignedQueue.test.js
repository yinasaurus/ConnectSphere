/**
 * SCRUM-28: submitted requests enter the unassigned queue (W7 #5).
 *
 * AC1  Submit → status Submitted, no Coordinator, in the unassigned queue.
 * AC2  No Coordinator is assigned automatically at any point after submission.
 * AC3  A request stays in the unassigned queue until a Coordinator is assigned (SCRUM-71).
 * AC4  A draft is not placed in the unassigned queue.
 *
 * Viewing the queue UI is SCRUM-65. Lead assignment is SCRUM-71.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
  updateById: jest.fn(), insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));

const db = require('../src/config/db');
const audit = require('../src/services/audit.service');
const service = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');
const { EVENT_STATUS } = require('../src/constants/statuses');
const { env } = require('../src/config/env');

const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };

const completeDraft = {
  id: 3,
  organiser_id: 1,
  organisation_id: 10,
  coordinator_id: null,
  status: EVENT_STATUS.DRAFT,
  name: 'Town Hall',
  purpose: 'Quarterly update',
  description: 'All-hands meeting for the team.',
  start_at: '2026-10-01T10:00:00Z',
  end_at: '2026-10-01T11:00:00Z',
  expected_attendance: 50,
  venue_requirements: 'Projector and stage',
  accessibility_needs: 'None',
};

let event;
let query;

beforeEach(() => {
  jest.clearAllMocks();
  event = { ...completeDraft };
  query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  };
  db.supabase.from.mockReturnValue(query);
  db.fetchOne.mockImplementation(async () => ({ ...event }));
  db.fetchMany.mockResolvedValue([]);
  db.updateById.mockImplementation(async (_table, _id, patch) => {
    Object.assign(event, patch);
    return event;
  });
});

describe('SCRUM-28 unassigned queue (service)', () => {
  /*
   * AC: SCRUM-28 AC1
   * Scenario: An Event Organiser submits a complete draft request.
   * Setup: Draft owned by organiser 1, all compulsory fields filled, coordinator_id already null.
   * Expected: Status becomes Submitted, no Coordinator is stored, and the request is in the queue.
   * Type: normal
   */
  it('AC1: submitting a complete draft stores Submitted with no Coordinator', async () => {
    const result = await service.submitEvent(organiser, 3);

    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      status: EVENT_STATUS.SUBMITTED,
      coordinator_id: null,
      sub_state: null,
    }));
    expect(result.status).toBe(EVENT_STATUS.SUBMITTED);
    expect(result.coordinatorId).toBeNull();
    expect(service.isInUnassignedQueue(result)).toBe(true);
    expect(db.insertOne).toHaveBeenCalledWith('event_status_history', expect.objectContaining({
      from_status: EVENT_STATUS.DRAFT,
      to_status: EVENT_STATUS.SUBMITTED,
    }));
    expect(audit.writeAudit).toHaveBeenCalledWith(1, 'EVENT_SUBMITTED', 'event', 3, { coordinatorId: null });
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-28 AC1
   * Scenario: Coordinators exist at submit time (old auto-assign would have picked one).
   * Setup: Complete draft. Submit does not read coordinator rows; the unused fetchMany stub
   *         would only matter if load-balancing still ran.
   * Expected: coordinator_id is null and user_roles is never queried.
   * Type: boundary
   */
  it('AC1: submit does not assign even when Coordinators are available', async () => {
    db.fetchMany.mockResolvedValue([{ id: 2 }, { id: 7 }]);

    await service.submitEvent(organiser, 3);

    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      coordinator_id: null,
      status: EVENT_STATUS.SUBMITTED,
    }));
    expect(db.supabase.from).not.toHaveBeenCalledWith('user_roles');
  });

  /*
   * AC: SCRUM-28 AC1
   * Scenario: Organiser submits an incomplete draft.
   * Setup: Name only; compulsory submission fields missing.
   * Expected: 400, nothing written, request stays a draft and out of the queue.
   * Type: error
   */
  it('AC1: incomplete submit is refused and stays out of the unassigned queue', async () => {
    event.purpose = null;
    event.description = null;

    await expect(service.submitEvent(organiser, 3)).rejects.toMatchObject({ status: 400 });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(service.isInUnassignedQueue(event)).toBe(false);
  });

  /*
   * AC: SCRUM-28 AC1
   * Scenario: Someone other than the owner tries to submit.
   * Setup: Coordinator 99 is not the organiser and is not assigned to this draft.
   * Expected: 403 and the draft is not queued.
   * Type: error
   */
  it('AC1: a non-owner cannot submit a request into the queue', async () => {
    await expect(service.submitEvent({ ...coordinator, id: 99 }, 3)).rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-28 AC1
   * Scenario: Submit is called for an id that does not exist.
   * Setup: fetchOne returns null.
   * Expected: 404, no queue write.
   * Type: error
   */
  it('AC1: a missing event cannot be placed in the queue', async () => {
    db.fetchOne.mockResolvedValue(null);
    await expect(service.submitEvent(organiser, 404)).rejects.toMatchObject({ status: 404 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-28 AC1
   * Scenario: Organiser submits an event that is not allowed to move to Submitted.
   * Setup: Already SUBMITTED (in the queue) or PLANNING — neither may transition to SUBMITTED.
   * Expected: 409, nothing written, no Coordinator assigned.
   * Type: error
   */
  it.each([EVENT_STATUS.SUBMITTED, EVENT_STATUS.PLANNING])(
    'AC1: submit from %s is refused with 409 and does not assign a Coordinator',
    async (status) => {
      event.status = status;
      event.coordinator_id = status === EVENT_STATUS.PLANNING ? 2 : null;
      await expect(service.submitEvent(organiser, 3)).rejects.toMatchObject({ status: 409 });
      expect(db.updateById).not.toHaveBeenCalled();
    }
  );

  /*
   * AC: SCRUM-28 AC1
   * Scenario: Organiser resubmits after a rejection (still a submit of an event request).
   * Setup: REJECTED event that previously had coordinator 2 and a rejection reason.
   * Expected: Back to Submitted, coordinator cleared, in the unassigned queue.
   * Type: boundary
   */
  it('AC1: resubmitting a rejected request returns it to the unassigned queue', async () => {
    event.status = EVENT_STATUS.REJECTED;
    event.coordinator_id = 2;
    event.rejection_reason = 'Attendance numbers are missing';

    const result = await service.submitEvent(organiser, 3);

    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      status: EVENT_STATUS.SUBMITTED,
      coordinator_id: null,
      rejection_reason: null,
    }));
    expect(service.isInUnassignedQueue(result)).toBe(true);
  });

  /*
   * AC: SCRUM-28 AC2
   * Scenario: After submit, the organiser reads the event and the unassigned queue again.
   * Setup: Submit succeeded; Coordinators still exist in fetchMany.
   * Expected: coordinatorId stays null on get and on the unassigned list — nothing assigns later.
   * Type: normal
   */
  it('AC2: get and list after submit still have no Coordinator', async () => {
    await service.submitEvent(organiser, 3);
    db.fetchMany.mockResolvedValue([event]);

    const again = await service.getEvent(organiser, 3);
    const queued = await service.listEvents(organiser, { unassigned: true });

    expect(again.coordinatorId).toBeNull();
    expect(again.status).toBe(EVENT_STATUS.SUBMITTED);
    expect(queued).toHaveLength(1);
    expect(queued[0].coordinatorId).toBeNull();
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-28 AC2
   * Scenario: Submit must not look up Coordinators to pick one (old load-balancing).
   * Setup: Complete draft; supabase.from is watched.
   * Expected: events table is read/updated; user_roles is never queried for assignment.
   * Type: conflict (old auto-assign must not run)
   */
  it('AC2: submit never queries coordinator roles to auto-assign', async () => {
    await service.submitEvent(organiser, 3);
    const tables = db.supabase.from.mock.calls.map((call) => call[0]);
    expect(tables).not.toContain('user_roles');
    expect(tables).not.toContain('users');
  });

  /*
   * AC: SCRUM-28 AC3
   * Scenario: A submitted request is listed in the unassigned queue.
   * Setup: Event already Submitted with coordinator_id null (as submit left it).
   * Expected: unassigned list includes it; the SQL filter is Submitted + coordinator_id is null.
   * Type: normal
   */
  it('AC3: a submitted unassigned request appears in the unassigned queue', async () => {
    event.status = EVENT_STATUS.SUBMITTED;
    event.coordinator_id = null;
    db.fetchMany.mockResolvedValue([event]);

    const queued = await service.listEvents(organiser, { unassigned: true });

    expect(query.eq).toHaveBeenCalledWith('status', EVENT_STATUS.SUBMITTED);
    expect(query.is).toHaveBeenCalledWith('coordinator_id', null);
    expect(queued).toHaveLength(1);
    expect(service.isInUnassignedQueue(queued[0])).toBe(true);
  });

  /*
   * AC: SCRUM-28 AC3
   * Scenario: A Coordinator has been assigned (SCRUM-71), so the request must leave the queue.
   * Setup: Same id, status still Submitted in this fixture, but coordinator_id is 2.
   * Expected: Not in the unassigned queue. Assignment itself is out of scope; membership is.
   * Type: boundary
   */
  it('AC3: an assigned request is not in the unassigned queue', async () => {
    event.status = EVENT_STATUS.SUBMITTED;
    event.coordinator_id = 2;
    db.fetchMany.mockResolvedValue([event]);

    const queued = await service.listEvents(organiser, { unassigned: true });

    expect(queued).toHaveLength(0);
    expect(service.isInUnassignedQueue(event)).toBe(false);
  });

  /*
   * AC: SCRUM-28 AC3
   * Scenario: Queue membership helper is asked about a missing event.
   * Setup: null instead of a row (e.g. a lookup that returned nothing).
   * Expected: false — only a Submitted, unassigned row is in the queue.
   * Type: boundary
   */
  it('AC3: a missing event is not in the unassigned queue', () => {
    expect(service.isInUnassignedQueue(null)).toBe(false);
  });

  /*
   * AC: not an AC check — regression for listEvents after the unassigned filter was added
   * Scenario: Callers that list by status=Submitted (without unassigned=true) still get a status filter.
   * Setup: One Submitted unassigned event; filter is status only.
   * Expected: eq(status) is used and coordinator_id is not required to be null.
   * Type: normal
   */
  it('listEvents still filters by status Submitted when unassigned is not requested', async () => {
    event.status = EVENT_STATUS.SUBMITTED;
    event.coordinator_id = null;
    db.fetchMany.mockResolvedValue([event]);

    const listed = await service.listEvents(organiser, { status: EVENT_STATUS.SUBMITTED });

    expect(query.eq).toHaveBeenCalledWith('status', EVENT_STATUS.SUBMITTED);
    expect(query.is).not.toHaveBeenCalled();
    expect(listed).toHaveLength(1);
  });

  /*
   * AC: not an AC check — coverage for listEvents when neither unassigned nor status is set
   * Scenario: A caller lists events with no filters (Dashboard, default GET /api/events).
   * Setup: One draft in the organisation; listEvents is called with an empty filters object.
   * Expected: No status filter and no coordinator_id IS NULL filter; the draft is returned.
   * Type: normal
   */
  it('listEvents with no filters does not apply a status or unassigned queue filter', async () => {
    db.fetchMany.mockResolvedValue([event]);

    const listed = await service.listEvents(organiser);

    expect(query.eq).not.toHaveBeenCalledWith('status', EVENT_STATUS.SUBMITTED);
    expect(query.eq).not.toHaveBeenCalledWith('status', event.status);
    expect(query.is).not.toHaveBeenCalled();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(3);
  });

  /*
   * AC: SCRUM-28 AC3
   * Scenario: Under Review (coordinator assigned in later stories) is not the unassigned queue.
   * Setup: UNDER_REVIEW with coordinator 2 — the old submit destination.
   * Expected: Helper and unassigned list both exclude it.
   * Type: boundary
   */
  it('AC3: an under-review event is not in the unassigned queue', async () => {
    event.status = EVENT_STATUS.UNDER_REVIEW;
    event.coordinator_id = 2;
    db.fetchMany.mockResolvedValue([event]);

    const queued = await service.listEvents(organiser, { unassigned: true });

    expect(queued).toHaveLength(0);
    expect(service.isInUnassignedQueue(event)).toBe(false);
  });

  /*
   * AC: SCRUM-28 AC4
   * Scenario: Organiser saves a new request as a draft instead of submitting.
   * Setup: createEvent with a name only; insert returns a DRAFT row with no coordinator_id.
   * Expected: Status is Draft, not in the unassigned queue.
   * Type: normal
   */
  it('AC4: creating a draft does not place it in the unassigned queue', async () => {
    const created = { id: 11, ...completeDraft, status: EVENT_STATUS.DRAFT, coordinator_id: null };
    db.insertOne.mockResolvedValue(created);
    db.fetchOne.mockResolvedValue(created);

    const draft = await service.createEvent(organiser, { name: 'Partial Hackathon Draft' });

    expect(draft.status).toBe(EVENT_STATUS.DRAFT);
    expect(draft.coordinatorId).toBeNull();
    expect(service.isInUnassignedQueue(draft)).toBe(false);
  });

  /*
   * AC: SCRUM-28 AC4
   * Scenario: The unassigned queue is listed while a draft exists in the same organisation.
   * Setup: fetchMany returns the draft (as a naive store might); filter must still drop it.
   * Expected: Empty queue — drafts are not Submitted.
   * Type: boundary
   */
  it('AC4: listing the unassigned queue excludes drafts', async () => {
    db.fetchMany.mockResolvedValue([event]);

    const queued = await service.listEvents(organiser, { unassigned: true });

    expect(query.eq).toHaveBeenCalledWith('status', EVENT_STATUS.SUBMITTED);
    expect(queued).toHaveLength(0);
    expect(service.isInUnassignedQueue(event)).toBe(false);
  });

  /*
   * AC: SCRUM-28 AC4
   * Scenario: Organiser updates a draft without submitting.
   * Setup: Draft stays DRAFT after updateEvent.
   * Expected: Still not in the unassigned queue.
   * Type: normal
   */
  it('AC4: saving more draft fields still does not queue the request', async () => {
    db.fetchOne.mockResolvedValue(event);
    const updated = await service.updateEvent(organiser, 3, { purpose: 'Updated purpose' });

    expect(updated.status).toBe(EVENT_STATUS.DRAFT);
    expect(service.isInUnassignedQueue(updated)).toBe(false);
    expect(db.updateById).not.toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({ status: EVENT_STATUS.SUBMITTED })
    );
  });
});

describe('SCRUM-28 POST /api/events/:id/submit (route)', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const token = jwt.sign({ sub: 1 }, env.jwtSecret);

  function asOrganiser() {
    db.fetchOne.mockResolvedValueOnce({ id: 1, is_active: true, organisation_id: 10 });
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_ORGANISER }]);
    return request(app)
      .post('/api/events/3/submit')
      .set('Cookie', `${env.sessionCookieName}=${token}`);
  }

  /*
   * AC: SCRUM-28 AC1
   * Scenario: Organiser submits through the HTTP API (auth + role + service).
   * Setup: Session for user 1 with EVENT_ORGANISER; event 3 is a complete draft.
   * Expected: 200, body status SUBMITTED, coordinatorId null.
   * Type: normal
   */
  it('AC1: POST submit returns Submitted with no Coordinator', async () => {
    const res = await asOrganiser();
    expect(res.status).toBe(200);
    expect(res.body.event.status).toBe(EVENT_STATUS.SUBMITTED);
    expect(res.body.event.coordinatorId).toBeNull();
    expect(db.updateById).toHaveBeenCalledWith('events', '3', expect.objectContaining({
      status: EVENT_STATUS.SUBMITTED,
      coordinator_id: null,
    }));
  });

  /*
   * AC: SCRUM-28 AC1
   * Scenario: Unauthenticated submit.
   * Setup: No session cookie.
   * Expected: 401, request not queued.
   * Type: error
   */
  it('AC1: submit without a session is 401 and does not queue', async () => {
    const res = await request(app).post('/api/events/3/submit');
    expect(res.status).toBe(401);
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

describe('SCRUM-28 GET /api/events?unassigned=true (route)', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const token = jwt.sign({ sub: 1 }, env.jwtSecret);

  /*
   * AC: SCRUM-28 AC4
   * Scenario: Queue listing through the API while only a draft exists.
   * Setup: Auth organiser; fetchMany returns a DRAFT row.
   * Expected: 200 with an empty list — drafts are not in the unassigned queue.
   * Type: boundary
   */
  it('AC4: GET unassigned=true does not return drafts', async () => {
    db.fetchOne.mockResolvedValue({ id: 1, is_active: true, organisation_id: 10 });
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_ORGANISER }])
      .mockResolvedValueOnce([event]);

    const res = await request(app)
      .get('/api/events?unassigned=true')
      .set('Cookie', `${env.sessionCookieName}=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
  });

  /*
   * AC: SCRUM-28 AC3
   * Scenario: Queue listing through the API for a submitted unassigned request.
   * Setup: Auth organiser; fetchMany returns SUBMITTED with coordinator_id null.
   * Expected: 200 with that event still unassigned.
   * Type: normal
   */
  it('AC3: GET unassigned=true returns a submitted request until it is assigned', async () => {
    event.status = EVENT_STATUS.SUBMITTED;
    event.coordinator_id = null;
    db.fetchOne.mockResolvedValue({ id: 1, is_active: true, organisation_id: 10 });
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_ORGANISER }])
      .mockResolvedValueOnce([event]);

    const res = await request(app)
      .get('/api/events?unassigned=true')
      .set('Cookie', `${env.sessionCookieName}=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].status).toBe(EVENT_STATUS.SUBMITTED);
    expect(res.body.events[0].coordinatorId).toBeNull();
  });

  /*
   * AC: SCRUM-28 AC3
   * Scenario: Queue listing through the API using the numeric query flag unassigned=1.
   * Setup: Auth organiser; fetchMany returns SUBMITTED with coordinator_id null.
   * Expected: Same queue as unassigned=true — 200 with that event still unassigned.
   * Type: normal
   */
  it('AC3: GET unassigned=1 returns the same unassigned queue as unassigned=true', async () => {
    event.status = EVENT_STATUS.SUBMITTED;
    event.coordinator_id = null;
    db.fetchOne.mockResolvedValue({ id: 1, is_active: true, organisation_id: 10 });
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_ORGANISER }])
      .mockResolvedValueOnce([event]);

    const res = await request(app)
      .get('/api/events?unassigned=1')
      .set('Cookie', `${env.sessionCookieName}=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].status).toBe(EVENT_STATUS.SUBMITTED);
    expect(res.body.events[0].coordinatorId).toBeNull();
  });
});

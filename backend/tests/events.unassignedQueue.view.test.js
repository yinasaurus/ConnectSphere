/**
 * SCRUM-65: Event Coordinator Lead views the unassigned Submitted queue (W7 #5).
 *
 * AC1  The Lead can view every Submitted request that has no Coordinator.
 * AC2  Requests that already have a Coordinator are not in the queue.
 * AC3  Draft requests are not in the queue.
 * AC4  The queue shows name, organiser, date/time, expected attendance, venue and equipment needs.
 * AC5  The Lead can view the full details of any request in the queue.
 *
 * Access-only-Lead (who may open the page) is SCRUM-54 AC3. Assignment is SCRUM-71.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
  updateById: jest.fn(), insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));

const db = require('../src/config/db');
const service = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');
const { EVENT_STATUS } = require('../src/constants/statuses');
const { env } = require('../src/config/env');

const lead = { id: 9, organisationId: null, roles: [ROLES.EVENT_COORDINATOR_LEAD] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };

function queuedRow(overrides = {}) {
  return {
    id: 11,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: null,
    status: EVENT_STATUS.SUBMITTED,
    name: 'Town Hall',
    purpose: 'Quarterly update',
    description: 'All-hands meeting for the team.',
    start_at: '2026-10-01T10:00:00Z',
    end_at: '2026-10-01T11:00:00Z',
    expected_attendance: 50,
    venue_requirements: 'Projector and stage',
    equipment_notes: 'Two wireless mics',
    accessibility_needs: 'None',
    organisation: { name: 'Acme' },
    organiser: { full_name: 'Aisha Rahman' },
    coordinator: null,
    ...overrides,
  };
}

let query;

beforeEach(() => {
  jest.clearAllMocks();
  query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  };
  db.supabase.from.mockReturnValue(query);
  db.fetchMany.mockResolvedValue([]);
});

describe('SCRUM-65 listUnassignedQueue (service)', () => {
  /*
   * AC: SCRUM-65 AC1, AC2, AC3
   * Scenario: The Lead opens the queue while Submitted, assigned, draft and other-status rows exist.
   * Setup: Two Submitted unassigned requests from different organisations, plus a Submitted
   *         assigned row, a Draft with no Coordinator, and an Under Review row. Mixed rows
   *         prove membership is the AC rule, not "whatever the database returned".
   * Expected: Only the two Submitted unassigned requests. Assigned, Draft and Under Review are out.
   * Type: normal (AC1) + boundary (AC2, AC3 other statuses)
   */
  it('AC1/AC2/AC3: Lead sees every Submitted unassigned request and nothing else', async () => {
    const acmeQueued = queuedRow();
    const apexQueued = queuedRow({
      id: 12,
      organisation_id: 20,
      name: 'Apex Kickoff',
      organisation: { name: 'Apex' },
      organiser: { full_name: 'Ben Tan' },
    });
    const assigned = queuedRow({
      id: 13,
      name: 'Already Assigned',
      coordinator_id: 2,
      coordinator: { full_name: 'Chloe Lim' },
    });
    const draft = queuedRow({
      id: 14,
      name: 'Still a Draft',
      status: EVENT_STATUS.DRAFT,
    });
    const underReview = queuedRow({
      id: 15,
      name: 'In Review',
      status: EVENT_STATUS.UNDER_REVIEW,
      coordinator_id: 2,
    });
    db.fetchMany.mockResolvedValue([acmeQueued, assigned, draft, apexQueued, underReview]);

    const result = await service.listUnassignedQueue(lead);

    expect(query.eq).toHaveBeenCalledWith('status', EVENT_STATUS.SUBMITTED);
    expect(query.is).toHaveBeenCalledWith('coordinator_id', null);
    expect(result.map((event) => event.id)).toEqual([11, 12]);
    expect(result.every((event) => event.status === EVENT_STATUS.SUBMITTED)).toBe(true);
    expect(result.every((event) => event.coordinatorId == null)).toBe(true);
  });

  /*
   * AC: SCRUM-65 AC1
   * Scenario: The Lead opens the queue when nothing is waiting.
   * Setup: fetchMany returns an empty list.
   * Expected: Empty array, not an error — there can be a valid empty queue.
   * Type: boundary
   */
  it('AC1: an empty queue returns no events', async () => {
    db.fetchMany.mockResolvedValue([]);

    const result = await service.listUnassignedQueue(lead);

    expect(result).toEqual([]);
  });

  /*
   * AC: SCRUM-65 AC1
   * Scenario: A Coordinator (not the Lead) calls the Lead queue service.
   * Setup: Coordinator user; no database read should be needed after the role check.
   * Expected: 403. Who may open the page is SCRUM-54 AC3; this covers the new service guard.
   * Type: error
   */
  it('AC1: a Coordinator cannot list the Lead unassigned queue', async () => {
    await expect(service.listUnassignedQueue(coordinator)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(db.fetchMany).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-65 AC4
   * Scenario: The Lead reads the columns they need before choosing a Coordinator.
   * Setup: One complete Submitted unassigned request, including venue and equipment text.
   * Expected: name, organiser, start/end, expected attendance, venue needs and equipment needs.
   * Type: normal
   */
  it('AC4: each queued request includes name, organiser, date/time, attendance, venue and equipment', async () => {
    db.fetchMany.mockResolvedValue([queuedRow()]);

    const [event] = await service.listUnassignedQueue(lead);

    expect(event.name).toBe('Town Hall');
    expect(event.organiserName).toBe('Aisha Rahman');
    expect(event.startAt).toBe('2026-10-01T10:00:00Z');
    expect(event.endAt).toBe('2026-10-01T11:00:00Z');
    expect(event.expectedAttendance).toBe(50);
    expect(event.venueRequirements).toBe('Projector and stage');
    expect(event.equipmentNotes).toBe('Two wireless mics');
  });

  /*
   * AC: SCRUM-65 AC4
   * Scenario: Equipment notes were left blank on an otherwise complete submitted request.
   * Setup: equipment_notes is null (venue needs are still present; they are compulsory on submit).
   * Expected: The request stays in the queue and equipmentNotes is null so the UI can show an em dash.
   * Type: boundary
   */
  it('AC4: a queued request with no equipment notes still returns the equipment field', async () => {
    db.fetchMany.mockResolvedValue([queuedRow({ equipment_notes: null })]);

    const [event] = await service.listUnassignedQueue(lead);

    expect(event.id).toBe(11);
    expect(event.equipmentNotes).toBeNull();
    expect(event.venueRequirements).toBe('Projector and stage');
  });
});

describe('SCRUM-65 getEvent for a queued request (service)', () => {
  /*
   * AC: SCRUM-65 AC5
   * Scenario: The Lead opens a request that is in the unassigned queue.
   * Setup: Submitted, coordinator_id null, full request fields on the row.
   * Expected: Planning details are returned (description, purpose, people, venue/equipment), not the attendee subset.
   * Type: normal
   */
  it('AC5: the Lead can load full details of a queued request', async () => {
    db.fetchOne.mockResolvedValue(queuedRow());

    const event = await service.getEvent(lead, 11);

    expect(event.name).toBe('Town Hall');
    expect(event.description).toBe('All-hands meeting for the team.');
    expect(event.purpose).toBe('Quarterly update');
    expect(event.organiserName).toBe('Aisha Rahman');
    expect(event.coordinatorName).toBeNull();
    expect(event.startAt).toBe('2026-10-01T10:00:00Z');
    expect(event.expectedAttendance).toBe(50);
    expect(event.venueRequirements).toBe('Projector and stage');
    expect(event.equipmentNotes).toBe('Two wireless mics');
    expect(event.accessibilityNeeds).toBe('None');
  });

  /*
   * AC: SCRUM-65 AC5
   * Scenario: The Lead asks for an event id that does not exist.
   * Setup: fetchOne returns null.
   * Expected: 404 — there is no request to show details for.
   * Type: error
   */
  it('AC5: the Lead gets 404 when the queued request does not exist', async () => {
    db.fetchOne.mockResolvedValue(null);

    await expect(service.getEvent(lead, 999)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});

describe('SCRUM-65 GET /api/events/unassigned-queue and GET /api/events/:id (route)', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const leadToken = jwt.sign({ sub: 9 }, env.jwtSecret);
  const coordinatorToken = jwt.sign({ sub: 2 }, env.jwtSecret);

  /*
   * AC: SCRUM-65 AC1, AC4
   * Scenario: The Lead lists the queue over HTTP.
   * Setup: Session is a Lead; fetchMany returns one Submitted unassigned row after roles.
   * Expected: 200 with that event and the AC4 fields populated.
   * Type: normal
   */
  it('AC1/AC4: GET unassigned-queue returns queued requests with the Lead columns', async () => {
    db.fetchOne.mockResolvedValue({ id: 9, is_active: true, organisation_id: null });
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }])
      .mockResolvedValueOnce([queuedRow()]);

    const res = await request(app)
      .get('/api/events/unassigned-queue')
      .set('Cookie', `${env.sessionCookieName}=${leadToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toEqual(expect.objectContaining({
      name: 'Town Hall',
      organiserName: 'Aisha Rahman',
      startAt: '2026-10-01T10:00:00Z',
      endAt: '2026-10-01T11:00:00Z',
      expectedAttendance: 50,
      venueRequirements: 'Projector and stage',
      equipmentNotes: 'Two wireless mics',
      status: EVENT_STATUS.SUBMITTED,
      coordinatorId: null,
    }));
  });

  /*
   * AC: SCRUM-65 AC2, AC3
   * Scenario: Queue listing through the API while assigned and draft rows are also present.
   * Setup: Auth Lead; fetchMany returns Submitted unassigned, Submitted assigned, and Draft.
   * Expected: 200 with only the unassigned Submitted request.
   * Type: boundary
   */
  it('AC2/AC3: GET unassigned-queue excludes assigned requests and drafts', async () => {
    db.fetchOne.mockResolvedValue({ id: 9, is_active: true, organisation_id: null });
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }])
      .mockResolvedValueOnce([
        queuedRow(),
        queuedRow({ id: 13, coordinator_id: 2, name: 'Assigned' }),
        queuedRow({ id: 14, status: EVENT_STATUS.DRAFT, name: 'Draft' }),
      ]);

    const res = await request(app)
      .get('/api/events/unassigned-queue')
      .set('Cookie', `${env.sessionCookieName}=${leadToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events.map((event) => event.id)).toEqual([11]);
  });

  /*
   * AC: SCRUM-65 AC1
   * Scenario: Unauthenticated queue listing.
   * Setup: No session cookie.
   * Expected: 401, and the events table is not queried for the queue.
   * Type: error
   */
  it('AC1: GET unassigned-queue without a session is 401', async () => {
    const res = await request(app).get('/api/events/unassigned-queue');

    expect(res.status).toBe(401);
    expect(db.supabase.from).not.toHaveBeenCalledWith('events');
  });

  /*
   * AC: SCRUM-65 AC1
   * Scenario: A Coordinator calls the Lead queue route.
   * Setup: Session is EVENT_COORDINATOR.
   * Expected: 403 from requireRole. The full role matrix is SCRUM-54 AC3.
   * Type: error
   */
  it('AC1: GET unassigned-queue as a Coordinator is 403', async () => {
    db.fetchOne.mockResolvedValue({ id: 2, is_active: true, organisation_id: null });
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR }]);

    const res = await request(app)
      .get('/api/events/unassigned-queue')
      .set('Cookie', `${env.sessionCookieName}=${coordinatorToken}`);

    expect(res.status).toBe(403);
  });

  /*
   * AC: SCRUM-65 AC5
   * Scenario: The Lead opens a queued request over HTTP.
   * Setup: Auth Lead; fetchOne returns the user then the Submitted unassigned event.
   * Expected: 200 with full request details (description, people, venue/equipment).
   * Type: normal
   */
  it('AC5: GET event as Lead returns the full queued request', async () => {
    db.fetchOne
      .mockResolvedValueOnce({ id: 9, is_active: true, organisation_id: null, full_name: 'Ivy Chen' })
      .mockResolvedValueOnce(queuedRow());
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_COORDINATOR_LEAD }]);

    const res = await request(app)
      .get('/api/events/11')
      .set('Cookie', `${env.sessionCookieName}=${leadToken}`);

    expect(res.status).toBe(200);
    expect(res.body.event).toEqual(expect.objectContaining({
      name: 'Town Hall',
      description: 'All-hands meeting for the team.',
      purpose: 'Quarterly update',
      organiserName: 'Aisha Rahman',
      expectedAttendance: 50,
      venueRequirements: 'Projector and stage',
      equipmentNotes: 'Two wireless mics',
      coordinatorId: null,
    }));
  });
});

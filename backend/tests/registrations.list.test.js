/**
 * SCRUM-74: the Organiser or assigned Coordinator views who has registered for their event,
 * with the active count against capacity. Everyone else only ever sees their own registration.
 *
 * Labels:
 *   US74-B..  service rules (registrationsService.listForEvent)
 *   US74-R..  HTTP route (auth cookie + service)
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  fetchCount: jest.fn(),
  updateById: jest.fn(),
  insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));

const db = require('../src/config/db');
const service = require('../src/services/registrations.service');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

const organiser = { id: 1, roles: [ROLES.EVENT_ORGANISER] };
const otherOrganiser = { id: 99, roles: [ROLES.EVENT_ORGANISER] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const otherCoordinator = { id: 98, roles: [ROLES.EVENT_COORDINATOR] };
const attendee = { id: 30, roles: [ROLES.ATTENDEE] };

let event;
let builder;

function withEvent(overrides = {}) {
  return {
    id: 3,
    name: 'Leadership Forum',
    organiser_id: 1,
    coordinator_id: 2,
    registration_capacity: 50,
    ...overrides,
  };
}

function registrationRow(overrides = {}) {
  return {
    id: 10,
    event_id: 3,
    attendee_id: 30,
    status: 'REGISTERED',
    attendee: { full_name: 'Hari Patel', email: 'attendee@example.com' },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  event = withEvent();
  builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };
  db.supabase.from.mockReturnValue(builder);
  db.fetchOne.mockImplementation(async () => event);
  db.fetchMany.mockResolvedValue([]);
  db.fetchCount.mockResolvedValue(0);
});

describe('SCRUM-74 list registrations (service rules)', () => {
  /*
   * AC: SCRUM-74 AC1, AC3
   * Scenario: The event's own Organiser lists registrations; 2 active, 1 withdrawn, capacity 50.
   * Expected: every row returned with the attendee's name/email, activeCount 2 (withdrawn not
   *   counted), capacity 50.
   * Type: normal
   */
  // SCRUM-74-TC01
  it('US74-B01: the Organiser sees every registration plus the active count against capacity', async () => {
    db.fetchMany.mockResolvedValueOnce([
      registrationRow({ id: 10, status: 'REGISTERED' }),
      registrationRow({ id: 11, attendee_id: 31, status: 'REGISTERED', attendee: { full_name: 'Ben Tan', email: 'ben@example.com' } }),
      registrationRow({ id: 12, attendee_id: 32, status: 'WITHDRAWN', attendee: { full_name: 'Aisha Rahman', email: 'aisha@example.com' } }),
    ]);
    db.fetchCount.mockResolvedValueOnce(2);

    const result = await service.listForEvent(organiser, 3);

    expect(result.registrations).toHaveLength(3);
    expect(result.registrations[0]).toMatchObject({ attendee_name: 'Hari Patel', attendee_email: 'attendee@example.com' });
    expect(result.activeCount).toBe(2);
    expect(result.capacity).toBe(50);
  });

  /*
   * AC: SCRUM-74 AC2
   * Scenario: The event's assigned Coordinator (not its Organiser) lists registrations.
   * Expected: same view as the Organiser gets.
   * Type: normal
   */
  // SCRUM-74-TC02
  it('US74-B02: the assigned Coordinator sees the same registrations as the Organiser', async () => {
    db.fetchMany.mockResolvedValueOnce([registrationRow()]);
    db.fetchCount.mockResolvedValueOnce(1);

    const result = await service.listForEvent(coordinator, 3);

    expect(result.registrations).toHaveLength(1);
    expect(result.activeCount).toBe(1);
  });

  /*
   * AC: SCRUM-74 AC4
   * Scenario: A Confirmed event with no registrations at all.
   * Expected: an empty list and activeCount 0, not an error.
   * Type: boundary
   */
  // SCRUM-74-TC03
  it('US74-B03: an event with no registrations shows a count of zero', async () => {
    db.fetchMany.mockResolvedValueOnce([]);
    db.fetchCount.mockResolvedValueOnce(0);

    const result = await service.listForEvent(organiser, 3);

    expect(result.registrations).toEqual([]);
    expect(result.activeCount).toBe(0);
  });

  /*
   * Scenario: registration was never enabled for this event (SCRUM-63), so
   *   registration_capacity is null in the database.
   * Expected: capacity comes back null, not 0 — "no cap set" is not the same as "cap is zero".
   * Type: boundary
   */
  // SCRUM-74-TC04
  it('US74-B03b: capacity is null, not zero, when registration was never enabled', async () => {
    event = withEvent({ registration_capacity: null });
    db.fetchMany.mockResolvedValueOnce([]);
    db.fetchCount.mockResolvedValueOnce(0);

    const result = await service.listForEvent(organiser, 3);

    expect(result.capacity).toBeNull();
  });

  /*
   * AC: SCRUM-74 AC5
   * Scenario: An Organiser who does not own this event tries to list its registrations.
   * Expected: rejected with 403; no registration rows are fetched at all.
   * Type: error
   */
  // SCRUM-74-TC05
  it('US74-B04: an Organiser who does not manage this event is rejected', async () => {
    await expect(service.listForEvent(otherOrganiser, 3)).rejects.toMatchObject({ status: 403 });
    expect(db.fetchMany).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-74 AC5
   * Scenario: A Coordinator who is not this event's assigned Coordinator tries to list it.
   * Expected: rejected with 403, same as an unrelated Organiser.
   * Type: error
   */
  // SCRUM-74-TC06
  it('US74-B05: a Coordinator who is not assigned to this event is rejected', async () => {
    await expect(service.listForEvent(otherCoordinator, 3)).rejects.toMatchObject({ status: 403 });
  });

  /*
   * AC: SCRUM-74 AC6
   * Scenario: An Attendee lists "registrations" for an event they registered for.
   * Expected: only their own registration comes back, scoped by attendee_id, with no
   *   activeCount/capacity summary (that belongs to the event's manager only).
   * Type: normal
   */
  // SCRUM-74-TC07
  it('US74-B06: an Attendee only ever sees their own registration, never a summary', async () => {
    db.fetchMany.mockResolvedValueOnce([registrationRow({ attendee: undefined })]);

    const result = await service.listForEvent(attendee, 3);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    const call = builder.eq.mock.calls.find((args) => args[0] === 'attendee_id');
    expect(call).toEqual(['attendee_id', 30]);
  });

  // SCRUM-74-TC08
  it('US74-B07: a missing event is 404', async () => {
    db.fetchOne.mockResolvedValueOnce(null);
    await expect(service.listForEvent(organiser, 999)).rejects.toMatchObject({ status: 404 });
  });
});

describe('SCRUM-74 list registrations route', () => {
  const { createApp } = require('../src/app');
  const app = createApp();

  function cookieFor(userId) {
    const token = jwt.sign({ sub: userId }, env.jwtSecret);
    return `${env.sessionCookieName}=${token}`;
  }

  /*
   * AC: SCRUM-74 AC1
   * Scenario: The Organiser asks for registrations through the real HTTP route.
   * Expected: 200 with registrations, activeCount and capacity in the body.
   * Type: normal
   */
  // SCRUM-74-TC09
  it('US74-R01: the Organiser reads registrations through the API', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 1, is_active: true }); // auth: the signed-in user
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_ORGANISER }]); // auth: their roles
    db.fetchOne.mockResolvedValueOnce(event); // service: the event
    db.fetchMany.mockResolvedValueOnce([registrationRow()]); // service: the registrations
    db.fetchCount.mockResolvedValueOnce(1);

    const res = await request(app)
      .get('/api/events/3/registrations')
      .set('Cookie', cookieFor(1));

    expect(res.status).toBe(200);
    expect(res.body.activeCount).toBe(1);
    expect(res.body.capacity).toBe(50);
  });

  /*
   * AC: SCRUM-74 AC5
   * Scenario: An unrelated Organiser hits the real route for an event they don't own.
   * Expected: 403, through the real middleware and service.
   * Type: error
   */
  // SCRUM-74-TC10
  it('US74-R02: an unrelated Organiser gets 403 through the API', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 99, is_active: true }); // auth: the signed-in user
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_ORGANISER }]); // auth: their roles
    db.fetchOne.mockResolvedValueOnce(event); // service: the event

    const res = await request(app)
      .get('/api/events/3/registrations')
      .set('Cookie', cookieFor(99));

    expect(res.status).toBe(403);
  });

  // SCRUM-74-TC11
  it('US74-R03: the route needs a signed-in user', async () => {
    const res = await request(app).get('/api/events/3/registrations');
    expect(res.status).toBe(401);
  });
});

/**
 * SCRUM-52: an Attendee registers for a Confirmed event while its registration window is open.
 *
 * Labels:
 *   US52-B..  service rules (registrationsService.register)
 *   US52-R..  HTTP route (auth cookie + service)
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

const attendee = { id: 30, roles: [ROLES.ATTENDEE] };

const NOW = new Date('2026-11-05T09:00:00.000Z');
const OPENS = '2026-11-01T09:00:00.000Z';
const CLOSES = '2026-11-08T09:00:00.000Z';
const STARTS = '2026-11-12T09:00:00.000Z';

let event;
let builder;

function openEvent(overrides = {}) {
  return {
    id: 3,
    organiser_id: 1,
    coordinator_id: 2,
    status: 'CONFIRMED',
    registration_required: true,
    registration_open: true,
    registration_opens_at: OPENS,
    registration_closes_at: CLOSES,
    registration_capacity: 50,
    start_at: STARTS,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(NOW);
  event = openEvent();
  builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };
  db.supabase.from.mockReturnValue(builder);
  db.fetchOne.mockImplementation(async () => event);
  db.fetchMany.mockResolvedValue([]);
  db.fetchCount.mockResolvedValue(0);
  db.insertOne.mockImplementation(async (_table, row) => ({ id: 99, ...row }));
});

afterEach(() => {
  jest.useRealTimers();
});

/** Shared check for every "refused" test: an error AND no registration written. */
async function expectRefused(promise, status, code) {
  await expect(promise).rejects.toMatchObject({ status, code });
  expect(db.insertOne).not.toHaveBeenCalled();
}

describe('SCRUM-52 register for an event (service rules)', () => {
  /*
   * AC: SCRUM-52 AC1
   * Scenario: An Attendee registers for a Confirmed event inside its open window.
   * Expected: One REGISTERED row for that Attendee and event, with no waitlist position.
   * Type: normal
   */
  it('US52-B01: an Attendee registers for a Confirmed event with registration open', async () => {
    const result = await service.register(attendee, 3);

    expect(db.insertOne).toHaveBeenCalledTimes(1);
    expect(db.insertOne).toHaveBeenCalledWith('registrations', {
      event_id: 3,
      attendee_id: 30,
      status: 'REGISTERED',
      waitlist_position: null,
    });
    expect(result.registration).toMatchObject({ id: 99, status: 'REGISTERED' });
  });

  /*
   * AC: SCRUM-52 AC2
   * Scenario: Capacity 50 with 0, 10 and 49 places already taken.
   * Expected: Places left after registering drops by one each time: 49, 39, 0.
   * Type: normal / boundary (last place)
   */
  it.each([
    [0, 49],
    [10, 39],
    [49, 0],
  ])('US52-B02: with %i places taken, registering leaves %i places', async (taken, left) => {
    db.fetchCount.mockResolvedValue(taken);
    const result = await service.register(attendee, 3);
    expect(result.placesLeft).toBe(left);
    expect(db.insertOne).toHaveBeenCalledTimes(1);
  });

  /*
   * AC: SCRUM-52 AC2, AC4
   * Scenario: Places taken are counted the same way as SCRUM-63: every registration not withdrawn.
   * Expected: The count query excludes WITHDRAWN for this event.
   * Type: normal
   */
  it('US52-B03: withdrawn registrations do not take up a place', async () => {
    await service.register(attendee, 3);
    expect(builder.eq).toHaveBeenCalledWith('event_id', 3);
    expect(builder.neq).toHaveBeenCalledWith('status', 'WITHDRAWN');
    expect(db.fetchCount).toHaveBeenCalledTimes(1);
  });

  /*
   * AC: SCRUM-52 AC3
   * Scenario: Every status other than Confirmed, including Draft and Cancelled.
   * Expected: 409 NOT_OPEN and nothing written.
   * Type: error
   */
  it.each([
    'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PLANNING',
    'AWAITING_SAFETY_CHECK', 'PREPARATION', 'COMPLETED', 'CANCELLED', 'REJECTED',
  ])('US52-B04: registration is refused when the event is %s', async (status) => {
    event = openEvent({ status });
    await expectRefused(service.register(attendee, 3), 409, 'NOT_OPEN');
  });

  /*
   * AC: SCRUM-52 AC3
   * Scenario: The event is Confirmed but the Coordinator has not enabled registration (SCRUM-63).
   * Expected: 409 NOT_OPEN and nothing written.
   * Type: error
   */
  it('US52-B05: registration is refused when it has not been enabled', async () => {
    event = openEvent({ registration_open: false, registration_opens_at: null, registration_closes_at: null });
    await expectRefused(service.register(attendee, 3), 409, 'NOT_OPEN');
  });

  /*
   * AC: SCRUM-52 AC3
   * Scenario: Before the window opens, exactly when it opens, just before and exactly when it closes, after.
   * Expected: Before the open time is refused; from the open time up to (not including) the close time is allowed.
   * Type: boundary
   */
  it('US52-B06: registration is refused before the window opens', async () => {
    jest.setSystemTime(new Date('2026-11-01T08:59:59.999Z'));
    await expectRefused(service.register(attendee, 3), 409, 'NOT_YET_OPEN');
  });

  it('US52-B07: registration is allowed exactly when the window opens', async () => {
    jest.setSystemTime(new Date(OPENS));
    await service.register(attendee, 3);
    expect(db.insertOne).toHaveBeenCalledTimes(1);
  });

  it('US52-B08: registration is allowed one millisecond before the window closes', async () => {
    jest.setSystemTime(new Date('2026-11-08T08:59:59.999Z'));
    await service.register(attendee, 3);
    expect(db.insertOne).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['exactly at the close time', CLOSES],
    ['after the close time', '2026-11-09T09:00:00.000Z'],
  ])('US52-B09: registration is refused %s', async (_label, at) => {
    jest.setSystemTime(new Date(at));
    await expectRefused(service.register(attendee, 3), 409, 'REGISTRATION_CLOSED');
  });

  /*
   * AC: SCRUM-52 AC4
   * Scenario: Every place is taken (taken equals capacity), or more are taken than capacity.
   * Expected: 409 EVENT_FULL and nothing written. A full event does not waitlist (hard cap).
   * Type: boundary / error
   */
  it.each([50, 51])('US52-B10: registration is refused when %i of 50 places are taken', async (taken) => {
    db.fetchCount.mockResolvedValue(taken);
    await expectRefused(service.register(attendee, 3), 409, 'EVENT_FULL');
  });

  /*
   * AC: SCRUM-52 AC5
   * Scenario: The Attendee already has an active registration for this event.
   * Expected: 409 ALREADY_REGISTERED and nothing written, even if the event is also full.
   * Type: error
   */
  it('US52-B11: a second active registration for the same event is refused', async () => {
    db.fetchMany.mockResolvedValue([{ id: 5, status: 'REGISTERED' }]);
    db.fetchCount.mockResolvedValue(50);
    await expectRefused(service.register(attendee, 3), 409, 'ALREADY_REGISTERED');
  });

  /*
   * AC: SCRUM-52 AC5
   * Scenario: The duplicate check only looks at this Attendee's active registrations for this event.
   * Expected: The query filters by event, attendee and not WITHDRAWN, so a withdrawn Attendee can register again.
   * Type: normal
   */
  it('US52-B12: an Attendee who withdrew can register again', async () => {
    await service.register(attendee, 3);
    expect(builder.eq).toHaveBeenCalledWith('attendee_id', 30);
    expect(builder.neq).toHaveBeenCalledWith('status', 'WITHDRAWN');
    expect(db.insertOne).toHaveBeenCalledTimes(1);
  });

  /*
   * AC: SCRUM-52 user story ("As an Attendee")
   * Scenario: Users without the Attendee role try to register.
   * Expected: 403 FORBIDDEN and nothing written.
   * Type: error
   */
  it.each([
    ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR,
  ])('US52-B13: a user with only the %s role cannot register', async (role) => {
    await expectRefused(service.register({ id: 8, roles: [role] }, 3), 403, 'FORBIDDEN');
  });

  /*
   * AC: SCRUM-52 user story ("As an Attendee")
   * Scenario: A user who is an Attendee and also has another role.
   * Expected: Allowed, because they hold the Attendee role.
   * Type: normal
   */
  it('US52-B15: a user with the Attendee role plus another role can register', async () => {
    await service.register({ id: 31, roles: [ROLES.ATTENDEE, ROLES.EVENT_ORGANISER] }, 3);
    expect(db.insertOne).toHaveBeenCalledTimes(1);
  });

  /*
   * AC: SCRUM-52 AC4
   * Scenario: Bad data: registration is open but no capacity is stored (SCRUM-63 always sets one).
   * Expected: Treated as no places (409 EVENT_FULL) rather than unlimited.
   * Type: error
   */
  it('US52-B16: an open event with no stored capacity takes no registrations', async () => {
    event = openEvent({ registration_capacity: null });
    await expectRefused(service.register(attendee, 3), 409, 'EVENT_FULL');
  });

  /*
   * AC: SCRUM-52 AC3
   * Scenario: After registration opened, the start was moved earlier (an edit or an approved
   *   change request) so the event has started while the window is still open.
   * Expected: Refused from the start time onwards with 409 EVENT_STARTED; allowed just before it.
   * Type: boundary / error
   */
  it.each([
    ['exactly at the new start time', '2026-11-05T09:00:00.000Z'],
    ['after the new start time', '2026-11-05T08:00:00.000Z'],
  ])('US52-B17: registration is refused %s, even with the window open', async (_label, startAt) => {
    event = openEvent({ start_at: startAt });
    await expectRefused(service.register(attendee, 3), 409, 'EVENT_STARTED');
  });

  it('US52-B18: registration is allowed one millisecond before the event starts', async () => {
    event = openEvent({ start_at: '2026-11-05T09:00:00.001Z' });
    await service.register(attendee, 3);
    expect(db.insertOne).toHaveBeenCalledTimes(1);
  });

  it('US52-B19: an event with no start date is not treated as started', async () => {
    event = openEvent({ start_at: null });
    await service.register(attendee, 3);
    expect(db.insertOne).toHaveBeenCalledTimes(1);
  });

  it('US52-B14: registering for an event that does not exist returns 404', async () => {
    event = null;
    await expectRefused(service.register(attendee, 3), 404, 'NOT_FOUND');
  });
});

describe('SCRUM-52 register route', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const token = jwt.sign({ sub: 30 }, env.jwtSecret);

  function signedInAs(role) {
    db.fetchOne.mockResolvedValueOnce({ id: 30, is_active: true });
    db.fetchMany.mockResolvedValueOnce([{ role }]);
  }

  /*
   * AC: SCRUM-52 AC1, AC2
   * Scenario: An Attendee registers through the real HTTP route.
   * Expected: 201 with the registration and the places left.
   * Type: normal
   */
  it('US52-R01: an Attendee can register through the API', async () => {
    signedInAs(ROLES.ATTENDEE);
    db.fetchCount.mockResolvedValue(10);
    const res = await request(app)
      .post('/api/events/3/registrations')
      .set('Cookie', `${env.sessionCookieName}=${token}`);

    expect(res.status).toBe(201);
    expect(res.body.registration).toMatchObject({ status: 'REGISTERED' });
    expect(res.body.placesLeft).toBe(39);
  });

  it('US52-R02: the register route needs a signed-in user', async () => {
    const res = await request(app).post('/api/events/3/registrations');
    expect(res.status).toBe(401);
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-52 AC4
   * Scenario: The event is full when registering through the API.
   * Expected: 409 with the EVENT_FULL code and message; nothing written.
   * Type: error
   */
  it('US52-R03: a refused registration returns the error code and writes nothing', async () => {
    signedInAs(ROLES.ATTENDEE);
    db.fetchCount.mockResolvedValue(50);
    const res = await request(app)
      .post('/api/events/3/registrations')
      .set('Cookie', `${env.sessionCookieName}=${token}`);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'EVENT_FULL', message: 'This event is full' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });
});

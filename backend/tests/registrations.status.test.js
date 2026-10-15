/**
 * SCRUM-51: an Attendee views an event's registration information and their own registration status.
 *
 * Labels:
 *   US51-B..  service rules (registrationsService.getRegistrationStatus / registrationState)
 *   US51-R..  HTTP route (auth cookie + service)
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

let event;
let builder;

function openEvent(overrides = {}) {
  return {
    id: 3,
    name: 'Leadership Forum',
    organiser_id: 1,
    coordinator_id: 2,
    status: 'CONFIRMED',
    start_at: '2026-11-12T09:00:00.000Z',
    end_at: '2026-11-12T13:00:00.000Z',
    registration_required: true,
    registration_open: true,
    registration_opens_at: OPENS,
    registration_closes_at: CLOSES,
    registration_capacity: 50,
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
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };
  db.supabase.from.mockReturnValue(builder);
  db.fetchOne.mockImplementation(async () => event);
  db.fetchMany.mockResolvedValue([]);
  db.fetchCount.mockResolvedValue(10);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('SCRUM-51 registration status (service rules)', () => {
  /*
   * AC: SCRUM-51 AC1, AC2
   * Scenario: An Attendee who has not registered opens an event with registration open (10 of 50 taken).
   * Expected: state OPEN, the window, capacity 50, 40 places left, and no registration of their own.
   * Type: normal
   */
  it('US51-B01: shows an open event with its window, places left and "not registered"', async () => {
    const result = await service.getRegistrationStatus(attendee, 3);
    expect(result).toEqual({
      state: 'OPEN',
      opensAt: OPENS,
      closesAt: CLOSES,
      capacity: 50,
      placesLeft: 40,
      myRegistration: null,
    });
    expect(db.supabase.from).not.toHaveBeenCalledWith('venue_bookings');
  });

  /*
   * AC: SCRUM-51 AC2
   * Scenario: The Attendee's latest registration is Registered, Withdrawn or Attended.
   * Expected: their status is returned with when they registered (and withdrew).
   * Type: normal
   */
  it('US51-B02: shows the Attendee as registered, with when they registered', async () => {
    db.fetchMany.mockResolvedValue([{ status: 'REGISTERED', created_at: '2026-11-02T10:00:00.000Z', withdrawn_at: null }]);
    const result = await service.getRegistrationStatus(attendee, 3);
    expect(result.myRegistration).toEqual({
      status: 'REGISTERED', registeredAt: '2026-11-02T10:00:00.000Z', withdrawnAt: null,
    });
  });

  it('US51-B03: shows the Attendee as withdrawn, with when they withdrew', async () => {
    db.fetchMany.mockResolvedValue([{
      status: 'WITHDRAWN', created_at: '2026-11-02T10:00:00.000Z', withdrawn_at: '2026-11-03T10:00:00.000Z',
    }]);
    const result = await service.getRegistrationStatus(attendee, 3);
    expect(result.myRegistration).toEqual({
      status: 'WITHDRAWN', registeredAt: '2026-11-02T10:00:00.000Z', withdrawnAt: '2026-11-03T10:00:00.000Z',
    });
  });

  it('US51-B04: shows statuses set after the event, such as Attended', async () => {
    db.fetchMany.mockResolvedValue([{ status: 'ATTENDED', created_at: '2026-11-02T10:00:00.000Z' }]);
    const result = await service.getRegistrationStatus(attendee, 3);
    expect(result.myRegistration).toMatchObject({ status: 'ATTENDED', withdrawnAt: null });
  });

  /*
   * AC: SCRUM-51 AC2
   * Scenario: Only the caller's own, most recent registration is used.
   * Expected: the query filters by this event and this Attendee, newest first, one row.
   * Type: normal
   */
  it('US51-B05: looks up only the caller\'s own latest registration', async () => {
    await service.getRegistrationStatus(attendee, 3);
    expect(builder.eq).toHaveBeenCalledWith('event_id', 3);
    expect(builder.eq).toHaveBeenCalledWith('attendee_id', 30);
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(1);
  });

  /*
   * AC: SCRUM-51 AC1
   * Scenario: Before the window, exactly at the close time, and when every place is taken (or more).
   * Expected: NOT_YET_OPEN, CLOSED, FULL; places left never goes below 0.
   * Type: boundary
   */
  it('US51-B06: shows "not yet open" before the window opens', async () => {
    jest.setSystemTime(new Date('2026-11-01T08:59:59.999Z'));
    expect((await service.getRegistrationStatus(attendee, 3)).state).toBe('NOT_YET_OPEN');
  });

  it('US51-B07: shows "closed" from the close time on', async () => {
    jest.setSystemTime(new Date(CLOSES));
    expect((await service.getRegistrationStatus(attendee, 3)).state).toBe('CLOSED');
  });

  it.each([[50, 0], [51, 0]])('US51-B08: with %i of 50 taken it shows "full" and %i places left', async (taken, left) => {
    db.fetchCount.mockResolvedValue(taken);
    const result = await service.getRegistrationStatus(attendee, 3);
    expect(result.state).toBe('FULL');
    expect(result.placesLeft).toBe(left);
  });

  /*
   * AC: SCRUM-51 AC1
   * Scenario: The event takes registrations but the Coordinator has not enabled it yet (SCRUM-63).
   * Expected: NOT_OPEN with no window, capacity or places; places are not counted.
   * Type: normal
   */
  it('US51-B09: shows "not open" with no details before registration is enabled', async () => {
    event = openEvent({ registration_open: false, registration_opens_at: null, registration_closes_at: null, registration_capacity: null });
    const result = await service.getRegistrationStatus(attendee, 3);
    expect(result).toMatchObject({ state: 'NOT_OPEN', opensAt: null, closesAt: null, capacity: null, placesLeft: null });
    expect(db.fetchCount).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-51 AC1
   * Scenario: An Attendee asks about an event they are not allowed to see (not Confirmed).
   * Expected: 404, the same as opening the event page; no registrations are read.
   * Type: error
   */
  it('US51-B10: an event the Attendee cannot see returns 404', async () => {
    event = openEvent({ status: 'PLANNING' });
    await expect(service.getRegistrationStatus(attendee, 3)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(db.fetchMany).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-51 AC1
   * Scenario: registrationState for every status other than Confirmed, even with registration on.
   * Expected: NOT_OPEN, matching what register() refuses.
   * Type: error
   */
  it.each([
    'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PLANNING',
    'AWAITING_SAFETY_CHECK', 'PREPARATION', 'COMPLETED', 'CANCELLED', 'REJECTED',
  ])('US51-B11: an event that is %s counts as not open', (status) => {
    expect(service.registrationState(openEvent({ status }), 0, NOW)).toBe('NOT_OPEN');
  });
});

describe('SCRUM-51 registration status route', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const token = jwt.sign({ sub: 30 }, env.jwtSecret);

  /*
   * AC: SCRUM-51 AC1, AC2
   * Scenario: An Attendee asks for the registration status through the real HTTP route.
   * Expected: 200 with the status.
   * Type: normal
   */
  it('US51-R01: an Attendee can read the registration status through the API', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 30, is_active: true });
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.ATTENDEE }]);
    const res = await request(app)
      .get('/api/events/3/registration-status')
      .set('Cookie', `${env.sessionCookieName}=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.registrationStatus).toMatchObject({ state: 'OPEN', placesLeft: 40, myRegistration: null });
  });

  it('US51-R02: the route needs a signed-in user', async () => {
    const res = await request(app).get('/api/events/3/registration-status');
    expect(res.status).toBe(401);
  });
});

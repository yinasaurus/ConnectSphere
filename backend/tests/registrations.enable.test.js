/**
 * SCRUM-63: the assigned Coordinator enables registration for a Confirmed event with a
 * registration window and a maximum capacity, and can later extend it or change capacity.
 *
 * Labels:
 *   US63-B..  service rules (enableRegistration / changeRegistrationSettings)
 *   US63-R..  HTTP routes (auth cookie + Coordinator role + service)
 *   US63-E..  the general event edit cannot bypass these rules
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
const audit = require('../src/services/audit.service');
const service = require('../src/services/registrationSettings.service');
const eventsService = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

const assigned = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const otherCoordinator = { id: 7, roles: [ROLES.EVENT_COORDINATOR] };
const attendee = { id: 30, roles: [ROLES.ATTENDEE] };
const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };

const OPENS = '2026-11-01T09:00:00.000Z';
const CLOSES = '2026-11-08T09:00:00.000Z';
const valid = () => ({ opensAt: OPENS, closesAt: CLOSES, capacity: 50 });

let event;

function confirmedEvent(overrides = {}) {
  return {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    status: 'CONFIRMED',
    registration_required: true,
    registration_open: false,
    registration_opens_at: null,
    registration_closes_at: null,
    registration_capacity: null,
    ...overrides,
  };
}

function enabledEvent(overrides = {}) {
  return confirmedEvent({
    registration_open: true,
    registration_opens_at: OPENS,
    registration_closes_at: CLOSES,
    registration_capacity: 50,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  event = confirmedEvent();
  const builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
  };
  db.supabase.from.mockReturnValue(builder);
  db.fetchOne.mockImplementation(async () => event);
  db.fetchCount.mockResolvedValue(0);
  db.updateById.mockImplementation(async (_table, _id, patch) => {
    Object.assign(event, patch);
    return event;
  });
});

/** Shared check for every "rejected" test: an error AND nothing written. */
async function expectRejected(promise, status, code) {
  await expect(promise).rejects.toMatchObject({ status, code });
  expect(db.updateById).not.toHaveBeenCalled();
  expect(audit.writeAudit).not.toHaveBeenCalled();
}

describe('SCRUM-63 enable registration (service rules)', () => {
  /*
   * AC: SCRUM-63 AC1, AC2
   * Scenario: The assigned Coordinator enables registration on a Confirmed event with all three values.
   * Expected: The event is written as open with exactly the window and capacity given, and audited.
   * Type: normal
   */
  it('US63-B01: the assigned Coordinator enables registration with a window and capacity', async () => {
    const result = await service.enableRegistration(assigned, 3, valid());

    expect(db.updateById).toHaveBeenCalledTimes(1);
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      registration_required: true,
      registration_open: true,
      registration_opens_at: OPENS,
      registration_closes_at: CLOSES,
      registration_capacity: 50,
    }));
    expect(result).toEqual({
      eventId: 3,
      registrationOpen: true,
      registrationOpensAt: OPENS,
      registrationClosesAt: CLOSES,
      registrationCapacity: 50,
    });
    expect(audit.writeAudit).toHaveBeenCalledWith(2, 'REGISTRATION_ENABLED', 'event', 3, {
      opensAt: OPENS,
      closesAt: CLOSES,
      capacity: 50,
    });
  });

  /*
   * AC: SCRUM-63 AC1
   * Scenario: Every status other than Confirmed.
   * Expected: 409 NOT_CONFIRMED and nothing written.
   * Type: error
   */
  it.each([
    'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PLANNING',
    'AWAITING_SAFETY_CHECK', 'PREPARATION', 'COMPLETED', 'CANCELLED', 'REJECTED',
  ])('US63-B02: enabling is rejected when the event is %s', async (status) => {
    event = confirmedEvent({ status });
    await expectRejected(service.enableRegistration(assigned, 3, valid()), 409, 'NOT_CONFIRMED');
    expect(event.registration_open).toBe(false);
  });

  /*
   * AC: SCRUM-63 AC2
   * Scenario: One of open, close or capacity is missing.
   * Expected: 400 MISSING_SETTINGS naming the missing value; registration is not enabled.
   * Type: error
   */
  it.each([
    ['opensAt', 'open date and time'],
    ['closesAt', 'close date and time'],
    ['capacity', 'maximum capacity'],
  ])('US63-B03: enabling is rejected when %s is missing', async (field, label) => {
    const body = valid();
    delete body[field];
    await expect(service.enableRegistration(assigned, 3, body)).rejects.toMatchObject({
      status: 400,
      code: 'MISSING_SETTINGS',
      message: expect.stringContaining(label),
    });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(event.registration_open).toBe(false);
  });

  /*
   * AC: SCRUM-63 AC2
   * Scenario: A value is sent but empty (blank form field).
   * Expected: treated as missing.
   * Type: boundary
   */
  it('US63-B04: an empty capacity counts as missing', async () => {
    await expectRejected(
      service.enableRegistration(assigned, 3, { ...valid(), capacity: '' }),
      400,
      'MISSING_SETTINGS'
    );
  });

  /*
   * AC: SCRUM-63 AC3
   * Scenario: Close equal to open, or before open.
   * Expected: 400 INVALID_WINDOW.
   * Type: boundary / error
   */
  it('US63-B05: a close time equal to the open time is rejected', async () => {
    await expectRejected(
      service.enableRegistration(assigned, 3, { ...valid(), closesAt: OPENS }),
      400,
      'INVALID_WINDOW'
    );
  });

  it('US63-B06: a close time before the open time is rejected', async () => {
    await expectRejected(
      service.enableRegistration(assigned, 3, { ...valid(), closesAt: '2026-10-31T09:00:00.000Z' }),
      400,
      'INVALID_WINDOW'
    );
  });

  /*
   * AC: SCRUM-63 AC3
   * Scenario: Close is one minute after open, the smallest valid window.
   * Expected: accepted.
   * Type: boundary
   */
  it('US63-B07: a close time one minute after the open time is accepted', async () => {
    const closesAt = '2026-11-01T09:01:00.000Z';
    await service.enableRegistration(assigned, 3, { ...valid(), closesAt });
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      registration_closes_at: closesAt,
    }));
  });

  /*
   * AC: SCRUM-63 AC3
   * Scenario: A date that is not a real date.
   * Expected: 400 INVALID_DATE.
   * Type: error
   */
  it('US63-B08: an open time that is not a date is rejected', async () => {
    await expectRejected(
      service.enableRegistration(assigned, 3, { ...valid(), opensAt: 'next week' }),
      400,
      'INVALID_DATE'
    );
  });

  /*
   * AC: SCRUM-63 AC4
   * Scenario: Capacity is 0, negative, a decimal or text.
   * Expected: 400 INVALID_CAPACITY.
   * Type: boundary / error
   */
  it.each([0, -1, 2.5, 'abc'])('US63-B09: a capacity of %p is rejected', async (capacity) => {
    await expectRejected(
      service.enableRegistration(assigned, 3, { ...valid(), capacity }),
      400,
      'INVALID_CAPACITY'
    );
  });

  /*
   * AC: SCRUM-63 AC4
   * Scenario: Capacity is 1 (smallest allowed), and a numeric string from a form.
   * Expected: accepted and stored as a number.
   * Type: boundary
   */
  it.each([1, '1'])('US63-B10: a capacity of %p is accepted', async (capacity) => {
    await service.enableRegistration(assigned, 3, { ...valid(), capacity });
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      registration_capacity: 1,
    }));
  });

  /*
   * AC: SCRUM-63 AC6
   * Scenario: Registrations already exist and the capacity given is below them.
   * Expected: 409 CAPACITY_BELOW_REGISTRATIONS.
   * Type: error
   */
  it('US63-B11: enabling with a capacity below the active registrations is rejected', async () => {
    db.fetchCount.mockResolvedValue(10);
    await expectRejected(
      service.enableRegistration(assigned, 3, { ...valid(), capacity: 9 }),
      409,
      'CAPACITY_BELOW_REGISTRATIONS'
    );
  });

  /*
   * AC: SCRUM-63 (agreed extra rule for AC1)
   * Scenario: Registration is already enabled and the Coordinator tries to enable it again.
   * Expected: 409 ALREADY_ENABLED; the existing settings are unchanged.
   * Type: error
   */
  it('US63-B12: enabling twice is rejected and the settings are unchanged', async () => {
    event = enabledEvent();
    await expectRejected(
      service.enableRegistration(assigned, 3, { ...valid(), capacity: 80 }),
      409,
      'ALREADY_ENABLED'
    );
    expect(event.registration_capacity).toBe(50);
  });

  /*
   * AC: SCRUM-63 AC7
   * Scenario: A Coordinator who is not assigned, an Attendee and the Organiser try to enable.
   * Expected: 403 NOT_ASSIGNED; registration is not enabled.
   * Type: error
   */
  it.each([
    ['another Coordinator', otherCoordinator],
    ['an Attendee', attendee],
    ['the Organiser', organiser],
  ])('US63-B13: %s cannot enable registration', async (_label, user) => {
    await expectRejected(service.enableRegistration(user, 3, valid()), 403, 'NOT_ASSIGNED');
    expect(event.registration_open).toBe(false);
  });

  /*
   * AC: SCRUM-63 AC7
   * Scenario: A user whose id matches but who no longer has the Coordinator role.
   * Expected: 403 NOT_ASSIGNED.
   * Type: boundary
   */
  it('US63-B14: the assigned user without the Coordinator role is rejected', async () => {
    await expectRejected(
      service.enableRegistration({ id: 2, roles: [ROLES.ATTENDEE] }, 3, valid()),
      403,
      'NOT_ASSIGNED'
    );
  });

  it('US63-B15a: enabling with a null open time or no body at all counts as missing', async () => {
    await expectRejected(
      service.enableRegistration(assigned, 3, { ...valid(), opensAt: null }),
      400,
      'MISSING_SETTINGS'
    );
    await expectRejected(service.enableRegistration(assigned, 3), 400, 'MISSING_SETTINGS');
  });

  it('US63-B15: enabling on a missing event returns 404 and writes nothing', async () => {
    db.fetchOne.mockResolvedValueOnce(null);
    await expectRejected(service.enableRegistration(assigned, 99, valid()), 404, 'NOT_FOUND');
  });
});

describe('SCRUM-63 change registration after it is enabled (service rules)', () => {
  beforeEach(() => {
    event = enabledEvent();
  });

  /*
   * AC: SCRUM-63 AC5
   * Scenario: The assigned Coordinator moves the close date later (extension).
   * Expected: only the close date is written; the open date and capacity are untouched.
   * Type: normal
   */
  it('US63-B16: the close date can be moved later', async () => {
    const later = '2026-11-10T09:00:00.000Z';
    const result = await service.changeRegistrationSettings(assigned, 3, { closesAt: later });

    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      registration_closes_at: later,
    }));
    const patch = db.updateById.mock.calls[0][2];
    expect(patch).not.toHaveProperty('registration_opens_at');
    expect(patch).not.toHaveProperty('registration_capacity');
    expect(result.registrationClosesAt).toBe(later);
    expect(audit.writeAudit).toHaveBeenCalledWith(2, 'REGISTRATION_CHANGED', 'event', 3, {
      closesAt: later,
      capacity: undefined,
    });
  });

  /*
   * AC: SCRUM-63 AC5 (agreed extra rule)
   * Scenario: The close date is moved earlier. Closing early is deferred, so this is refused.
   * Expected: 409 CLOSE_EARLIER; the close date is unchanged.
   * Type: error
   */
  it('US63-B17: the close date cannot be moved earlier', async () => {
    await expectRejected(
      service.changeRegistrationSettings(assigned, 3, { closesAt: '2026-11-05T09:00:00.000Z' }),
      409,
      'CLOSE_EARLIER'
    );
    expect(event.registration_closes_at).toBe(CLOSES);
  });

  it('US63-B18: a new close date that is not a date is rejected', async () => {
    await expectRejected(
      service.changeRegistrationSettings(assigned, 3, { closesAt: 'soon' }),
      400,
      'INVALID_DATE'
    );
  });

  /*
   * AC: SCRUM-63 AC5 (agreed extra rule)
   * Scenario: The open date is sent in a change.
   * Expected: 400 OPEN_LOCKED; nothing is written.
   * Type: error
   */
  it('US63-B19: the open date cannot be changed after registration is enabled', async () => {
    await expectRejected(
      service.changeRegistrationSettings(assigned, 3, { opensAt: '2026-11-02T09:00:00.000Z' }),
      400,
      'OPEN_LOCKED'
    );
  });

  /*
   * AC: SCRUM-63 AC6
   * Scenario: 10 active registrations; capacity set to 10 (equal) and to 9 (below).
   * Expected: 10 is accepted, 9 is rejected and the capacity stays 50.
   * Type: boundary
   */
  it('US63-B20: capacity can be set equal to the active registrations', async () => {
    db.fetchCount.mockResolvedValue(10);
    await service.changeRegistrationSettings(assigned, 3, { capacity: 10 });
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      registration_capacity: 10,
    }));
  });

  it('US63-B21: capacity cannot be set below the active registrations', async () => {
    db.fetchCount.mockResolvedValue(10);
    await expectRejected(
      service.changeRegistrationSettings(assigned, 3, { capacity: 9 }),
      409,
      'CAPACITY_BELOW_REGISTRATIONS'
    );
    expect(event.registration_capacity).toBe(50);
  });

  /*
   * AC: SCRUM-63 AC6
   * Scenario: Withdrawn registrations must not count. The query excludes them.
   * Setup: the database count (already excluding withdrawn) is 7; capacity set to 7.
   * Expected: accepted, and the count query filtered out WITHDRAWN.
   * Type: boundary
   */
  it('US63-B22: withdrawn registrations do not count against capacity', async () => {
    db.fetchCount.mockResolvedValue(7);
    await service.changeRegistrationSettings(assigned, 3, { capacity: 7 });

    const builder = db.supabase.from.mock.results.find((r) => r.value.neq.mock.calls.length)?.value;
    expect(db.supabase.from).toHaveBeenCalledWith('registrations');
    expect(builder.neq).toHaveBeenCalledWith('status', 'WITHDRAWN');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      registration_capacity: 7,
    }));
  });

  it.each([0, ''])('US63-B23: a new capacity of %p is rejected', async (capacity) => {
    await expectRejected(
      service.changeRegistrationSettings(assigned, 3, { capacity }),
      400,
      'INVALID_CAPACITY'
    );
  });

  it('US63-B18a: a blank new close date is rejected', async () => {
    await expectRejected(
      service.changeRegistrationSettings(assigned, 3, { closesAt: null }),
      400,
      'INVALID_DATE'
    );
  });

  it('US63-B24: a change with nothing to change is rejected', async () => {
    await expectRejected(service.changeRegistrationSettings(assigned, 3, {}), 400, 'NOTHING_TO_CHANGE');
    await expectRejected(service.changeRegistrationSettings(assigned, 3), 400, 'NOTHING_TO_CHANGE');
  });

  it('US63-B25: settings cannot be changed before registration is enabled', async () => {
    event = confirmedEvent();
    await expectRejected(
      service.changeRegistrationSettings(assigned, 3, { capacity: 60 }),
      409,
      'NOT_ENABLED'
    );
  });

  /*
   * AC: SCRUM-63 AC7
   * Scenario: A Coordinator who is not assigned tries to extend the close date.
   * Expected: 403 NOT_ASSIGNED; the close date is unchanged.
   * Type: error
   */
  it('US63-B26: another Coordinator cannot change the settings', async () => {
    await expectRejected(
      service.changeRegistrationSettings(otherCoordinator, 3, { closesAt: '2026-11-10T09:00:00.000Z' }),
      403,
      'NOT_ASSIGNED'
    );
    expect(event.registration_closes_at).toBe(CLOSES);
  });
});

describe('SCRUM-63 general event edit cannot bypass the registration rules', () => {
  /*
   * AC: SCRUM-63 AC1-AC6
   * Scenario: The assigned Coordinator tries to open registration through PATCH /api/events/:id.
   * Expected: 409 REGISTRATION_SETTINGS_LOCKED; nothing written.
   * Type: error
   */
  it.each([
    ['registrationOpen', true],
    ['registrationOpensAt', OPENS],
    ['registrationClosesAt', CLOSES],
  ])('US63-E01: %s cannot be set through the general edit', async (field, value) => {
    await expectRejected(
      eventsService.updateEvent(assigned, 3, { [field]: value }),
      409,
      'REGISTRATION_SETTINGS_LOCKED'
    );
  });

  it('US63-E02: capacity cannot be changed through the general edit once registration is open', async () => {
    event = enabledEvent();
    await expectRejected(
      eventsService.updateEvent(assigned, 3, { registrationCapacity: 5 }),
      409,
      'REGISTRATION_SETTINGS_LOCKED'
    );
  });
});

describe('SCRUM-63 registration routes', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const token = jwt.sign({ sub: 2 }, env.jwtSecret);

  function signedInAs(role) {
    db.fetchOne.mockResolvedValueOnce({ id: 2, is_active: true });
    db.fetchMany.mockResolvedValue([{ role }]);
  }

  /*
   * AC: SCRUM-63 AC1, AC2
   * Scenario: The assigned Coordinator enables registration through the real HTTP route.
   * Expected: 200 with the saved settings.
   * Type: normal
   */
  it('US63-R01: the assigned Coordinator can enable registration through the API', async () => {
    signedInAs(ROLES.EVENT_COORDINATOR);
    const res = await request(app)
      .post('/api/events/3/registration/enable')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send(valid());

    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ registrationOpen: true, registrationCapacity: 50 });
  });

  /*
   * AC: SCRUM-63 AC7
   * Scenario: An Attendee calls the enable route.
   * Expected: 403 from the role check before the service runs; nothing written.
   * Type: error
   */
  it('US63-R02: an Attendee is refused by the enable route', async () => {
    signedInAs(ROLES.ATTENDEE);
    const res = await request(app)
      .post('/api/events/3/registration/enable')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send(valid());

    expect(res.status).toBe(403);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('US63-R03: the enable route needs a signed-in user', async () => {
    const res = await request(app).post('/api/events/3/registration/enable').send(valid());
    expect(res.status).toBe(401);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-63 AC5
   * Scenario: The assigned Coordinator extends the close date through PATCH.
   * Expected: 200 with the new close date.
   * Type: normal
   */
  it('US63-R04: the assigned Coordinator can extend the close date through the API', async () => {
    event = enabledEvent();
    signedInAs(ROLES.EVENT_COORDINATOR);
    const later = '2026-11-10T09:00:00.000Z';
    const res = await request(app)
      .patch('/api/events/3/registration')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ closesAt: later });

    expect(res.status).toBe(200);
    expect(res.body.settings.registrationClosesAt).toBe(later);
  });

  it('US63-R05: a rejected change returns the error code and writes nothing', async () => {
    event = enabledEvent();
    signedInAs(ROLES.EVENT_COORDINATOR);
    const res = await request(app)
      .patch('/api/events/3/registration')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ closesAt: '2026-11-05T09:00:00.000Z' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CLOSE_EARLIER');
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

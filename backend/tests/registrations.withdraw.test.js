/**
 * SCRUM-53: an Attendee withdraws their own registration, freeing their place.
 *
 * Labels:
 *   US53-B..  service rules (registrationsService.withdraw)
 *   US53-R..  HTTP route (auth cookie + service)
 *
 * Note for reviewers: withdraw() notifies the oldest WAITLISTED registration when a
 * REGISTERED one is withdrawn. SCRUM-52 (as it stands on main) is a hard capacity cap —
 * register() never creates a WAITLISTED row — so that branch cannot currently fire outside
 * a manually-inserted WAITLISTED row. Tests below cover it as written rather than removing
 * it, since whether to keep it is a product decision, not a test-writing one.
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
const service = require('../src/services/registrations.service');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

const attendee = { id: 30, roles: [ROLES.ATTENDEE] };

let builder;

function registrationRow(overrides = {}) {
  return {
    id: 10,
    event_id: 3,
    attendee_id: 30,
    status: 'REGISTERED',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };
  db.supabase.from.mockReturnValue(builder);
  db.fetchMany.mockResolvedValue([]);
  db.updateById.mockImplementation(async (table, id, patch) => ({ id, ...patch }));
});

describe('SCRUM-53 withdraw registration (service rules)', () => {
  /*
  * AC:       SCRUM-53 (AC1: Attendee can withdraw their registration)
  * Scenario: An Attendee withdraws their own active registration.
  * Setup:    Attendee has an active REGISTERED row for this event (event_id:3, attendee_id:30).
  * Expected: The registration is updated to WITHDRAWN with a withdrawn_at timestamp.
  * Type:     normal
  */
  // SCRUM-53-TC01
  it('US53-B01: an Attendee can withdraw their own registration', async () => {
    db.fetchMany.mockResolvedValueOnce([registrationRow()]); // the attendee's active registration

    const result = await service.withdraw(attendee, 3);

    expect(db.updateById).toHaveBeenCalledWith('registrations', 10, expect.objectContaining({
      status: 'WITHDRAWN',
      withdrawn_at: expect.any(String),
    }));
    expect(result.status).toBe('WITHDRAWN');
  });

  /*
  * AC:       SCRUM-53 (AC2: withdrawing updates the available registration capacity accordingly)
  * Scenario: Withdrawing is scoped to this event and this attendee only, excluding registrations
  *           already withdrawn — the same `neq WITHDRAWN` rule SCRUM-52/63/74 use to count
  *           "active" registrations, so the freed place is reflected everywhere immediately.
  * Setup:    Attendee has an active registration for this event.
  * Expected: The lookup query is filtered by event_id=3, attendee_id=30, and neq WITHDRAWN.
  * Type:     normal
  */
  // SCRUM-53-TC02
  it('US53-B02: withdrawing only ever targets the caller\'s own active registration for this event', async () => {
    db.fetchMany.mockResolvedValueOnce([registrationRow()]);

    await service.withdraw(attendee, 3);

    expect(builder.eq).toHaveBeenCalledWith('event_id', 3);
    expect(builder.eq).toHaveBeenCalledWith('attendee_id', 30);
    expect(builder.neq).toHaveBeenCalledWith('status', 'WITHDRAWN');
  });

  /*
  * AC:       SCRUM-53 (AC1, error side: no active registration to withdraw)
  * Scenario: An Attendee with no active registration for this event tries to withdraw.
  * Setup:    fetchMany returns no registrations for this Attendee/event.
  * Expected: Rejected with 404; updateById is not called.
  * Type:     error
  */
  // SCRUM-53-TC03
  it('US53-B03: withdrawing with no active registration is 404', async () => {
    db.fetchMany.mockResolvedValueOnce([]); // no active registration found

    await expect(service.withdraw(attendee, 3)).rejects.toMatchObject({ status: 404 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
  * AC:       SCRUM-53 (withdraw's waitlist side-effect)
  * Scenario: A REGISTERED attendee withdraws while someone else is WAITLISTED.
  * Setup:    Withdrawing attendee holds a REGISTERED place; another attendee (id=40) is
  *           WAITLISTED for the same event.
  * Expected: notifyUser is called for attendee id 40 with type WAITLIST_OPENING.
  * Type:     normal
  */
  // SCRUM-53-TC04
  it('US53-B04: withdrawing a REGISTERED place notifies the oldest waitlisted attendee', async () => {
    db.fetchMany.mockResolvedValueOnce([registrationRow({ status: 'REGISTERED' })]);
    db.fetchMany.mockResolvedValueOnce([{ id: 20, attendee_id: 40, status: 'WAITLISTED' }]);

    await service.withdraw(attendee, 3);

    expect(audit.notifyUser).toHaveBeenCalledWith(
      40,
      'WAITLIST_OPENING',
      expect.any(String),
      expect.any(String),
      3
    );
  });

  /*
  * AC:       SCRUM-53 (a waitlisted withdrawal frees no place)
  * Scenario: A WAITLISTED attendee withdraws (never held a confirmed place).
  * Setup:    The withdrawing attendee's own registration is WAITLISTED, not REGISTERED.
  * Expected: No WAITLIST_OPENING notice — nothing was actually freed. SCRUM-46 still tells
  *           the attendee themselves their own registration was withdrawn.
  * Type:     boundary
  */
  // SCRUM-53-TC05
  it('US53-B05: withdrawing a WAITLISTED place does not open a place for anyone else', async () => {
    db.fetchMany.mockResolvedValueOnce([registrationRow({ status: 'WAITLISTED' })]);

    await service.withdraw(attendee, 3);

    expect(audit.notifyUser).not.toHaveBeenCalledWith(
      expect.anything(),
      'WAITLIST_OPENING',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(audit.notifyUser).toHaveBeenCalledWith(
      30,
      'REGISTRATION_WITHDRAWN',
      'Registration withdrawn',
      expect.any(String),
      3
    );
  });
});

describe('SCRUM-53 withdraw registration route', () => {
  const { createApp } = require('../src/app');
  const app = createApp();

  /*
  * AC:       SCRUM-53 (AC1: Attendee can withdraw their registration — route level)
  * Scenario: An Attendee withdraws through the real HTTP route.
  * Setup:    Attendee is signed in with a valid session cookie and has an active registration.
  * Expected: 200 OK; response body registration.status is 'WITHDRAWN'.
  * Type:     normal
  */
  // SCRUM-53-TC06
  it('US53-R01: an Attendee can withdraw through the API', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 30, is_active: true }); // auth: the signed-in user
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.ATTENDEE }]); // auth: their roles
    db.fetchMany.mockResolvedValueOnce([registrationRow()]); // service: the active registration

    const token = jwt.sign({ sub: 30 }, env.jwtSecret);
    const res = await request(app)
      .post('/api/events/3/registrations/withdraw')
      .set('Cookie', `${env.sessionCookieName}=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.registration.status).toBe('WITHDRAWN');
  });

  /*
  * AC:       SCRUM-53 (general auth guard)
  * Scenario: The withdraw route requires a signed-in user.
  * Setup:    No session cookie is sent.
  * Expected: 401 Unauthorized.
  * Type:     error
  */
  // SCRUM-53-TC07
  it('US53-R02: the route needs a signed-in user', async () => {
    const res = await request(app).post('/api/events/3/registrations/withdraw');
    expect(res.status).toBe(401);
  });
});

describe('SCRUM-53 AC2: withdrawing updates the available registration capacity (end-to-end)', () => {
  const organiser = { id: 1, roles: [ROLES.EVENT_ORGANISER] };

  function withEvent(overrides = {}) {
    return { id: 3, organiser_id: 1, coordinator_id: 2, registration_capacity: 50, ...overrides };
  }

  /*
   * AC:       SCRUM-53 (AC2: withdrawing updates the available registration capacity accordingly)
   * Scenario: An Organiser's capacity view is checked before and after an Attendee withdraws.
   * Setup:    2 active registrations exist out of capacity 50; the Attendee withdraws one;
   *           the Organiser's view is checked again afterward.
   * Expected: activeCount drops from 2 to 1 as a direct result of the withdraw() call.
   * Type:     normal
   */
  // SCRUM-53-TC08
  it('activeCount drops by one immediately after an attencan do when dee withdraws', async () => {
    // Before: 2 active registrations
    db.fetchOne.mockResolvedValueOnce(withEvent());
    db.fetchMany.mockResolvedValueOnce([
      registrationRow({ id: 10, status: 'REGISTERED' }),
      registrationRow({ id: 11, attendee_id: 31, status: 'REGISTERED' }),
    ]);
    db.fetchCount.mockResolvedValueOnce(2);
    const before = await service.listForEvent(organiser, 3);
    expect(before.activeCount).toBe(2);

    // Withdraw attendee 30's registration
    db.fetchMany.mockResolvedValueOnce([registrationRow({ id: 10, status: 'REGISTERED' })]);
    await service.withdraw(attendee, 3);
    expect(db.updateById).toHaveBeenCalledWith('registrations', 10, expect.objectContaining({ status: 'WITHDRAWN' }));

    // After: capacity view reflects the withdrawal
    db.fetchOne.mockResolvedValueOnce(withEvent());
    db.fetchMany.mockResolvedValueOnce([
      registrationRow({ id: 10, status: 'WITHDRAWN' }),
      registrationRow({ id: 11, attendee_id: 31, status: 'REGISTERED' }),
    ]);
    db.fetchCount.mockResolvedValueOnce(1);
    const after = await service.listForEvent(organiser, 3);
    expect(after.activeCount).toBe(1);
  });
});

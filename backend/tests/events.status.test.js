/**
 * SCRUM-5: Progressing Event Statuses (service and route tests)
 *
 * Acceptance criteria covered:
 *   AC1  Events follow the lifecycle and can't bypass the review or venue booking steps.
 *   AC2  Transitions outside the matrix fail with HTTP 400.
 *
 * Labels:
 *   US5-S..  service rules (events.service submitEvent / changeStatus)
 *   US5-R..  real HTTP route POST /api/events/:id/status
 *
 * The database is mocked. Each fake query remembers which table it was for, so the
 * tests can return the event for `events` and a booking (or nothing) for `venue_bookings`.
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
const { env } = require('../src/config/env');

const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };

let event;
let approvedBooking;

beforeEach(() => {
  jest.clearAllMocks();
  event = {
    id: 3, organiser_id: 1, organisation_id: 10, coordinator_id: 2, status: 'DRAFT',
    name: 'Workshop', purpose: 'Learn', description: 'A workshop',
    start_at: '2026-10-01T10:00:00Z', end_at: '2026-10-01T11:00:00Z',
    expected_attendance: 10, venue_requirements: 'Room', accessibility_needs: 'None',
  };
  approvedBooking = { id: 7 };
  db.supabase.from.mockImplementation((table) => {
    const query = { table };
    query.select = jest.fn(() => query);
    query.eq = jest.fn(() => query);
    query.order = jest.fn(() => query);
    return query;
  });
  db.fetchOne.mockImplementation(async (query) => (query?.table === 'venue_bookings' ? approvedBooking : event));
  db.fetchMany.mockResolvedValue([]);
  db.updateById.mockResolvedValue(event);
});

describe('SCRUM-5 status progression (service rules)', () => {
  // AC1 · Submitting moves Draft straight to Pending review (UNDER_REVIEW), and the
  // history row records exactly that step. There's no hidden SUBMITTED status any more.
  it('US5-S01: submitting a draft moves it to UNDER_REVIEW and records DRAFT -> UNDER_REVIEW', async () => {
    await service.submitEvent(organiser, 3);
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ status: 'UNDER_REVIEW' }));
    expect(db.insertOne).toHaveBeenCalledWith('event_status_history', expect.objectContaining({
      from_status: 'DRAFT', to_status: 'UNDER_REVIEW',
    }));
  });

  // AC2 · Submitting again while already under review is outside the matrix: 400, no write.
  it('US5-S02: submitting an event that is already under review fails with 400', async () => {
    event.status = 'UNDER_REVIEW';
    await expect(service.submitEvent(organiser, 3)).rejects.toMatchObject({ status: 400 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // AC1 · Approved - pending venue -> Venue secured works once a venue booking is approved.
  it('US5-S03: PLANNING -> VENUE_SECURED succeeds when a venue booking is approved', async () => {
    event.status = 'PLANNING';
    await service.changeStatus(coordinator, 3, 'VENUE_SECURED');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ status: 'VENUE_SECURED' }));
  });

  // AC1 · "Cannot bypass booking steps": without an approved booking, the venue can't be
  // marked secured. This is a missing precondition, not a bad transition, so it's 409.
  it('US5-S04: PLANNING -> VENUE_SECURED is refused without an approved venue booking', async () => {
    event.status = 'PLANNING';
    approvedBooking = null;
    await expect(service.changeStatus(coordinator, 3, 'VENUE_SECURED')).rejects.toMatchObject({
      status: 409, code: 'VENUE_NOT_APPROVED',
      message: 'A venue booking must be approved before the venue can be marked secured',
    });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // AC1 · Confirming also re-checks the booking, in case it was withdrawn after the venue
  // was marked secured.
  it('US5-S05: VENUE_SECURED -> CONFIRMED is refused if the booking is no longer approved', async () => {
    event.status = 'VENUE_SECURED';
    approvedBooking = null;
    await expect(service.changeStatus(coordinator, 3, 'CONFIRMED')).rejects.toMatchObject({
      status: 409, message: 'A venue booking must be approved before confirmation',
    });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // AC2 · Skipping Venue secured is blocked with 400, even when a booking IS approved.
  // The order of steps matters, not just the booking existing.
  it('US5-S06: PLANNING -> CONFIRMED is refused with 400 even with an approved booking', async () => {
    event.status = 'PLANNING';
    await expect(service.changeStatus(coordinator, 3, 'CONFIRMED'))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_STATUS_TRANSITION' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // AC2 · Cancelled is final: nothing can bring a cancelled event back.
  it('US5-S07: a cancelled event cannot be moved back into planning', async () => {
    event.status = 'CANCELLED';
    await expect(service.changeStatus(coordinator, 3, 'PLANNING')).rejects.toMatchObject({ status: 400 });
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

describe('SCRUM-5 POST /api/events/:id/status (route)', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const token = jwt.sign({ sub: 2 }, env.jwtSecret);

  // Sends the request as user 2 with a real signed session cookie. The first lookup is the
  // auth middleware loading the user; the role comes from the (mocked) database.
  function asCoordinator() {
    db.fetchOne.mockImplementationOnce(async () => ({ id: 2, is_active: true }));
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);
    return request(app)
      .post('/api/events/3/status')
      .set('Cookie', `${env.sessionCookieName}=${token}`);
  }

  // AC2 · End to end through Express: an invalid jump comes back as HTTP 400 with the
  // INVALID_STATUS_TRANSITION code and a readable message.
  it('US5-R01: an invalid transition returns HTTP 400', async () => {
    event.status = 'DRAFT';
    const res = await asCoordinator().send({ status: 'CONFIRMED' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'INVALID_STATUS_TRANSITION', message: 'Cannot move event from DRAFT to CONFIRMED',
    });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // AC1 · A valid step through the same route succeeds.
  it('US5-R02: a valid transition returns HTTP 200', async () => {
    event.status = 'PLANNING';
    const res = await asCoordinator().send({ status: 'VENUE_SECURED' });
    expect(res.status).toBe(200);
    expect(db.updateById).toHaveBeenCalledWith('events', '3', expect.objectContaining({ status: 'VENUE_SECURED' }));
  });
});

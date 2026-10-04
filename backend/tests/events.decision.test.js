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
const { env } = require('../src/config/env');

const REASON_ERROR = 'Rejection reason must be at least 10 characters';
const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };

let event;

beforeEach(() => {
  jest.clearAllMocks();
  event = {
    id: 3, organiser_id: 1, organisation_id: 10, coordinator_id: 2, status: 'UNDER_REVIEW',
    name: 'Workshop', purpose: 'Learn', description: 'A workshop',
    start_at: '2026-10-01T10:00:00Z', end_at: '2026-10-01T11:00:00Z',
    expected_attendance: 10, venue_requirements: 'Room', accessibility_needs: 'None',
  };
  db.supabase.from.mockReturnValue({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis() });
  db.fetchOne.mockImplementation(async () => event);
  db.fetchMany.mockResolvedValue([]);
  db.updateById.mockResolvedValue(event);
});

describe('SCRUM-17 approve or reject event request (service rules)', () => {
  it('US17-B01: approving an event under review moves it to PLANNING', async () => {
    await service.decideEvent(coordinator, 3, 'APPROVE');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ status: 'PLANNING' }));
  });

  it('US17-B02: an optional approval comment is recorded in history and sent to the organiser', async () => {
    await service.decideEvent(coordinator, 3, 'APPROVE', '  Looks good, proceed  ');
    expect(db.insertOne).toHaveBeenCalledWith('event_status_history', expect.objectContaining({
      from_status: 'UNDER_REVIEW', to_status: 'PLANNING', note: 'Looks good, proceed',
    }));
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1, 'EVENT_STATUS_CHANGED', 'Event request approved',
      expect.stringContaining('Coordinator comment: Looks good, proceed'), 3
    );
  });

  it('US17-B03: approving without a comment is allowed', async () => {
    await service.decideEvent(coordinator, 3, 'APPROVE', '');
    expect(db.updateById).toHaveBeenCalled();
    expect(db.insertOne).toHaveBeenCalledWith('event_status_history', expect.objectContaining({ note: null }));
  });

  it('US17-B04: rejecting with a valid reason saves the trimmed reason and notifies the organiser', async () => {
    const reason = '  Expected attendance is missing a breakdown  ';
    await service.decideEvent(coordinator, 3, 'REJECT', reason);
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      status: 'REJECTED', rejection_reason: reason.trim(),
    }));
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1, 'EVENT_STATUS_CHANGED', 'Event request rejected',
      `Workshop was rejected. Reason: ${reason.trim()}`, 3
    );
  });

  it('US17-B05: a rejection reason of exactly 10 characters is accepted (boundary)', async () => {
    await service.decideEvent(coordinator, 3, 'REJECT', 'Incomplete');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ status: 'REJECTED' }));
  });

  it.each([
    ['"Too short" (9 characters, boundary - 1)', 'Too short'],
    ['padding that trims below 10', '     Too short     '],
    ['whitespace only', '                    '],
    ['an empty string', ''],
    ['a missing reason', undefined],
  ])('US17-B06: rejection with %s is blocked with 400 and nothing is saved', async (_label, reason) => {
    await expect(service.decideEvent(coordinator, 3, 'REJECT', reason))
      .rejects.toMatchObject({ status: 400, message: REASON_ERROR });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'PLANNING', 'CONFIRMED', 'REJECTED', 'COMPLETED', 'CANCELLED'])(
    'US17-B07: a decision on an event in %s is refused with 409',
    async (status) => {
      event.status = status;
      await expect(service.decideEvent(coordinator, 3, 'APPROVE')).rejects.toMatchObject({ status: 409 });
      expect(db.updateById).not.toHaveBeenCalled();
    }
  );

  it('US17-B08: the organiser cannot approve their own request', async () => {
    await expect(service.decideEvent(organiser, 3, 'APPROVE')).rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('US17-B09: a coordinator who is not assigned to the event cannot decide', async () => {
    await expect(service.decideEvent({ ...coordinator, id: 99 }, 3, 'REJECT', 'Not enough detail provided'))
      .rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('US17-B10: an unknown decision value is refused with 400', async () => {
    await expect(service.decideEvent(coordinator, 3, 'MAYBE')).rejects.toMatchObject({ status: 400 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('US17-B11: a missing event returns 404', async () => {
    db.fetchOne.mockResolvedValue(null);
    await expect(service.decideEvent(coordinator, 404, 'APPROVE')).rejects.toMatchObject({ status: 404 });
  });

  it('US17-B12: the generic status endpoint cannot bypass the 10-character rejection rule', async () => {
    await expect(service.changeStatus(coordinator, 3, 'REJECTED', 'nope'))
      .rejects.toMatchObject({ status: 400, message: REASON_ERROR });
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

describe('SCRUM-17 POST /api/events/:id/decision (route)', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const token = jwt.sign({ sub: 2 }, env.jwtSecret);

  function asRole(role) {
    db.fetchOne.mockResolvedValueOnce({ id: 2, is_active: true });
    db.fetchMany.mockResolvedValue([{ role }]);
    return request(app)
      .post('/api/events/3/decision')
      .set('Cookie', `${env.sessionCookieName}=${token}`);
  }

  it('US17-R01: an assigned coordinator can approve through the API', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR).send({ decision: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(db.updateById).toHaveBeenCalledWith('events', '3', expect.objectContaining({ status: 'PLANNING' }));
  });

  it('US17-R02: a 9-character rejection reason is blocked before reaching the service', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR).send({ decision: 'REJECT', reason: 'Too short' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(REASON_ERROR);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it('US17-R03: an invalid decision value returns 400', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR).send({ decision: 'DELETE' });
    expect(res.status).toBe(400);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  it.each([ROLES.EVENT_ORGANISER, ROLES.VENUE_STAFF, ROLES.TECHNICAL_SUPPORT, ROLES.ATTENDEE])(
    'US17-R04: %s cannot call the decision endpoint (403)',
    async (role) => {
      const res = await asRole(role).send({ decision: 'APPROVE' });
      expect(res.status).toBe(403);
      expect(db.updateById).not.toHaveBeenCalled();
    }
  );

  it('US17-R05: a request without a session is rejected with 401', async () => {
    const res = await request(app).post('/api/events/3/decision').send({ decision: 'APPROVE' });
    expect(res.status).toBe(401);
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

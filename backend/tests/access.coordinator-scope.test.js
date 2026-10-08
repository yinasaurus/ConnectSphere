const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
  updateById: jest.fn(), insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));

const db = require('../src/config/db');
const audit = require('../src/services/audit.service');
const service = require('../src/services/events.service');
const { createApp } = require('../src/app');

describe('SCRUM-54 coordinator assignment scope', () => {
  const app = createApp();
  const token = jwt.sign({ sub: 4 }, env.jwtSecret);
  const assigned = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
  const otherCoordinator = { id: 4, roles: [ROLES.EVENT_COORDINATOR] };
  const hybrid = { id: 2, roles: [ROLES.EVENT_COORDINATOR, ROLES.EVENT_COORDINATOR_LEAD] };

  let event;

  beforeEach(() => {
    jest.clearAllMocks();
    event = {
      id: 3,
      organiser_id: 1,
      organisation_id: 10,
      coordinator_id: 2,
      status: 'UNDER_REVIEW',
      name: 'Secret Workshop',
      purpose: 'Confidential purpose',
      description: 'Do not leak this description',
      start_at: '2026-10-01T10:00:00Z',
      end_at: '2026-10-01T11:00:00Z',
      expected_attendance: 10,
      venue_requirements: 'Room',
      accessibility_needs: 'None',
    };
    db.supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    });
    db.fetchOne.mockImplementation(async () => event);
    db.fetchMany.mockResolvedValue([]);
    db.updateById.mockResolvedValue(event);
  });

  /*
   * AC: SCRUM-54 AC6
   * Scenario: A Coordinator opens an event assigned to someone else.
   * Setup: Event 3 is assigned to coordinator 2; caller is coordinator 4.
   * Expected: The event is returned for viewing (name included). Nothing is changed.
   * Type: normal
   */
  it('lets a Coordinator view an event that is not assigned to them', async () => {
    const visible = await service.getEvent(otherCoordinator, 3);
    expect(visible.id).toBe(3);
    expect(visible.name).toBe('Secret Workshop');
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC6
   * Scenario: A Coordinator opens an event that has no coordinator yet.
   * Setup: coordinator_id is null; caller is a Coordinator.
   * Expected: They can still view it. The row is unchanged.
   * Type: boundary
   */
  it('lets a Coordinator view an unassigned event', async () => {
    event.coordinator_id = null;
    const visible = await service.getEvent(otherCoordinator, 3);
    expect(visible.id).toBe(3);
    expect(visible.name).toBe('Secret Workshop');
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC5
   * Scenario: A Coordinator edits an event assigned to someone else.
   * Setup: Same as the view case; patch tries to rename the event.
   * Expected: 403, updateById is not called, so the event is unchanged.
   * Type: error
   */
  it('rejects an edit by a Coordinator who is not assigned', async () => {
    await expect(service.updateEvent(otherCoordinator, 3, { name: 'Hijacked' }))
      .rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC5
   * Scenario: A Coordinator approves an event assigned to someone else.
   * Setup: Event under review, assigned to id 2; caller is id 4.
   * Expected: 403, status and audit are unchanged.
   * Type: error
   */
  it('rejects an approval by a Coordinator who is not assigned', async () => {
    await expect(service.decideEvent(otherCoordinator, 3, 'APPROVE'))
      .rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC5
   * Scenario: A Coordinator rejects an event assigned to someone else.
   * Setup: Valid rejection reason; event assigned to id 2.
   * Expected: 403, the event stays UNDER_REVIEW.
   * Type: error
   */
  it('rejects a rejection by a Coordinator who is not assigned', async () => {
    await expect(service.decideEvent(otherCoordinator, 3, 'REJECT', 'Attendance numbers are missing'))
      .rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC5
   * Scenario: A Coordinator confirms an event they are not assigned to.
   * Setup: Event in PLANNING, assigned to id 2; caller is id 4.
   * Expected: 403 before readiness checks, so the event is unchanged.
   * Type: error
   */
  it('rejects a confirmation by a Coordinator who is not assigned', async () => {
    event.status = 'PLANNING';
    await expect(service.changeStatus(otherCoordinator, 3, 'CONFIRMED'))
      .rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC2, AC5
   * Scenario: A hybrid Coordinator + Lead approves an event assigned to them.
   * Setup: User id 2 holds both roles and is the assigned coordinator.
   * Expected: The Coordinator function (approve) still works in the same session.
   * Type: normal
   */
  it('lets a Coordinator + Lead hybrid approve an event assigned to them', async () => {
    await service.decideEvent(hybrid, 3, 'APPROVE');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ status: 'PLANNING' }));
  });

  /*
   * AC: SCRUM-54 AC5, AC7
   * Scenario: A Coordinator PATCHes an event they are not assigned to over HTTP.
   * Setup: Session user 4 is a Coordinator; event 3 is assigned to user 2 and named Secret Workshop.
   * Expected: 403 with only error and message — the name and description must not appear.
   * Type: error
   */
  it('returns 403 without event details when an unassigned Coordinator edits over HTTP', async () => {
    db.fetchOne
      .mockResolvedValueOnce({ id: 4, is_active: true })
      .mockResolvedValueOnce(event);
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);
    const res = await request(app)
      .patch('/api/events/3')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'FORBIDDEN', message: expect.any(String) });
    expect(res.body).not.toHaveProperty('event');
    expect(JSON.stringify(res.body)).not.toMatch(/Secret Workshop|Confidential purpose|Do not leak/i);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-54 AC5, AC7
   * Scenario: A Coordinator POSTs a confirm on an event they are not assigned to.
   * Setup: Same unassigned caller; event is in PLANNING.
   * Expected: 403 with no event resource in the body; row not updated.
   * Type: error
   */
  it('returns 403 without event details when an unassigned Coordinator confirms over HTTP', async () => {
    event.status = 'PLANNING';
    db.fetchOne
      .mockResolvedValueOnce({ id: 4, is_active: true })
      .mockResolvedValueOnce(event);
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);
    const res = await request(app)
      .post('/api/events/3/status')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ status: 'CONFIRMED' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'FORBIDDEN', message: expect.any(String) });
    expect(res.body).not.toHaveProperty('event');
    expect(JSON.stringify(res.body)).not.toMatch(/Secret Workshop/i);
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

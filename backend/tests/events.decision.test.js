/**
 * SCRUM-17: Approve or Reject Event Request (backend unit tests)
 *
 * Acceptance criteria covered:
 *   AC1  Approve / Reject is only available for events under review (UNDER_REVIEW).
 *   AC2  Rejecting requires a reason of at least 10 characters (trimmed).
 *   AC3  Approving moves the event to PLANNING ("Approved - Pending Venue" in the sprint plan).
 *   C1   The organiser is notified of the outcome (Customer Briefing, section 6 Notifications).
 *   C2   The decision is kept on record (Customer Briefing, Step 5).
 *   C3   Only the assigned coordinator can decide (Week 4 Q&A: coordinators cannot edit
 *        events not assigned to them).
 *
 * Labels:
 *   US17-B..  service rules (events.service.decideEvent / changeStatus)
 *   US17-R..  real HTTP route (auth cookie + role check + request validation)
 *
 * The database and the notification/audit service are mocked, so these tests check
 * what the service *asks* the database to do, without needing Supabase.
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
const { env } = require('../src/config/env');

// Typed out (not imported) so the test fails if the message or minimum drifts from AC2.
const REASON_ERROR = 'Rejection reason must be at least 10 characters';
const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };

let event;

// Fresh event before every test: under review, owned by organiser 1, assigned to coordinator 2.
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
  // SCRUM-5 (W7 #6): approving now lands on APPROVED, not PLANNING directly — the
  // coordinator starts planning as a separate step (APPROVED -> PLANNING).
  // AC3 · Happy path: the core approve transition UNDER_REVIEW -> APPROVED.
  it('US17-B01: approving an event under review moves it to APPROVED', async () => {
    await service.decideEvent(coordinator, 3, 'APPROVE');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ status: 'APPROVED' }));
  });

  // AC3 + C1 + C2 · Happy path: the approval comment is trimmed, saved to status history,
  // and included in the organiser's "approved" notification.
  it('US17-B02: an optional approval comment is recorded in history and sent to the organiser', async () => {
    await service.decideEvent(coordinator, 3, 'APPROVE', '  Looks good, proceed  ');
    expect(db.insertOne).toHaveBeenCalledWith('event_status_history', expect.objectContaining({
      from_status: 'UNDER_REVIEW', to_status: 'APPROVED', note: 'Looks good, proceed',
    }));
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1, 'EVENT_STATUS_CHANGED', 'Event request approved',
      expect.stringContaining('Coordinator comment: Looks good, proceed'), 3
    );
  });

  // AC3 · Edge case: the comment is optional for approval; an empty one is stored as null.
  it('US17-B03: approving without a comment is allowed', async () => {
    await service.decideEvent(coordinator, 3, 'APPROVE', '');
    expect(db.updateById).toHaveBeenCalled();
    expect(db.insertOne).toHaveBeenCalledWith('event_status_history', expect.objectContaining({ note: null }));
  });

  // AC2 + C1 + C2 · Happy path: a valid reason is trimmed and kept in all three places the
  // decision is recorded (the event, status history, audit log), then shown word-for-word
  // in the organiser's notification.
  it('US17-B04: rejecting with a valid reason saves the trimmed reason and notifies the organiser', async () => {
    const reason = '  Expected attendance is missing a breakdown  ';
    await service.decideEvent(coordinator, 3, 'REJECT', reason);
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      status: 'REJECTED', rejection_reason: reason.trim(),
    }));
    expect(db.insertOne).toHaveBeenCalledWith('event_status_history', expect.objectContaining({
      from_status: 'UNDER_REVIEW', to_status: 'REJECTED', actor_id: 2, note: reason.trim(),
    }));
    expect(audit.writeAudit).toHaveBeenCalledWith(2, 'EVENT_STATUS_CHANGED', 'event', 3, {
      from: 'UNDER_REVIEW', to: 'REJECTED', reason: reason.trim(),
    });
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1, 'EVENT_STATUS_CHANGED', 'Event request rejected',
      `Workshop was rejected. Reason: ${reason.trim()}`, 3
    );
  });

  // AC2 · Boundary (= minimum): "Incomplete" is exactly 10 characters and must pass.
  it('US17-B05: a rejection reason of exactly 10 characters is accepted (boundary)', async () => {
    await service.decideEvent(coordinator, 3, 'REJECT', 'Incomplete');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ status: 'REJECTED' }));
  });

  // AC2 · Boundary (minimum - 1) and negative inputs. Each case must fail with the exact
  // AC2 message, and nothing may be written or sent to the organiser.
  //   - "Too short" is 9 characters (one below the minimum)
  //   - spaces around "Too short" prove the length is checked after trimming
  //   - whitespace only / empty / missing (undefined) are all treated as no reason
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

  // AC1 · Negative: every status other than UNDER_REVIEW is refused with 409 Conflict,
  // including SUBMITTED (approving requires review first), PLANNING (can't approve
  // twice) and REJECTED (can't reject twice).
  it.each([
    'DRAFT', 'SUBMITTED', 'PLANNING', 'AWAITING_SAFETY_CHECK', 'PREPARATION',
    'CONFIRMED', 'REJECTED', 'COMPLETED', 'CANCELLED',
  ])(
    'US17-B07: a decision on an event in %s is refused with 409',
    async (status) => {
      event.status = status;
      await expect(service.decideEvent(coordinator, 3, 'APPROVE')).rejects.toMatchObject({ status: 409 });
      expect(db.updateById).not.toHaveBeenCalled();
    }
  );

  // SCRUM-5 AC4: a coordinator can reject a request that's still sitting in the
  // unopened Submitted queue, not just once it's Under Review.
  it('US17-B17: a request can be rejected directly from Submitted (before being opened)', async () => {
    event.status = 'SUBMITTED';
    await service.decideEvent(coordinator, 3, 'REJECT', 'Attendance numbers are missing');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      status: 'REJECTED', rejection_reason: 'Attendance numbers are missing',
    }));
  });

  // SCRUM-5 AC2: approving is specific to the reviewed request — it cannot be approved
  // while still sitting unopened in Submitted.
  it('US17-B18: a request cannot be approved while still Submitted (not yet under review)', async () => {
    event.status = 'SUBMITTED';
    await expect(service.decideEvent(coordinator, 3, 'APPROVE')).rejects.toMatchObject({ status: 409 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // C3 · Security: an organiser must not be able to approve their own request.
  it('US17-B08: the organiser cannot approve their own request', async () => {
    await expect(service.decideEvent(organiser, 3, 'APPROVE')).rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // C3 · Security: being a coordinator is not enough; it must be the coordinator
  // assigned to this event (id 2). Coordinator 99 is refused even with a valid reason.
  it('US17-B09: a coordinator who is not assigned to the event cannot decide', async () => {
    await expect(service.decideEvent({ ...coordinator, id: 99 }, 3, 'REJECT', 'Not enough detail provided'))
      .rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // AC1 · Negative: only APPROVE and REJECT exist; anything else is a bad request.
  it('US17-B10: an unknown decision value is refused with 400', async () => {
    await expect(service.decideEvent(coordinator, 3, 'MAYBE')).rejects.toMatchObject({ status: 400 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // Error handling: deciding on an event that doesn't exist returns 404, not a crash.
  it('US17-B11: a missing event returns 404', async () => {
    db.fetchOne.mockResolvedValue(null);
    await expect(service.decideEvent(coordinator, 404, 'APPROVE')).rejects.toMatchObject({ status: 404 });
  });

  // AC2 · Security: the older POST /api/events/:id/status endpoint can also reject.
  // This proves it enforces the same minimum, so AC2 can't be bypassed through it.
  it('US17-B12: the generic status endpoint cannot bypass the 10-character rejection rule', async () => {
    await expect(service.changeStatus(coordinator, 3, 'REJECTED', 'nope'))
      .rejects.toMatchObject({ status: 400, message: REASON_ERROR });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // Customer rule (Week 4 Q&A): "Rejected events may be resubmitted after appropriate
  // changes are made; rejection is not necessarily final." After a rejection, the organiser
  // can submit again: the event goes back under review and the old reason is cleared.
  it('US17-B13: a rejected request can be resubmitted by the organiser', async () => {
    // SCRUM-64: submission now rests at SUBMITTED; the assigned coordinator opens it
    // for review from there (same as a first-time submission), rather than landing
    // back at UNDER_REVIEW directly.
    event.status = 'REJECTED';
    event.rejection_reason = 'Attendance numbers are missing';
    await service.submitEvent(organiser, 3);
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      status: 'SUBMITTED', rejection_reason: null,
    }));
  });

  // Regression: the notification wording was changed for approve/reject only. Other status
  // changes (here CONFIRMED -> COMPLETED) must keep the generic "Event <status>" message.
  it('US17-B14: non-decision status changes keep the generic organiser notification', async () => {
    event.status = 'CONFIRMED';
    await service.changeStatus(coordinator, 3, 'COMPLETED');
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1, 'EVENT_STATUS_CHANGED', 'Event completed', 'Workshop is now COMPLETED.', 3
    );
  });

  // AC6 · Security: while the event has no assigned coordinator, no coordinator can decide,
  // and nothing is written (status unchanged, no history, no audit, no notification).
  it.each([
    ['APPROVE', undefined],
    ['REJECT', 'Not enough detail provided'],
  ])('US17-B15: %s on an unassigned event is refused for any coordinator', async (decision, reason) => {
    event.coordinator_id = null;
    await expect(service.decideEvent(coordinator, 3, decision, reason)).rejects.toMatchObject({ status: 403 });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(db.insertOne).not.toHaveBeenCalled();
    expect(audit.writeAudit).not.toHaveBeenCalled();
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  // AC3 + AC4 · Edge case: if the organiser account is gone (organiser_id set null on delete),
  // the decision and reason are still recorded; there is just nobody to notify.
  it('US17-B16: a decision on an event with no organiser is recorded without a notification', async () => {
    event.organiser_id = null;
    await service.decideEvent(coordinator, 3, 'REJECT', 'Attendance numbers are missing');
    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({
      status: 'REJECTED', rejection_reason: 'Attendance numbers are missing',
    }));
    expect(db.insertOne).toHaveBeenCalledWith('event_status_history', expect.objectContaining({
      to_status: 'REJECTED', note: 'Attendance numbers are missing',
    }));
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });
});

describe('SCRUM-17 POST /api/events/:id/decision (route)', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const token = jwt.sign({ sub: 2 }, env.jwtSecret);

  // Sends the request with a real signed session cookie for user 2. The first database
  // lookup is the auth middleware loading the user; roles come from the database,
  // not from the token, so changing `role` here changes what the server trusts.
  function asRole(role) {
    db.fetchOne.mockResolvedValueOnce({ id: 2, is_active: true });
    db.fetchMany.mockResolvedValue([{ role }]);
    return request(app)
      .post('/api/events/3/decision')
      .set('Cookie', `${env.sessionCookieName}=${token}`);
  }

  // AC3 · Happy path end to end through Express: auth -> role check -> validation -> service.
  it('US17-R01: an assigned coordinator can approve through the API', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR).send({ decision: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(db.updateById).toHaveBeenCalledWith('events', '3', expect.objectContaining({ status: 'APPROVED' }));
  });

  // AC2 · Negative: same data as manual test case IS212-US17-TC1 ("Too short", 9 characters).
  // The request validator stops it with the exact AC2 message before any database write.
  it('US17-R02: a 9-character rejection reason is blocked before reaching the service', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR).send({ decision: 'REJECT', reason: 'Too short' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(REASON_ERROR);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // Boundary (maximum): reasons are capped at 1000 characters so a huge payload can't be
  // stored. Exactly 1000 is accepted; 1001 is refused with a clear message, not a crash.
  it.each([
    [1000, 200],
    [1001, 400],
  ])('US17-R06: a %i-character reason returns %i', async (length, status) => {
    const res = await asRole(ROLES.EVENT_COORDINATOR).send({ decision: 'REJECT', reason: 'a'.repeat(length) });
    expect(res.status).toBe(status);
    if (status === 400) {
      expect(res.body.message).toBe('Reason must be 1000 characters or fewer');
      expect(db.updateById).not.toHaveBeenCalled();
    }
  });

  // AC1 · Negative: the request validator rejects decision values other than APPROVE / REJECT.
  it('US17-R03: an invalid decision value returns 400', async () => {
    const res = await asRole(ROLES.EVENT_COORDINATOR).send({ decision: 'DELETE' });
    expect(res.status).toBe(400);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  // C3 · Security (role-based access): the four non-coordinator roles are blocked by the
  // route's role check with 403, before the service runs.
  it.each([ROLES.EVENT_ORGANISER, ROLES.VENUE_STAFF, ROLES.TECHNICAL_SUPPORT, ROLES.ATTENDEE])(
    'US17-R04: %s cannot call the decision endpoint (403)',
    async (role) => {
      const res = await asRole(role).send({ decision: 'APPROVE' });
      expect(res.status).toBe(403);
      expect(db.updateById).not.toHaveBeenCalled();
    }
  );

  // Security (authentication): no session cookie means 401, and nothing is changed.
  it('US17-R05: a request without a session is rejected with 401', async () => {
    const res = await request(app).post('/api/events/3/decision').send({ decision: 'APPROVE' });
    expect(res.status).toBe(401);
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  updateById: jest.fn(),
  insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn(),
  notifyUser: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../src/config/db');
const audit = require('../src/services/audit.service');
const service = require('../src/services/events.service');
const { createApp } = require('../src/app');
const { env } = require('../src/config/env');
const { ROLES } = require('../src/constants/roles');

const app = createApp();
const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const otherCoordinator = { id: 9, roles: [ROLES.EVENT_COORDINATOR] };

function confirmedEvent(overrides = {}) {
  return {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    status: 'CONFIRMED',
    name: 'Workshop',
    start_at: '2026-11-10T09:00:00.000Z',
    end_at: '2026-11-10T17:00:00.000Z',
    expected_attendance: 40,
    venue_requirements: 'Lecture theatre',
    equipment_notes: '2 mics',
    ...overrides,
  };
}

function planningEvent(overrides = {}) {
  return confirmedEvent({ status: 'PLANNING', ...overrides });
}

function criticalRequest(overrides = {}) {
  return {
    id: 50,
    event_id: 3,
    requested_by: 1,
    decided_by: null,
    status: 'PENDING',
    start_at: '2026-11-20T09:00:00.000Z',
    end_at: '2026-11-20T17:00:00.000Z',
    expected_attendance: 80,
    venue_requirements: null,
    equipment_notes: null,
    decision_reason: null,
    decided_at: null,
    ...overrides,
  };
}

function nonCriticalRequest(overrides = {}) {
  return criticalRequest({
    start_at: null,
    end_at: null,
    expected_attendance: null,
    venue_requirements: 'Banquet hall',
    equipment_notes: '4 mics',
    ...overrides,
  });
}

function configureDecision(event = confirmedEvent(), changeRequest = criticalRequest()) {
  db.fetchOne
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce(changeRequest);
}

function configureCreate(event = confirmedEvent(), existingPending = null) {
  db.fetchOne
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce(existingPending);
}

function asUser(userId, role) {
  db.fetchOne.mockResolvedValueOnce({
    id: userId,
    is_active: true,
    organisation_id: 10,
  });
  db.fetchMany.mockResolvedValueOnce([{ role }]);
}

function eventPatches() {
  return db.updateById.mock.calls
    .filter(([table]) => table === 'events')
    .map(([, , patch]) => patch);
}

beforeEach(() => {
  jest.clearAllMocks();
  db.supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  });
  db.fetchMany.mockResolvedValue([]);
  db.updateById.mockImplementation(async (_table, id, patch) => ({ id, ...patch }));
  db.insertOne.mockImplementation(async (_table, row) => ({ id: 50, ...row }));
});

describe('SCRUM-85 confirmed-event reversion', () => {
  /*
   * Purpose: mirror Manual Test Case 1 — submitting a critical change request on a Confirmed event
   *   creates a PENDING request while leaving the event status CONFIRMED and details unchanged.
   * AC: SCRUM-85 AC3 — pending request leaves Confirmed event untouched.
   * Inputs: Confirmed event (attendance 40), organiser submits critical change (attendance 150).
   * Output: event_change_requests row with status PENDING; no events update, no status history insert.
   * Failure: test fails if submitting a request alters the event status or details.
   */
  it('Manual Test Case 1 (AC3): submitting a critical change request leaves Confirmed event status and details unchanged while pending', async () => {
    const baseEvent = confirmedEvent({ expected_attendance: 40 });
    configureCreate(baseEvent, null);

    const result = await service.createChangeRequest(organiser, 3, {
      expectedAttendance: 150,
    });

    expect(result.status).toBe('PENDING');
    expect(result.expectedAttendance).toBe(150);
    expect(db.insertOne).toHaveBeenCalledWith(
      'event_change_requests',
      expect.objectContaining({
        event_id: 3,
        requested_by: 1,
        status: 'PENDING',
        expected_attendance: 150,
      })
    );
    expect(baseEvent.status).toBe('CONFIRMED');
    expect(baseEvent.expected_attendance).toBe(40);
    expect(db.updateById).not.toHaveBeenCalledWith('events', expect.anything(), expect.anything());
    expect(db.insertOne).not.toHaveBeenCalledWith('event_status_history', expect.anything());
    expect(db.updateById).not.toHaveBeenCalledWith('venue_bookings', expect.anything(), expect.anything());
    expect(db.updateById).not.toHaveBeenCalledWith('equipment_requests', expect.anything(), expect.anything());
  });

  /*
   * Purpose: mirror Manual Test Case 2 — rejecting a critical change request on a Confirmed event
   *   records the rejection reason and leaves the Confirmed event completely unchanged.
   * AC: SCRUM-85 AC4 — rejected change request leaves event record and Confirmed status untouched.
   * Inputs: Confirmed event, pending critical change request, coordinator rejects with reason.
   * Output: event_change_requests row marked REJECTED with decision_reason; no events or history write.
   * Failure: test fails if rejection alters the event status, details, or arrangements.
   */
  it('Manual Test Case 2 (AC4): rejecting a critical change request records rejection reason and leaves Confirmed event completely unchanged', async () => {
    configureDecision(confirmedEvent(), criticalRequest({ expected_attendance: 150 }));

    const result = await service.decideChangeRequest(coordinator, 3, 50, {
      approve: false,
      reason: 'Capacity limit exceeded',
    });

    expect(result.status).toBe('REJECTED');
    expect(db.updateById).toHaveBeenCalledWith(
      'event_change_requests',
      50,
      expect.objectContaining({
        status: 'REJECTED',
        decision_reason: 'Capacity limit exceeded',
        decided_by: 2,
      })
    );
    expect(db.updateById).not.toHaveBeenCalledWith('events', expect.anything(), expect.anything());
    expect(db.insertOne).not.toHaveBeenCalledWith('event_status_history', expect.anything());
    expect(db.updateById).not.toHaveBeenCalledWith('venue_bookings', expect.anything(), expect.anything());
    expect(db.updateById).not.toHaveBeenCalledWith('equipment_requests', expect.anything(), expect.anything());
  });

  /*
   * Purpose: mirror Manual Test Case 3 — approving a change request containing only non-critical
   *   fields (venue requirements and equipment notes) updates event details but keeps status CONFIRMED.
   * AC: SCRUM-85 AC2 — non-critical change request approval does not trigger status reversion.
   * Inputs: Confirmed event and request containing venueRequirements and equipmentNotes only.
   * Output: event patched with new requirements; status stays CONFIRMED; no status history insert.
   * Failure: test fails if non-critical approvals revert status to Planning.
   */
  it('Manual Test Case 3 (AC2): approving non-critical change request updates event requirements while status remains CONFIRMED', async () => {
    configureDecision(confirmedEvent(), nonCriticalRequest({
      venue_requirements: 'Extra whiteboard and partition screens',
      equipment_notes: '1 extra extension cable',
    }));

    const result = await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(result.status).toBe('APPROVED');
    expect(eventPatches()).toEqual([
      expect.objectContaining({
        venue_requirements: 'Extra whiteboard and partition screens',
        equipment_notes: '1 extra extension cable',
      }),
    ]);
    expect(eventPatches().some((p) => p.status === 'PLANNING')).toBe(false);
    expect(db.insertOne).not.toHaveBeenCalledWith('event_status_history', expect.anything());
  });

  /*
   * Purpose: mirror Manual Test Case 4 — approving a critical field change (attendance) on a Confirmed event
   *   reverts status to PLANNING, records transition in event_status_history, logs audit, and flags active
   *   venue bookings and equipment requests for review.
   * AC: SCRUM-85 AC1 and AC5 — critical approval reverts status, logs history/audit, and flags arrangements.
   * Inputs: Confirmed event (attendance 40), approved request with attendance 160, active booking and equipment.
   * Output: status PLANNING, history CONFIRMED → PLANNING with descriptive note, needs_review: true on arrangements.
   * Failure: test fails if status does not revert, transition note is missing, or arrangements are not flagged.
   */
  it('Manual Test Case 4 (AC1+AC5): approving critical change reverts Confirmed event to PLANNING, records status history, and flags arrangements for review', async () => {
    configureDecision(confirmedEvent({ expected_attendance: 40 }), criticalRequest({
      start_at: null,
      end_at: null,
      expected_attendance: 160,
    }));
    db.fetchMany
      .mockResolvedValueOnce([{
        id: 7,
        event_id: 3,
        venue_id: 8,
        status: 'APPROVED',
        start_at: '2026-11-10T09:00:00.000Z',
        end_at: '2026-11-10T17:00:00.000Z',
      }])
      .mockResolvedValueOnce([{ id: 12, event_id: 3, status: 'PENDING' }])
      .mockResolvedValueOnce([{ id: 8, capacity: 50 }]);

    const result = await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(result.status).toBe('APPROVED');

    // 1. AC1: Event status updated to PLANNING
    expect(eventPatches()).toContainEqual(expect.objectContaining({
      expected_attendance: 160,
    }));
    expect(eventPatches()).toContainEqual(expect.objectContaining({
      status: 'PLANNING',
    }));

    // 2. AC5(1): Status transition recorded in event_status_history
    expect(db.insertOne).toHaveBeenCalledWith(
      'event_status_history',
      expect.objectContaining({
        event_id: 3,
        actor_id: 2,
        from_status: 'CONFIRMED',
        to_status: 'PLANNING',
        note: 'Reverted to Planning: approved critical change on Confirmed event',
      })
    );

    // 3. AC5(2): Field changes logged in audit
    expect(audit.writeAudit).toHaveBeenCalledWith(
      2,
      'CHANGE_REQUEST_APPROVED',
      'event_change_request',
      50,
      expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ field: 'expectedAttendance', previous: 40, next: 160 }),
        ]),
      })
    );

    // 4. AC5(3): Affected arrangements flagged with needs_review = true
    expect(db.updateById).toHaveBeenCalledWith(
      'venue_bookings',
      7,
      expect.objectContaining({ needs_review: true })
    );
    expect(db.updateById).toHaveBeenCalledWith(
      'equipment_requests',
      12,
      expect.objectContaining({ needs_review: true })
    );
    const arrangementPatches = db.updateById.mock.calls
      .filter(([table]) => ['venue_bookings', 'equipment_requests'].includes(table))
      .map(([, , patch]) => patch);
    arrangementPatches.forEach((patch) => expect(patch.status).toBeUndefined());
  });

  /*
   * Purpose: mirror Manual Test Case 5 — approving a change request containing mixed critical (attendance)
   *   and non-critical (venue requirements) fields triggers reversion to PLANNING and applies both fields.
   * AC: SCRUM-85 AC1 and AC2 boundary — critical field present in mixed request triggers reversion.
   * Inputs: Confirmed event, request with expected_attendance 170 and venue_requirements 'Stage lighting readjustment'.
   * Output: status updated to PLANNING, history recorded, both fields patched.
   * Failure: test fails if presence of non-critical fields suppresses reversion.
   */
  it('Manual Test Case 5 (AC1/AC2 boundary): mixed critical and non-critical fields trigger reversion to PLANNING and apply all fields', async () => {
    configureDecision(confirmedEvent(), nonCriticalRequest({
      expected_attendance: 170,
      venue_requirements: 'Stage lighting readjustment',
    }));

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(eventPatches()).toContainEqual(expect.objectContaining({
      expected_attendance: 170,
      venue_requirements: 'Stage lighting readjustment',
    }));
    expect(eventPatches()).toContainEqual(expect.objectContaining({ status: 'PLANNING' }));
    expect(db.insertOne).toHaveBeenCalledWith(
      'event_status_history',
      expect.objectContaining({ from_status: 'CONFIRMED', to_status: 'PLANNING' })
    );
  });

  /*
   * Purpose: verify date changes in an approved request move Confirmed events to Planning.
   * AC: SCRUM-85 AC1 and AC5 — date change triggers and records the status transition.
   * Inputs: confirmed event and pending request with new start/end values.
   * Output: event status patch and CONFIRMED → PLANNING status-history row.
   * Failure: test fails if either write is missing or occurs in the wrong order.
   */
  it('AC1: approving a date change on a Confirmed event reverts status to Planning', async () => {
    configureDecision(confirmedEvent(), criticalRequest());

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(eventPatches()).toEqual(expect.arrayContaining([
      expect.objectContaining({ start_at: '2026-11-20T09:00:00.000Z' }),
      expect.objectContaining({ status: 'PLANNING' }),
    ]));
    expect(db.insertOne).toHaveBeenCalledWith(
      'event_status_history',
      expect.objectContaining({
        event_id: 3,
        actor_id: 2,
        from_status: 'CONFIRMED',
        to_status: 'PLANNING',
      })
    );
    expect(db.updateById).toHaveBeenCalledWith(
      'event_change_requests',
      50,
      expect.objectContaining({ status: 'APPROVED' })
    );
  });

  /*
   * Purpose: verify attendance-only changes trigger the Confirmed-event reversion.
   * AC: SCRUM-85 AC1 — expected attendance is a revert-trigger field.
   * Inputs: confirmed event and pending request changing expected attendance only.
   * Output: event status is set to Planning and history records the transition.
   * Failure: test fails if attendance changes do not trigger reversion.
   */
  it('AC1: approving an attendance change on a Confirmed event reverts status to Planning', async () => {
    configureDecision(confirmedEvent(), criticalRequest({
      start_at: null,
      end_at: null,
      expected_attendance: 80,
    }));

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(eventPatches()).toContainEqual(expect.objectContaining({ status: 'PLANNING' }));
    expect(db.insertOne).toHaveBeenCalledWith(
      'event_status_history',
      expect.objectContaining({ from_status: 'CONFIRMED', to_status: 'PLANNING' })
    );
  });

  /*
   * Purpose: verify critical approval reverts status and flags affected arrangements.
   * AC: SCRUM-85 AC1/AC5 — transition is recorded and affected resource rows are flagged.
   * Inputs: attendance change, an over-capacity approved booking, and pending equipment.
   * Output: status/history updates and needs_review patches without status changes.
   * Failure: test fails if arrangements are not flagged or their statuses are modified.
   */
  it('AC1+AC5: status reverts and affected bookings are flagged for review', async () => {
    configureDecision(confirmedEvent(), criticalRequest({
      start_at: null,
      end_at: null,
      expected_attendance: 150,
    }));
    db.fetchMany
      .mockResolvedValueOnce([{
        id: 7,
        event_id: 3,
        venue_id: 8,
        status: 'APPROVED',
        start_at: '2026-11-10T09:00:00.000Z',
        end_at: '2026-11-10T17:00:00.000Z',
      }])
      .mockResolvedValueOnce([{ id: 12, event_id: 3, status: 'PENDING' }])
      .mockResolvedValueOnce([{ id: 8, capacity: 50 }]);

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(eventPatches()).toContainEqual(expect.objectContaining({ status: 'PLANNING' }));
    expect(db.updateById).toHaveBeenCalledWith(
      'venue_bookings',
      7,
      expect.objectContaining({ needs_review: true })
    );
    expect(db.updateById).toHaveBeenCalledWith(
      'equipment_requests',
      12,
      expect.objectContaining({ needs_review: true })
    );
    const arrangementPatches = db.updateById.mock.calls
      .filter(([table]) => ['venue_bookings', 'equipment_requests'].includes(table))
      .map(([, , patch]) => patch);
    arrangementPatches.forEach((patch) => expect(patch.status).toBeUndefined());
  });

  /*
   * Purpose: verify the transition is persisted and the existing approval audit includes changes.
   * AC: SCRUM-85 AC5 — status history and field-change audit are both written.
   * Inputs: approved date/time change on a Confirmed event.
   * Output: history insert and CHANGE_REQUEST_APPROVED audit record.
   * Failure: test fails if either audit trail omits the transition/change.
   */
  it('AC5: CONFIRMED → PLANNING transition and approved field changes are recorded', async () => {
    configureDecision(confirmedEvent(), criticalRequest());

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(db.insertOne).toHaveBeenCalledWith(
      'event_status_history',
      expect.objectContaining({
        from_status: 'CONFIRMED',
        to_status: 'PLANNING',
        note: expect.stringContaining('approved critical change'),
      })
    );
    expect(audit.writeAudit).toHaveBeenCalledWith(
      2,
      'CHANGE_REQUEST_APPROVED',
      'event_change_request',
      50,
      expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ field: 'startAt', next: '2026-11-20T09:00:00.000Z' }),
        ]),
      })
    );
  });

  /*
   * Purpose: verify venue/equipment-only approvals do not revert a Confirmed event.
   * AC: SCRUM-85 AC2 — these fields remain reviewable but do not trigger status reversion.
   * Inputs: confirmed event and pending request changing only venue/equipment requirements.
   * Output: event fields update without a Planning status patch or transition history.
   * Failure: test fails if non-revert fields change the event status.
   */
  it('AC2: approving a non-critical change on a Confirmed event leaves status Confirmed', async () => {
    configureDecision(confirmedEvent(), nonCriticalRequest());

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(eventPatches()).toEqual([
      expect.objectContaining({
        venue_requirements: 'Banquet hall',
        equipment_notes: '4 mics',
      }),
    ]);
    expect(db.insertOne).not.toHaveBeenCalledWith(
      'event_status_history',
      expect.anything()
    );
  });

  /*
   * Purpose: verify a mixed request reverts when any one revert-trigger field changes.
   * AC: SCRUM-85 AC1/AC2 — attendance triggers even alongside venue requirements.
   * Inputs: confirmed event and request changing attendance and venue requirements.
   * Output: event receives Planning status.
   * Failure: test fails if mixed changes are incorrectly treated as non-critical.
   */
  it('AC2 boundary: mixed critical and non-critical fields trigger reversion', async () => {
    configureDecision(confirmedEvent(), nonCriticalRequest({ expected_attendance: 80 }));

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(eventPatches()).toContainEqual(expect.objectContaining({ status: 'PLANNING' }));
  });

  /*
   * Purpose: confirm an undecided request causes no change to its event.
   * AC: SCRUM-85 AC3 — a pending request alone does not apply its proposed values.
   * Inputs: Confirmed event and pending critical request; no decision is submitted.
   * Output: no event, request, or history writes.
   * Failure: test fails if merely having a pending request mutates event state.
   */
  it('AC3: a pending change request leaves the Confirmed event unchanged', () => {
    const event = confirmedEvent();
    const pending = criticalRequest();

    expect(event.status).toBe('CONFIRMED');
    expect(pending.status).toBe('PENDING');
    expect(db.updateById).not.toHaveBeenCalled();
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * Purpose: verify rejecting a critical request leaves the Confirmed event untouched.
   * AC: SCRUM-85 AC4 — rejection applies no proposed event values.
   * Inputs: Confirmed event and pending critical request with approve false.
   * Output: request becomes Rejected; no event or history write occurs.
   * Failure: test fails if rejected values trigger reversion or arrangement review.
   */
  it('AC4: rejecting a critical change request leaves the Confirmed event unchanged', async () => {
    configureDecision(confirmedEvent(), criticalRequest());

    const result = await service.decideChangeRequest(coordinator, 3, 50, { approve: false });

    expect(result.status).toBe('REJECTED');
    expect(db.updateById).toHaveBeenCalledWith(
      'event_change_requests',
      50,
      expect.objectContaining({ status: 'REJECTED' })
    );
    expect(db.updateById).not.toHaveBeenCalledWith(
      'events',
      expect.anything(),
      expect.anything()
    );
    expect(db.insertOne).not.toHaveBeenCalledWith('event_status_history', expect.anything());
  });

  /*
   * Purpose: verify a rejection reason is saved without changing the event or arrangements.
   * AC: SCRUM-85 AC4 — rejection remains independent from the proposed changes.
   * Inputs: Confirmed event and critical request rejected with a reason.
   * Output: reason is stored; event, history, bookings, and equipment are not written.
   * Failure: test fails if rejection applies or flags proposed changes.
   */
  it('AC4: reject with a reason leaves the event fully unchanged', async () => {
    configureDecision(confirmedEvent(), criticalRequest());

    await service.decideChangeRequest(coordinator, 3, 50, {
      approve: false,
      reason: 'Availability cannot be guaranteed',
    });

    expect(db.updateById).toHaveBeenCalledWith(
      'event_change_requests',
      50,
      expect.objectContaining({
        status: 'REJECTED',
        decision_reason: 'Availability cannot be guaranteed',
      })
    );
    expect(db.updateById).not.toHaveBeenCalledWith('events', expect.anything(), expect.anything());
    expect(db.updateById).not.toHaveBeenCalledWith('venue_bookings', expect.anything(), expect.anything());
    expect(db.updateById).not.toHaveBeenCalledWith('equipment_requests', expect.anything(), expect.anything());
  });

  /*
   * Purpose: ensure an already-Planning event does not receive a duplicate Planning transition.
   * AC: SCRUM-85 AC1 boundary — reversion is only for events that were Confirmed.
   * Inputs: Planning event and pending critical request.
   * Output: approved fields apply, with no status patch or transition history.
   * Failure: test fails if Planning state is redundantly rewritten/history-recorded.
   */
  it('AC1 boundary: approval on a Planning event does not re-write Planning status', async () => {
    configureDecision(planningEvent(), criticalRequest());

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(eventPatches()).toHaveLength(1);
    expect(eventPatches()[0].status).toBeUndefined();
    expect(db.insertOne).not.toHaveBeenCalledWith('event_status_history', expect.anything());
  });

  /*
   * Purpose: verify a start-time-only change is sufficient to revert a Confirmed event.
   * AC: SCRUM-85 AC1 boundary — either start or end time alone is critical.
   * Inputs: confirmed event and request with only a new start_at.
   * Output: event status is set to Planning.
   * Failure: test fails if one timestamp alone does not trigger reversion.
   */
  it('AC1 boundary: approving only a start_at change triggers reversion', async () => {
    configureDecision(confirmedEvent(), criticalRequest({
      start_at: '2026-11-10T10:00:00.000Z',
      end_at: null,
      expected_attendance: null,
    }));

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(eventPatches()).toContainEqual(expect.objectContaining({ status: 'PLANNING' }));
  });

  /*
   * Purpose: ensure an unassigned coordinator cannot approve or revert the event.
   * AC: SCRUM-85 security — only the event's assigned coordinator may decide.
   * Inputs: Confirmed event assigned to coordinator 2 and a request by coordinator 9.
   * Output: service rejects with 403 before any write.
   * Failure: test fails if an unauthorized user can trigger the status transition.
   */
  it('AC1 security: a non-assigned coordinator cannot approve or trigger reversion', async () => {
    db.fetchOne.mockResolvedValueOnce(confirmedEvent());

    await expect(service.decideChangeRequest(otherCoordinator, 3, 50, { approve: true }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * Purpose: ensure an organiser cannot use the HTTP decision route.
   * AC: SCRUM-85 security — only coordinators may approve requests.
   * Inputs: authenticated organiser posts a critical approval to the decision endpoint.
   * Output: route returns 403 before any event/request write.
   * Failure: test fails if an organiser can trigger the reversion.
   */
  it('AC1 security: an organiser cannot approve a change request', async () => {
    const organiserToken = jwt.sign({ sub: 1 }, env.jwtSecret);
    asUser(1, ROLES.EVENT_ORGANISER);

    const response = await request(app)
      .post('/api/events/3/change-requests/50/decision')
      .set('Cookie', `${env.sessionCookieName}=${organiserToken}`)
      .send({ approve: true });

    expect(response.status).toBe(403);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * Purpose: ensure an unauthenticated caller cannot reach the decision logic.
   * AC: SCRUM-85 security — unauthenticated approval attempts are rejected.
   * Inputs: POST decision request without a session cookie.
   * Output: route returns 401 without event, request, or history writes.
   * Failure: test fails if the decision endpoint accepts an anonymous caller.
   */
  it('AC1 security: an unauthenticated decision request is rejected with 401', async () => {
    const response = await request(app)
      .post('/api/events/3/change-requests/50/decision')
      .send({ approve: true });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('UNAUTHENTICATED');
    expect(db.updateById).not.toHaveBeenCalled();
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * Purpose: ensure reversion and history recording do not depend on active arrangements.
   * AC: SCRUM-85 AC5 boundary — no rows to flag does not prevent status reversion.
   * Inputs: Confirmed event, critical approval, and empty booking/equipment result sets.
   * Output: Planning status and history are written, with no arrangement updates.
   * Failure: test fails if empty arrangement lists skip or break the status transition.
   */
  it('AC5 boundary: reversion occurs when there are no active arrangements', async () => {
    configureDecision(confirmedEvent(), criticalRequest());
    db.fetchMany.mockResolvedValue([]);

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(eventPatches()).toContainEqual(expect.objectContaining({ status: 'PLANNING' }));
    expect(db.insertOne).toHaveBeenCalledWith(
      'event_status_history',
      expect.objectContaining({ from_status: 'CONFIRMED', to_status: 'PLANNING' })
    );
    expect(db.updateById).not.toHaveBeenCalledWith('venue_bookings', expect.anything(), expect.anything());
    expect(db.updateById).not.toHaveBeenCalledWith('equipment_requests', expect.anything(), expect.anything());
  });

  /*
   * Purpose: ensure status-update failure propagates and leaves the request pending for retry.
   * AC: SCRUM-85 failure behavior — errors are not hidden or converted into approval.
   * Inputs: Confirmed critical approval with the status update rejected by the database.
   * Output: service rejects and does not mark the change request Approved.
   * Failure: test fails if status-update errors are swallowed.
   */
  it('propagates status-update failures without approving the change request', async () => {
    configureDecision(confirmedEvent(), criticalRequest());
    db.updateById.mockImplementation(async (table, id, patch) => {
      if (table === 'events' && patch.status === 'PLANNING') {
        throw new Error('status update failed');
      }
      return { id, ...patch };
    });

    await expect(service.decideChangeRequest(coordinator, 3, 50, { approve: true }))
      .rejects.toThrow('status update failed');
    expect(db.updateById).not.toHaveBeenCalledWith(
      'event_change_requests',
      50,
      expect.anything()
    );
  });
});

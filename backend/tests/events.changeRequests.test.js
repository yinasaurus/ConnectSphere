/**
 * SCRUM-34: Event Organiser requests a change after submission.
 * SCRUM-35: Assigned Event Coordinator reviews and decides that request.
 *
 *   SCRUM-34 AC1  Organiser can request a change; unassigned Submitted is refused.
 *   SCRUM-34 AC2  Only date/time, expected attendance, venue requirements and equipment
 *                 requirements may be proposed.
 *   SCRUM-35 AC1  Only the assigned coordinator can approve or reject.
 *   SCRUM-35 AC2  Approve copies the proposed fields onto the event (including Confirmed);
 *                 reject leaves the event unchanged. Event status is not moved.
 *   SCRUM-69 AC1  Approve writes every included field onto the event.
 *   SCRUM-69 AC2  Approve is refused when requested values are invalid.
 *   SCRUM-69 AC3  Reject still leaves the event unchanged.
 *   SCRUM-69 AC4  Approve audit records who, when, and previous/new per field.
 *   SCRUM-69 AC5  Approve flags affected venue/equipment rows for review (SCRUM-41/42).
 *   SCRUM-69 AC6  Organiser is notified on approve and on reject.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  updateById: jest.fn(),
  insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));

const db = require('../src/config/db');
const audit = require('../src/services/audit.service');
const service = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const otherCoordinator = { id: 9, roles: [ROLES.EVENT_COORDINATOR] };
const venueStaff = { id: 6, roles: [ROLES.VENUE_STAFF] };

const WINDOW = {
  startAt: '2026-11-20T09:00:00.000Z',
  endAt: '2026-11-20T17:00:00.000Z',
};

function planningEvent(overrides = {}) {
  return {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    status: 'PLANNING',
    name: 'Workshop',
    start_at: '2026-11-10T09:00:00.000Z',
    end_at: '2026-11-10T17:00:00.000Z',
    expected_attendance: 40,
    venue_requirements: 'Lecture theatre',
    equipment_notes: '2 mics',
    ...overrides,
  };
}

function pendingRequest(overrides = {}) {
  return {
    id: 50,
    event_id: 3,
    requested_by: 1,
    decided_by: null,
    status: 'PENDING',
    start_at: WINDOW.startAt,
    end_at: WINDOW.endAt,
    expected_attendance: 80,
    venue_requirements: 'Banquet',
    equipment_notes: '4 mics',
    decision_reason: null,
    decided_at: null,
    ...overrides,
  };
}

let event;

beforeEach(() => {
  jest.clearAllMocks();
  event = planningEvent();
  db.supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  });
  db.fetchOne.mockImplementation(async () => event);
  db.fetchMany.mockResolvedValue([]);
  db.updateById.mockImplementation(async (_table, id, patch) => ({ id, ...patch }));
  db.insertOne.mockImplementation(async (_table, row) => ({ id: 50, ...row }));
});

describe('SCRUM-34 createChangeRequest', () => {
  /*
   * AC:       SCRUM-34 AC1 + AC2
   * Scenario: Organiser proposes a new window, attendance and venue/equipment notes.
   * Setup:    Planning event owned by user 1, assigned to coordinator 2; no pending request.
   * Expected: A PENDING row is written with only those fields; audit is CHANGE_REQUEST_CREATED.
   * Type:     normal
   */
  // SCRUM-34-TC01
  it('AC1+AC2: organiser can request permitted date, attendance, venue and equipment changes', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(null);

    const result = await service.createChangeRequest(organiser, 3, {
      startAt: WINDOW.startAt,
      endAt: WINDOW.endAt,
      expectedAttendance: 80,
      venueRequirements: 'Banquet',
      equipmentNotes: '4 mics',
    });

    expect(result.status).toBe('PENDING');
    expect(db.insertOne).toHaveBeenCalledWith(
      'event_change_requests',
      expect.objectContaining({
        event_id: 3,
        requested_by: 1,
        status: 'PENDING',
        expected_attendance: 80,
        venue_requirements: 'Banquet',
        equipment_notes: '4 mics',
      })
    );
    expect(audit.writeAudit).toHaveBeenCalledWith(
      1,
      'CHANGE_REQUEST_CREATED',
      'event_change_request',
      50,
      expect.objectContaining({ eventId: 3 })
    );
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC2
   * Scenario: Organiser includes a field that is not in the permitted set.
   * Setup:    Same Planning event; payload also has accessibilityNeeds.
   * Expected: 400; nothing is inserted.
   * Type:     negative
   */
  // SCRUM-34-TC02
  it('AC2: unknown fields are refused', async () => {
    await expect(service.createChangeRequest(organiser, 3, {
      expectedAttendance: 80,
      accessibilityNeeds: 'Step-free',
    })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC2
   * Scenario: Organiser posts an empty body.
   * Expected: 400; nothing is inserted.
   * Type:     boundary
   */
  // SCRUM-34-TC03
  it('AC2: at least one permitted field is required', async () => {
    await expect(service.createChangeRequest(organiser, 3, {})).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Organiser tries to change a Draft (they should edit the draft instead).
   * Expected: 409 CHANGE_NOT_ALLOWED; nothing is inserted.
   * Type:     negative
   */
  // SCRUM-34-TC04, 5, 6, 7
  it.each(['DRAFT', 'CANCELLED', 'REJECTED', 'COMPLETED'])(
    'AC1: %s events cannot receive a change request',
    async (status) => {
      event = planningEvent({ status });
      db.fetchOne.mockImplementation(async () => event);
      await expect(service.createChangeRequest(organiser, 3, { expectedAttendance: 80 }))
        .rejects.toMatchObject({ status: 409, code: 'CHANGE_NOT_ALLOWED' });
      expect(db.insertOne).not.toHaveBeenCalled();
    }
  );

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Submitted event still in the unassigned queue.
   * Expected: 409 NO_COORDINATOR; nothing is inserted.
   * Type:     negative
   */
  // SCRUM-34-TC08
  it('AC1: unassigned Submitted events cannot receive a change request', async () => {
    event = planningEvent({ status: 'SUBMITTED', coordinator_id: null });
    db.fetchOne.mockImplementation(async () => event);
    await expect(service.createChangeRequest(organiser, 3, { expectedAttendance: 80 }))
      .rejects.toMatchObject({ status: 409, code: 'NO_COORDINATOR' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: A PENDING change request already exists for the event.
   * Expected: 409 PENDING_CHANGE_EXISTS.
   * Type:     negative
   */
  // SCRUM-34-TC09
  it('AC1: a second pending request is refused', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 49, status: 'PENDING' });
    await expect(service.createChangeRequest(organiser, 3, { expectedAttendance: 80 }))
      .rejects.toMatchObject({ status: 409, code: 'PENDING_CHANGE_EXISTS' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Assigned coordinator (not the owner) tries to create a request.
   * Expected: 403; event and table unchanged.
   * Type:     security
   */
  // SCRUM-34-TC10
  it('AC1: only the owning organiser can create a change request', async () => {
    await expect(service.createChangeRequest(coordinator, 3, { expectedAttendance: 80 }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC2
   * Scenario: Organiser sends a start that is not a real timestamp.
   * Setup:    startAt is the string "not-a-date".
   * Expected: 400 before insert, so a junk window cannot be stored.
   * Type:     negative
   */
  // SCRUM-34-TC11
  it('AC2: an invalid date is refused', async () => {
    await expect(service.createChangeRequest(organiser, 3, { startAt: 'not-a-date' }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC2
   * Scenario: Organiser sends attendance 0 (not a usable headcount).
   * Expected: 400; nothing is inserted.
   * Type:     boundary
   */
  // SCRUM-34-TC12
  it('AC2: attendance below 1 is refused', async () => {
    await expect(service.createChangeRequest(organiser, 3, { expectedAttendance: 0 }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Organiser proposes only a new start, after the event's existing end.
   * Setup:    Event ends 17:00; payload startAt is 18:00 the same day.
   * Expected: 400 so the pending row cannot hold an impossible window.
   * Type:     negative
   */
  // SCRUM-34-TC13
  it('AC1: a proposed start after the event end is refused', async () => {
    await expect(service.createChangeRequest(organiser, 3, {
      startAt: '2026-11-10T18:00:00.000Z',
    })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Organiser of another organisation guesses this event id.
   * Expected: 404, same as getEvent, so the row is not revealed.
   * Type:     security
   */
  // SCRUM-34-TC14
  it('AC1: a hidden event is 404', async () => {
    const stranger = { id: 99, organisationId: 99, roles: [ROLES.EVENT_ORGANISER] };
    await expect(service.createChangeRequest(stranger, 3, { expectedAttendance: 80 }))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(db.insertOne).not.toHaveBeenCalled();
  });
});

describe('SCRUM-35 decideChangeRequest', () => {
  /*
   * AC:       SCRUM-35 AC1 + AC2
   * Scenario: Assigned coordinator approves a pending request on a Planning event.
   * Setup:    Request proposes new times, attendance, venue and equipment notes.
   * Expected: Those columns are written onto the event; status stays PLANNING; request APPROVED.
   *           The organiser is notified (SCRUM-69 AC6).
   * Type:     normal
   */
  it('AC1+AC2: assigned coordinator approve copies proposed fields and leaves status', async () => {
    const pending = pendingRequest();
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pending);

    const result = await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(result.status).toBe('APPROVED');
    expect(db.updateById).toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({
        start_at: WINDOW.startAt,
        end_at: WINDOW.endAt,
        expected_attendance: 80,
        venue_requirements: 'Banquet',
        equipment_notes: '4 mics',
      })
    );
    expect(db.updateById).toHaveBeenCalledWith(
      'event_change_requests',
      50,
      expect.objectContaining({
        status: 'APPROVED',
        decided_by: 2,
        decided_at: expect.any(String),
      })
    );
    const eventPatch = db.updateById.mock.calls.find((call) => call[0] === 'events')[2];
    expect(eventPatch.status).toBeUndefined();
    expect(audit.writeAudit).toHaveBeenCalledWith(
      2,
      'CHANGE_REQUEST_APPROVED',
      'event_change_request',
      50,
      expect.objectContaining({ eventId: 3 })
    );
    // SCRUM-69 AC6: decide notifies the organiser (create still does not).
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'CHANGE_REQUEST_DECIDED',
      'Change request approved',
      expect.stringContaining('Workshop'),
      3
    );
  });

  /*
   * AC:       SCRUM-35 AC2
   * Scenario: Assigned coordinator approves a request on a Confirmed event.
   * Setup:    Event CONFIRMED; request changes start/end. Direct PATCH would be EDIT_LOCKED.
   * Expected: events row is updated via updateById (the change-request path), status stays CONFIRMED.
   * Type:     normal
   */
  it('AC2: approving a Confirmed change request updates fields without using updateEvent', async () => {
    event = planningEvent({ status: 'CONFIRMED' });
    const pending = pendingRequest({
      expected_attendance: null,
      venue_requirements: null,
      equipment_notes: null,
    });
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pending);

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(db.updateById).toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({
        start_at: WINDOW.startAt,
        end_at: WINDOW.endAt,
      })
    );
    const eventPatch = db.updateById.mock.calls.find((call) => call[0] === 'events')[2];
    expect(eventPatch.status).toBeUndefined();
  });

  /*
   * AC:       SCRUM-35 AC2
   * Scenario: Assigned coordinator rejects, optionally with a reason.
   * Expected: Request REJECTED with the reason; events table is not written.
   *           The organiser is notified (SCRUM-69 AC6).
   * Type:     normal
   */
  it('AC2: reject leaves the event unchanged and stores an optional reason', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest());

    const result = await service.decideChangeRequest(coordinator, 3, 50, {
      approve: false,
      reason: 'Venue already booked that week',
    });

    expect(result.status).toBe('REJECTED');
    expect(db.updateById).toHaveBeenCalledWith(
      'event_change_requests',
      50,
      expect.objectContaining({
        status: 'REJECTED',
        decided_by: 2,
        decided_at: expect.any(String),
        decision_reason: 'Venue already booked that week',
      })
    );
    expect(db.updateById).not.toHaveBeenCalledWith('events', expect.anything(), expect.anything());
    expect(db.updateById).not.toHaveBeenCalledWith('venue_bookings', expect.anything(), expect.anything());
    expect(db.updateById).not.toHaveBeenCalledWith('equipment_requests', expect.anything(), expect.anything());
    expect(audit.writeAudit).toHaveBeenCalledWith(
      2,
      'CHANGE_REQUEST_REJECTED',
      'event_change_request',
      50,
      expect.objectContaining({ eventId: 3, reason: 'Venue already booked that week' })
    );
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'CHANGE_REQUEST_DECIDED',
      'Change request rejected',
      expect.stringContaining('Venue already booked that week'),
      3
    );
  });

  /*
   * AC:       SCRUM-35 AC1
   * Scenario: Another coordinator, or venue staff, tries to decide.
   * Expected: 403; no writes.
   * Type:     security
   */
  it.each([
    ['another coordinator', otherCoordinator],
    ['venue staff', venueStaff],
    ['organiser', organiser],
  ])('AC1: %s cannot decide a change request', async (_label, actor) => {
    await expect(service.decideChangeRequest(actor, 3, 50, { approve: true }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-35 AC1
   * Scenario: Coordinator decides a request that is already APPROVED.
   * Expected: 409 ALREADY_DECIDED; event not written again.
   * Type:     negative
   */
  it('AC1: an already decided request cannot be decided again', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({ status: 'APPROVED' }));

    await expect(service.decideChangeRequest(coordinator, 3, 50, { approve: false }))
      .rejects.toMatchObject({ status: 409, code: 'ALREADY_DECIDED' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-35 AC1
   * Scenario: Decision path for a request id that does not exist, or belongs to another event.
   * Expected: 404; the event is not patched.
   * Type:     negative
   */
  it('AC1: a missing change request is 404', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(null);
    await expect(service.decideChangeRequest(coordinator, 3, 50, { approve: true }))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-35 AC1
   * Scenario: Request id exists but its event_id is not this event.
   * Expected: 404, so a coordinator cannot decide another event's request via this URL.
   * Type:     security
   */
  it('AC1: a change request for another event is 404', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({ event_id: 99 }));
    await expect(service.decideChangeRequest(coordinator, 3, 50, { approve: true }))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

describe('SCRUM-69 decideChangeRequest apply', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  /*
   * AC:       SCRUM-69 AC1
   * Scenario: Request includes only attendance; date/venue/equipment on the request are null.
   * Setup:    Planning event attendance 40; pending row expected_attendance 80 and other
   *           proposed columns null (those fields were not requested).
   * Expected: Only expected_attendance is written onto the event; start/end/notes stay off
   *           the patch so they are not blanked.
   * Type:     normal
   */
  it('AC1: only the fields included in the request are written onto the event', async () => {
    const pending = pendingRequest({
      start_at: null,
      end_at: null,
      venue_requirements: null,
      equipment_notes: null,
      expected_attendance: 80,
    });
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pending);

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    const eventPatch = db.updateById.mock.calls.find((call) => call[0] === 'events')[2];
    expect(eventPatch.expected_attendance).toBe(80);
    expect(eventPatch).not.toHaveProperty('start_at');
    expect(eventPatch).not.toHaveProperty('end_at');
    expect(eventPatch).not.toHaveProperty('venue_requirements');
    expect(eventPatch).not.toHaveProperty('equipment_notes');
  });

  /*
   * AC:       SCRUM-69 AC2
   * Scenario: Pending row has attendance 0 (not a usable headcount).
   * Expected: 400; event and request stay unwritten so the request remains PENDING.
   * Type:     boundary
   */
  it('AC2: attendance of 0 cannot be approved', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({ expected_attendance: 0 }));

    await expect(service.decideChangeRequest(coordinator, 3, 50, { approve: true }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-69 AC2
   * Scenario: Pending row has negative attendance.
   * Expected: 400; nothing is written.
   * Type:     error
   */
  it('AC2: negative attendance cannot be approved', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({ expected_attendance: -1 }));

    await expect(service.decideChangeRequest(coordinator, 3, 50, { approve: true }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-69 AC2
   * Scenario: Pending row has a fractional attendance (not a whole headcount).
   * Expected: 400; nothing is written.
   * Type:     error
   */
  it('AC2: a fractional attendance cannot be approved', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({ expected_attendance: 1.5 }));

    await expect(service.decideChangeRequest(coordinator, 3, 50, { approve: true }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-69 AC2
   * Scenario: Stored start is not a real timestamp.
   * Expected: 400; junk dates cannot be copied onto the event.
   * Type:     error
   */
  it('AC2: an invalid start date cannot be approved', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({ start_at: 'not-a-date' }));

    await expect(service.decideChangeRequest(coordinator, 3, 50, { approve: true }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-69 AC2
   * Scenario: Stored end is not a real timestamp.
   * Setup:    end_at is "not-a-date"; start is a valid future time.
   * Expected: 400 before any write — junk ends must not be copied onto the event
   *           (validateDateRange used to skip NaN and let the patch through).
   * Type:     error
   */
  it('AC2: an invalid end date cannot be approved', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({ end_at: 'not-a-date' }));

    await expect(service.decideChangeRequest(coordinator, 3, 50, { approve: true }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-69 AC2
   * Scenario: Requested start is before the moment of approve.
   * Setup:    now is 15 Oct 2026 12:00 UTC; request start is 14 Oct 2026.
   * Expected: 400; request stays PENDING.
   * Type:     error
   */
  it('AC2: a start date/time in the past cannot be approved', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({
        start_at: '2026-10-14T09:00:00.000Z',
        end_at: '2026-10-14T17:00:00.000Z',
      }));

    await expect(service.decideChangeRequest(coordinator, 3, 50, { approve: true }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.updateById).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  /*
   * AC:       SCRUM-69 AC2
   * Scenario: Requested start is exactly the approve time (not yet in the past).
   * Setup:    now and start_at are both 15 Oct 2026 12:00 UTC.
   * Expected: Approve proceeds; start is written.
   * Type:     boundary
   */
  it('AC2: a start equal to now can be approved', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    const pending = pendingRequest({
      start_at: '2026-10-15T12:00:00.000Z',
      end_at: '2026-10-15T17:00:00.000Z',
    });
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pending);

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(db.updateById).toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({ start_at: '2026-10-15T12:00:00.000Z' })
    );
    jest.useRealTimers();
  });

  /*
   * AC:       SCRUM-69 AC2
   * Scenario: Request has no start; the event's existing start is already in the past.
   * Setup:    Event start 10 Nov is before now 20 Nov; request only changes attendance.
   * Expected: Approve is allowed — AC2 checks requested values, not the current event.
   * Type:     boundary
   */
  it('AC2: an existing past start does not block approve when start was not requested', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-20T12:00:00.000Z'));
    event = planningEvent();
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({
        start_at: null,
        end_at: null,
        venue_requirements: null,
        equipment_notes: null,
        expected_attendance: 80,
      }));

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(db.updateById).toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({ expected_attendance: 80 })
    );
    jest.useRealTimers();
  });

  /*
   * AC:       SCRUM-69 AC2
   * Scenario: Requested start is after the requested end.
   * Expected: 400 from the merged-window check; event not written.
   * Type:     error
   */
  it('AC2: an end before the start cannot be approved', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({
        start_at: '2026-11-20T17:00:00.000Z',
        end_at: '2026-11-20T09:00:00.000Z',
      }));

    await expect(service.decideChangeRequest(coordinator, 3, 50, { approve: true }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-69 AC3
   * Scenario: Coordinator rejects a request whose attendance would be invalid if approved.
   * Setup:    expected_attendance 0 on the pending row.
   * Expected: Request REJECTED; events table is not written (invalid values do not apply).
   * Type:     conflict
   */
  it('AC3: reject leaves the event unchanged even when requested values would be invalid', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({ expected_attendance: 0 }));

    const result = await service.decideChangeRequest(coordinator, 3, 50, { approve: false });

    expect(result.status).toBe('REJECTED');
    expect(db.updateById).not.toHaveBeenCalledWith('events', expect.anything(), expect.anything());
    expect(db.updateById).not.toHaveBeenCalledWith('venue_bookings', expect.anything(), expect.anything());
    expect(db.updateById).not.toHaveBeenCalledWith('equipment_requests', expect.anything(), expect.anything());
    expect(db.updateById).toHaveBeenCalledWith(
      'event_change_requests',
      50,
      expect.objectContaining({ status: 'REJECTED' })
    );
  });

  /*
   * AC:       SCRUM-69 AC4
   * Scenario: Approve a request that changes every permitted field.
   * Setup:    Event has the planning defaults; request has WINDOW / 80 / Banquet / 4 mics.
   * Expected: Audit CHANGE_REQUEST_APPROVED includes decidedBy, decidedAt, and previous/new
   *           for each included field.
   * Type:     normal
   */
  it('AC4: approve audit records who, when, and previous and new values per field', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest());

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(audit.writeAudit).toHaveBeenCalledWith(
      2,
      'CHANGE_REQUEST_APPROVED',
      'event_change_request',
      50,
      expect.objectContaining({
        eventId: 3,
        decidedBy: 2,
        decidedAt: expect.any(String),
        fields: [
          { field: 'startAt', previous: event.start_at, next: WINDOW.startAt },
          { field: 'endAt', previous: event.end_at, next: WINDOW.endAt },
          { field: 'expectedAttendance', previous: 40, next: 80 },
          { field: 'venueRequirements', previous: 'Lecture theatre', next: 'Banquet' },
          { field: 'equipmentNotes', previous: '2 mics', next: '4 mics' },
        ],
      })
    );
  });

  /*
   * AC:       SCRUM-69 AC4
   * Scenario: Approve a request that includes only attendance.
   * Expected: Audit fields array has only expectedAttendance (omitted columns are not listed).
   * Type:     boundary
   */
  /*
   * AC:       SCRUM-69 AC4
   * Scenario: Supabase returns Date objects for timestamps instead of ISO strings.
   * Setup:    Event and request start/end are Date instances.
   * Expected: Audit previous/next are ISO strings so the log is JSON-safe.
   * Type:     boundary
   */
  it('AC4: Date values in the request are stored as ISO strings in the audit', async () => {
    const start = new Date('2026-11-20T09:00:00.000Z');
    const end = new Date('2026-11-20T17:00:00.000Z');
    const existingStart = new Date('2026-11-10T09:00:00.000Z');
    event = planningEvent({ start_at: existingStart, end_at: new Date('2026-11-10T17:00:00.000Z') });
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({ start_at: start, end_at: end }));

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    const approved = audit.writeAudit.mock.calls.find((call) => call[1] === 'CHANGE_REQUEST_APPROVED');
    const metadata = approved[4];
    expect(metadata.fields.find((row) => row.field === 'startAt')).toEqual({
      field: 'startAt',
      previous: existingStart.toISOString(),
      next: start.toISOString(),
    });
  });

  it('AC4: audit lists only the fields included in the request', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({
        start_at: null,
        end_at: null,
        venue_requirements: null,
        equipment_notes: null,
        expected_attendance: 80,
      }));

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    const approved = audit.writeAudit.mock.calls.find((call) => call[1] === 'CHANGE_REQUEST_APPROVED');
    const metadata = approved[4];
    expect(metadata.fields).toEqual([
      { field: 'expectedAttendance', previous: 40, next: 80 },
    ]);
  });

  /*
   * AC:       SCRUM-69 AC5 / SCRUM-41 AC3 / SCRUM-42 AC1 + AC2
   * Scenario: Approve an attendance-only change that a booked room cannot hold.
   * Setup:    Attendance 40 → 80; one APPROVED booking at a 50-capacity venue; one PENDING
   *           equipment request.
   * Expected: Event and request are written; the booking and equipment row get needs_review
   *           true; their status is not in the patch (W4).
   * Type:     normal
   */
  it('AC5: approve flags over-capacity venue booking and equipment for review', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({
        start_at: null,
        end_at: null,
        venue_requirements: null,
        equipment_notes: null,
        expected_attendance: 80,
      }));
    db.fetchMany
      .mockResolvedValueOnce([{
        id: 7, event_id: 3, venue_id: 8, status: 'APPROVED',
        start_at: event.start_at, end_at: event.end_at,
      }])
      .mockResolvedValueOnce([{ id: 12, event_id: 3, status: 'PENDING' }])
      .mockResolvedValueOnce([{ id: 8, capacity: 50 }]);

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(db.updateById).toHaveBeenCalledWith(
      'venue_bookings',
      7,
      expect.objectContaining({ needs_review: true })
    );
    const bookingPatch = db.updateById.mock.calls.find((call) => call[0] === 'venue_bookings')[2];
    expect(bookingPatch.status).toBeUndefined();
    expect(db.updateById).toHaveBeenCalledWith(
      'equipment_requests',
      12,
      expect.objectContaining({ needs_review: true })
    );
    const equipmentPatch = db.updateById.mock.calls.find((call) => call[0] === 'equipment_requests')[2];
    expect(equipmentPatch.status).toBeUndefined();
  });

  /*
   * AC:       SCRUM-69 AC6
   * Scenario: Approve a valid request.
   * Expected: One CHANGE_REQUEST_DECIDED notice to the event organiser, after the writes.
   * Type:     normal
   */
  it('AC6: the organiser is notified when the request is approved', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest());

    await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'CHANGE_REQUEST_DECIDED',
      'Change request approved',
      'Your change request for Workshop was approved. The event record has been updated.',
      3
    );
  });

  /*
   * AC:       SCRUM-69 AC6
   * Scenario: Reject with no reason.
   * Expected: Organiser is still notified; body has no reason line.
   * Type:     normal
   */
  it('AC6: the organiser is notified when the request is rejected', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest());

    await service.decideChangeRequest(coordinator, 3, 50, { approve: false });

    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'CHANGE_REQUEST_DECIDED',
      'Change request rejected',
      'Your change request for Workshop was rejected.',
      3
    );
  });

  /*
   * AC:       SCRUM-69 AC6
   * Scenario: Event has no organiser_id.
   * Expected: Decision still saves; notifyUser is called with a falsy user id and no-ops.
   * Type:     boundary
   */
  it('AC6: a missing organiser still records the decision', async () => {
    event = planningEvent({ organiser_id: null });
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest());

    const result = await service.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(result.status).toBe('APPROVED');
    expect(audit.notifyUser).toHaveBeenCalledWith(
      null,
      'CHANGE_REQUEST_DECIDED',
      'Change request approved',
      expect.any(String),
      3
    );
  });
});

describe('SCRUM-34/35 listChangeRequests', () => {
  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Owning organiser lists change requests for their event.
   * Setup:    One PENDING row for event 3.
   * Expected: That row is returned (organiser can see what they submitted).
   * Type:     normal
   */
  // SCRUM-34-TC15
  it('owner can list requests', async () => {
    db.fetchMany.mockResolvedValue([pendingRequest()]);
    const rows = await service.listChangeRequests(organiser, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(50);
  });

  /*
   * AC:       SCRUM-35 AC1
   * Scenario: Assigned coordinator lists change requests for an event they manage.
   * Setup:    Same PENDING row; caller is coordinator 2, who is assigned.
   * Expected: The row is returned so they can decide.
   * Type:     normal
   */
  it('assigned coordinator can list requests', async () => {
    db.fetchMany.mockResolvedValue([pendingRequest()]);
    const rows = await service.listChangeRequests(coordinator, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(50);
  });

  /*
   * AC:       SCRUM-35 AC1
   * Scenario: Another coordinator opens the same event.
   * Setup:    coordinator_id is 2; caller is 9.
   * Expected: 403; they do not receive the request body.
   * Type:     security
   */
  it('another coordinator cannot list change requests', async () => {
    await expect(service.listChangeRequests(otherCoordinator, 3))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});

describe('SCRUM-34/35 HTTP routes', () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const organiserToken = jwt.sign({ sub: 1 }, env.jwtSecret);
  const coordinatorToken = jwt.sign({ sub: 2 }, env.jwtSecret);

  function asUser(userId, role) {
    db.fetchOne.mockResolvedValueOnce({
      id: userId,
      is_active: true,
      organisation_id: 10,
    });
    db.fetchMany.mockResolvedValueOnce([{ role }]);
  }

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Organiser posts a permitted change through Express.
   * Setup:    Session cookie for user 1; no pending request.
   * Expected: 201 PENDING; a row is inserted.
   * Type:     normal
   */
  // SCRUM-34-TC16
  it('organiser can POST a change request (201)', async () => {
    asUser(1, ROLES.EVENT_ORGANISER);
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/events/3/change-requests')
      .set('Cookie', `${env.sessionCookieName}=${organiserToken}`)
      .send({ expectedAttendance: 80 });

    expect(res.status).toBe(201);
    expect(res.body.changeRequest.status).toBe('PENDING');
    expect(db.insertOne).toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Coordinator hits the create route (requireRole Organiser).
   * Expected: 403 before insert.
   * Type:     security
   */
  // SCRUM-34-TC17
  it('coordinator cannot POST a change request (403)', async () => {
    asUser(2, ROLES.EVENT_COORDINATOR);

    const res = await request(app)
      .post('/api/events/3/change-requests')
      .set('Cookie', `${env.sessionCookieName}=${coordinatorToken}`)
      .send({ expectedAttendance: 80 });

    expect(res.status).toBe(403);
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-35 AC1 + AC2
   * Scenario: Assigned coordinator approves through the decision route.
   * Expected: 200 APPROVED.
   * Type:     normal
   */
  it('assigned coordinator can approve through the API (200)', async () => {
    asUser(2, ROLES.EVENT_COORDINATOR);
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest());

    const res = await request(app)
      .post('/api/events/3/change-requests/50/decision')
      .set('Cookie', `${env.sessionCookieName}=${coordinatorToken}`)
      .send({ approve: true });

    expect(res.status).toBe(200);
    expect(res.body.changeRequest.status).toBe('APPROVED');
  });

  /*
   * AC:       SCRUM-69 AC2
   * Scenario: Assigned coordinator approves a request whose start is already in the past.
   * Setup:    Session cookie for coordinator 2; pending start 14 Oct 2026; now 15 Oct 2026.
   * Expected: 400; events table is not written.
   * Type:     error
   */
  it('assigned coordinator cannot approve a past start through the API (400)', async () => {
    asUser(2, ROLES.EVENT_COORDINATOR);
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(pendingRequest({
        start_at: '2020-01-01T09:00:00.000Z',
        end_at: '2020-01-01T17:00:00.000Z',
      }));

    const res = await request(app)
      .post('/api/events/3/change-requests/50/decision')
      .set('Cookie', `${env.sessionCookieName}=${coordinatorToken}`)
      .send({ approve: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-35 AC1
   * Scenario: Organiser hits the decision route (requireRole Coordinator).
   * Expected: 403; no writes.
   * Type:     security
   */
  it('organiser cannot call the decision endpoint (403)', async () => {
    asUser(1, ROLES.EVENT_ORGANISER);

    const res = await request(app)
      .post('/api/events/3/change-requests/50/decision')
      .set('Cookie', `${env.sessionCookieName}=${organiserToken}`)
      .send({ approve: true });

    expect(res.status).toBe(403);
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: No session cookie on create.
   * Expected: 401; nothing is inserted.
   * Type:     security
   */
  it('a request without a session is rejected with 401', async () => {
    const res = await request(app)
      .post('/api/events/3/change-requests')
      .send({ expectedAttendance: 80 });
    expect(res.status).toBe(401);
    expect(db.insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-35 AC1
   * Scenario: Assigned coordinator lists change requests over HTTP.
   * Setup:    Auth user 2; event assigned to 2; one PENDING row.
   * Expected: 200 with that row (controller GET path).
   * Type:     normal
   */
  it('assigned coordinator can GET change requests (200)', async () => {
    asUser(2, ROLES.EVENT_COORDINATOR);
    db.fetchOne.mockResolvedValueOnce(event);
    db.fetchMany.mockResolvedValueOnce([pendingRequest()]);

    const res = await request(app)
      .get('/api/events/3/change-requests')
      .set('Cookie', `${env.sessionCookieName}=${coordinatorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.changeRequests).toHaveLength(1);
    expect(res.body.changeRequests[0].id).toBe(50);
  });

  /*
   * AC:       SCRUM-35 AC1
   * Scenario: Another coordinator GETs the same event's change requests.
   * Expected: 403.
   * Type:     security
   */
  it('another coordinator cannot GET change requests (403)', async () => {
    const otherToken = jwt.sign({ sub: 9 }, env.jwtSecret);
    asUser(9, ROLES.EVENT_COORDINATOR);
    db.fetchOne.mockResolvedValueOnce(event);

    const res = await request(app)
      .get('/api/events/3/change-requests')
      .set('Cookie', `${env.sessionCookieName}=${otherToken}`);

    expect(res.status).toBe(403);
  });
});

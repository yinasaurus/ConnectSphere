/**
 * SCRUM-44: Receive Event Notifications (Backend Unit Tests)
 *
 * Acceptance criteria covered:
 *   AC1a Status change notifications — changeStatus() emits to organiser and coordinator
 *   AC1b Critical detail edit notifications — updateEvent() emits when start_at, end_at,
 *        or expected_attendance changes
 *   AC2  Role & Access Authorization — notifications target only organiser_id and
 *        coordinator_id; self-exclusion prevents acting user from receiving their own notice
 *   AC4  Cross-Event & Client Isolation — notifications use event-specific user IDs
 *
 * Test categories:
 *   HAPPY PATH    Normal notification emissions for status changes and detail updates
 *   SAD PATH      Non-critical field updates, unauthorized access, missing coordinator
 *   BOUNDARY      Same-value updates, self-exclusion, mixed critical/non-critical edits
 *   CROSS-CUTTING Security, isolation, multiple recipients
 */

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

const db = require('../src/config/db');
const audit = require('../src/services/audit.service');
const service = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');

const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const otherCoordinator = { id: 3, roles: [ROLES.EVENT_COORDINATOR] };

let event;
let tables;

function rowsFor(query) {
  return (tables[query.table] || [])
    .filter((row) => query.filters.every(([column, value]) => String(row[column]) === String(value)));
}

beforeEach(() => {
  jest.clearAllMocks();
  event = {
    id: 5,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    status: 'DRAFT',
    name: 'Innovation Summit',
    purpose: 'Quarterly showcase',
    description: 'A quarterly innovation event',
    start_at: '2026-11-15T09:00:00Z',
    end_at: '2026-11-15T17:00:00Z',
    expected_attendance: 150,
    venue_requirements: 'Conference room with AV',
    accessibility_needs: 'Wheelchair access',
  };
  tables = {
    events: [event],
    organisations: [{ id: 10, name: 'Acme Corp' }],
    users: [
      { id: 1, full_name: 'Aisha Rahman' },
      { id: 2, full_name: 'Ben Carter', is_active: true },
      { id: 3, full_name: 'Clara Davis', is_active: true },
    ],
    user_roles: [
      { user_id: 2, role: ROLES.EVENT_COORDINATOR },
      { user_id: 3, role: ROLES.EVENT_COORDINATOR },
    ],
    venue_bookings: [],
    equipment_requests: [],
  };

  db.supabase.from.mockImplementation((table) => {
    const query = { table, filters: [] };
    query.select = jest.fn(() => query);
    query.eq = jest.fn((column, value) => {
      query.filters.push([column, value]);
      return query;
    });
    query.is = jest.fn((column, value) => {
      query.filters.push([column, value]);
      return query;
    });
    query.in = jest.fn(() => query);
    query.order = jest.fn(() => query);
    return query;
  });

  db.fetchOne.mockImplementation(async (query) => {
    const rows = rowsFor(query);
    if (rows.length === 0) return null;
    const row = rows[0];
    // Join organisation and user names for EVENT_SELECT
    if (query.table === 'events') {
      const org = tables.organisations.find((o) => o.id === row.organisation_id);
      const org_user = tables.users.find((u) => u.id === row.organiser_id);
      const coord_user = tables.users.find((u) => u.id === row.coordinator_id);
      return {
        ...row,
        organisation: org ? { name: org.name } : null,
        organiser: org_user ? { full_name: org_user.full_name } : null,
        coordinator: coord_user ? { full_name: coord_user.full_name } : null,
      };
    }
    return row;
  });

  db.fetchMany.mockImplementation(async (query) => rowsFor(query));
  db.updateById.mockResolvedValue(event);
  db.insertOne.mockResolvedValue({ id: 999 });
});

describe('SCRUM-44 Event Notifications — Happy Path', () => {
  /*
   * AC: SCRUM-44 AC1b
   * Scenario: Happy Path — Organiser updates expectedAttendance
   * Setup: Event 5 with organiser 1 and coordinator 2; organiser changes attendance 150 -> 200
   * Expected: notifyUser called for coordinator (not organiser due to self-exclusion)
   * Type: normal
   */
  it('US44-N01: updating expectedAttendance emits notification to coordinator', async () => {
    await service.updateEvent(organiser, 5, { expectedAttendance: 200 });

    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2, // coordinator_id
      'EVENT_UPDATED',
      'Event details updated',
      'Innovation Summit has updated expected attendance.',
      5
    );
  });

  /*
   * AC: SCRUM-44 AC1b
   * Scenario: Happy Path — Coordinator updates startAt and endAt
   * Setup: Event 5 with organiser 1 and coordinator 2; coordinator changes both times
   * Expected: notifyUser called for organiser (not coordinator due to self-exclusion)
   * Type: normal
   */
  it('US44-N02: updating startAt and endAt emits notification to organiser', async () => {
    await service.updateEvent(coordinator, 5, {
      startAt: '2026-11-16T10:00:00Z',
      endAt: '2026-11-16T18:00:00Z',
    });

    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1, // organiser_id
      'EVENT_UPDATED',
      'Event details updated',
      'Innovation Summit has updated start time, end time.',
      5
    );
  });

  /*
   * AC: SCRUM-44 AC1b
   * Scenario: Happy Path — Update all three critical fields at once
   * Setup: Event 5; organiser updates start_at, end_at, and expected_attendance together
   * Expected: Single notification mentions all three changed fields; coordinator notified
   * Type: normal
   */
  it('US44-N03: updating all critical fields emits one notification listing all changes', async () => {
    await service.updateEvent(organiser, 5, {
      startAt: '2026-12-01T09:00:00Z',
      endAt: '2026-12-01T17:00:00Z',
      expectedAttendance: 250,
    });

    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2,
      'EVENT_UPDATED',
      'Event details updated',
      'Innovation Summit has updated start time, end time, expected attendance.',
      5
    );
  });

  /*
   * AC: SCRUM-44 AC1a
   * Scenario: Happy Path — Coordinator changes event status to APPROVED
   * Setup: Event 5 under review; coordinator approves it
   * Expected: Organiser receives notification; coordinator self-excluded (actor)
   * Type: normal
   */
  it('US44-N04: changing status emits notification to organiser (coordinator self-excluded)', async () => {
    event.status = 'UNDER_REVIEW';
    await service.changeStatus(coordinator, 5, 'APPROVED', 'All requirements met');

    // Organiser notification (existing + new logic)
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'EVENT_STATUS_CHANGED',
      'Event request approved',
      expect.stringContaining('Innovation Summit was approved'),
      5
    );

    // Coordinator is the actor, so self-excluded
    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
  });

  /*
   * AC: SCRUM-44 AC1a
   * Scenario: Happy Path — Coordinator rejects event from SUBMITTED status
   * Setup: Event 5 submitted with coordinator assigned yet
   * Expected: Organiser receives rejection notice (no coordinator to notify)
   * Type: normal
   */
  it('US44-N05: rejecting event emits notification with rejection reason', async () => {
    event.status = 'SUBMITTED';
    event.coordinator_id = 2;

    await service.changeStatus(coordinator, 5, 'REJECTED', 'Budget not approved by finance team');

    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'EVENT_STATUS_CHANGED',
      'Event request rejected',
      'Innovation Summit was rejected. Reason: Budget not approved by finance team',
      5
    );
  });
});

describe('SCRUM-44 Event Notifications — Sad Path', () => {
  /*
   * AC: SCRUM-44 AC1b (negative test)
   * Scenario: Sad Path — Updating non-critical field does NOT emit notification
   * Setup: Event 5; organiser updates description and specialRequests only
   * Expected: No notifyUser calls (only writeAudit for the update action)
   * Type: error
   */
  it('US44-E01: updating non-critical fields does NOT emit notifications', async () => {
    await service.updateEvent(organiser, 5, {
      description: 'Updated quarterly innovation showcase with breakout sessions',
      specialRequests: 'Extra whiteboards needed',
    });

    expect(audit.notifyUser).not.toHaveBeenCalled();
    expect(audit.writeAudit).toHaveBeenCalledWith(
      1,
      'EVENT_UPDATED',
      'event',
      5,
      expect.any(Object)
    );
  });

  /*
   * AC: SCRUM-44 AC2 (authorization)
   * Scenario: Sad Path — Unassigned coordinator cannot edit event
   * Setup: Event 5 assigned to coordinator 2; coordinator 3 attempts edit
   * Expected: 403 FORBIDDEN, no notifications emitted, event unchanged
   * Type: error
   */
  it('US44-E02: unassigned coordinator edit throws 403 and emits no notifications', async () => {
    await expect(
      service.updateEvent(otherCoordinator, 5, { expectedAttendance: 300 })
    ).rejects.toMatchObject({ status: 403 });

    expect(audit.notifyUser).not.toHaveBeenCalled();
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-44 AC1b, AC2 (robustness)
   * Scenario: Sad Path — Event has no coordinator assigned (null)
   * Setup: Event with coordinator_id = null; organiser updates critical field
   * Expected: Notification safely skipped for null coordinator, no crash
   * Type: error
   */
  it('US44-E03: updating critical field with no coordinator does not crash', async () => {
    event.coordinator_id = null;

    await service.updateEvent(organiser, 5, { expectedAttendance: 180 });

    // Only organiser in this case, but organiser is the actor so self-excluded
    expect(audit.notifyUser).not.toHaveBeenCalled();
    expect(db.updateById).toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-44 AC1a (robustness)
   * Scenario: Sad Path — Event has organiser_id = null (edge case)
   * Setup: Event with no organiser assigned; coordinator changes status
   * Expected: No crash; coordinator notification works, organiser notification skipped
   * Type: error
   */
  it('US44-E04: changing status with no organiser does not crash', async () => {
    event.organiser_id = null;
    event.status = 'UNDER_REVIEW';

    await service.changeStatus(coordinator, 5, 'APPROVED');

    // Coordinator is actor, so self-excluded; no organiser to notify
    expect(audit.notifyUser).not.toHaveBeenCalled();
    expect(db.updateById).toHaveBeenCalled();
  });
});

describe('SCRUM-44 Event Notifications — Boundary Cases', () => {
  /*
   * AC: SCRUM-44 AC1b (boundary)
   * Scenario: Boundary — Updating critical field to same value does NOT emit
   * Setup: Event 5 with expected_attendance = 150; organiser sets it to 150 again
   * Expected: No notification because value did not actually change
   * Type: boundary
   */
  it('US44-B01: updating critical field to same value does NOT emit notification', async () => {
    await service.updateEvent(organiser, 5, { expectedAttendance: 150 });

    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-44 AC2 (self-exclusion)
   * Scenario: Boundary — Organiser edits, organiser must NOT receive notification
   * Setup: Event 5; organiser updates start time
   * Expected: Only coordinator receives notification (organiser self-excluded)
   * Type: boundary
   */
  it('US44-B02: organiser editing does NOT notify organiser (self-exclusion)', async () => {
    await service.updateEvent(organiser, 5, { startAt: '2026-11-20T10:00:00Z', endAt: '2026-11-20T18:00:00Z' });

    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2, // coordinator only
      'EVENT_UPDATED',
      expect.any(String),
      expect.any(String),
      5
    );
    // Verify organiser was NOT called
    expect(audit.notifyUser).not.toHaveBeenCalledWith(
      1,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(Number)
    );
  });

  /*
   * AC: SCRUM-44 AC2 (self-exclusion)
   * Scenario: Boundary — Coordinator edits, coordinator must NOT receive notification
   * Setup: Event 5; coordinator updates expected attendance
   * Expected: Only organiser receives notification (coordinator self-excluded)
   * Type: boundary
   */
  it('US44-B03: coordinator editing does NOT notify coordinator (self-exclusion)', async () => {
    await service.updateEvent(coordinator, 5, { expectedAttendance: 200 });

    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1, // organiser only
      'EVENT_UPDATED',
      expect.any(String),
      expect.any(String),
      5
    );
    // Verify coordinator was NOT called
    expect(audit.notifyUser).not.toHaveBeenCalledWith(
      2,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(Number)
    );
  });

  /*
   * AC: SCRUM-44 AC1b (boundary)
   * Scenario: Boundary — Mixed critical and non-critical fields updated
   * Setup: Event 5; organiser updates expected_attendance (critical) and description (non-critical)
   * Expected: Notification emitted mentioning only expected attendance
   * Type: boundary
   */
  it('US44-B04: mixed critical/non-critical update mentions only critical fields', async () => {
    await service.updateEvent(organiser, 5, {
      expectedAttendance: 175,
      description: 'Now with networking session',
      specialRequests: 'Coffee bar setup',
    });

    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      2,
      'EVENT_UPDATED',
      'Event details updated',
      'Innovation Summit has updated expected attendance.',
      5
    );
  });

  /*
   * AC: SCRUM-44 AC1a (self-exclusion for status)
   * Scenario: Boundary — Coordinator changes status, coordinator self-excluded
   * Setup: Event 5 under review; coordinator 2 moves to PLANNING
   * Expected: Organiser notified; coordinator NOT notified (self-excluded)
   * Type: boundary
   */
  it('US44-B05: coordinator changing status does NOT notify themselves', async () => {
    event.status = 'APPROVED';

    await service.changeStatus(coordinator, 5, 'PLANNING');

    // Organiser notification
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'EVENT_STATUS_CHANGED',
      expect.any(String),
      expect.any(String),
      5
    );

    // Coordinator should NOT be notified (self-excluded)
    const coordinatorCalls = audit.notifyUser.mock.calls.filter(
      (call) => call[0] === 2
    );
    expect(coordinatorCalls).toHaveLength(0);
  });
});

describe('SCRUM-44 Event Notifications — Cross-Cutting (Security & Isolation)', () => {
  /*
   * AC: SCRUM-44 AC4 (cross-event isolation)
   * Scenario: Cross-Cutting — Notifications use event-specific user IDs
   * Setup: Two events with different organisers and coordinators
   * Expected: Event 5 update notifies only event 5's coordinator
   * Type: security
   */
  it('US44-C01: notifications target only event-specific organiser and coordinator', async () => {
    // Add a second event to verify isolation
    const event2 = {
      id: 6,
      organiser_id: 10,
      coordinator_id: 11,
      status: 'DRAFT',
      name: 'Other Event',
      start_at: '2026-12-01T09:00:00Z',
      end_at: '2026-12-01T17:00:00Z',
      expected_attendance: 50,
    };
    tables.events.push(event2);

    await service.updateEvent(organiser, 5, { expectedAttendance: 200 });

    // Only event 5's coordinator (id 2) should be notified
    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(2, expect.any(String), expect.any(String), expect.any(String), 5);
    
    // Event 6's users should NOT be notified
    expect(audit.notifyUser).not.toHaveBeenCalledWith(10, expect.any(String), expect.any(String), expect.any(String), expect.any(Number));
    expect(audit.notifyUser).not.toHaveBeenCalledWith(11, expect.any(String), expect.any(String), expect.any(String), expect.any(Number));
  });

  /*
   * AC: SCRUM-44 AC2, AC4 (authorization + isolation)
   * Scenario: Cross-Cutting — Organiser changes status emits to coordinator
   * Setup: Create test where coordinator (who is also the assigned one) changes status
   * Expected: Organiser notified, coordinator (actor) self-excluded
   * Type: security
   */
  it('US44-C02: coordinator changing status notifies organiser only (self-excluded)', async () => {
    event.status = 'UNDER_REVIEW';

    await service.changeStatus(coordinator, 5, 'APPROVED');

    // Organiser should be notified
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'EVENT_STATUS_CHANGED',
      expect.any(String),
      expect.any(String),
      5
    );

    // Coordinator (actor) should NOT be notified (self-excluded)
    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
  });

  /*
   * AC: SCRUM-44 AC1b (multiple recipients)
   * Scenario: Cross-Cutting — Critical update notifies all relevant parties
   * Setup: Event with different organiser and coordinator; third party has no role
   * Expected: Only organiser and coordinator notified (via self-exclusion logic)
   * Type: security
   */
  it('US44-C03: critical detail update notifies correct party based on actor', async () => {
    // Organiser updates
    await service.updateEvent(organiser, 5, { startAt: '2026-11-25T14:00:00Z', endAt: '2026-11-25T20:00:00Z' });
    
    // Only coordinator notified (organiser is actor)
    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(2, expect.any(String), expect.any(String), expect.any(String), 5);

    jest.clearAllMocks();

    // Coordinator updates
    await service.updateEvent(coordinator, 5, { endAt: '2026-11-25T21:00:00Z' });
    
    // Only organiser notified (coordinator is actor)
    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
    expect(audit.notifyUser).toHaveBeenCalledWith(1, expect.any(String), expect.any(String), expect.any(String), 5);
  });
});

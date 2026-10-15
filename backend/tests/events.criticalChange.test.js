/**
 * SCRUM-41: Detect Critical Changes.
 * SCRUM-42: Flag Affected Resources for Review.
 *
 *   SCRUM-41 AC1  Classify whether a saved change is critical (date, time, attendance,
 *                 venue, equipment) or not.
 *   SCRUM-41 AC2  Name / purpose / description are not critical.
 *   SCRUM-41 AC3  80 → 150 is a change; 80 → 80 is not; a decrease is still a change.
 *   SCRUM-42 AC1  Affected active venue bookings and equipment requests get needs_review.
 *   SCRUM-42 AC2  Marks affected rows needs_review (W4: flag only, nothing cancelled);
 *                 EventDetail shows "Requires review".
 *   SCRUM-42 AC3  Does not trigger a review for non-critical changes.
 *   SCRUM-42 AC4  W7 #3 — one booking's window does not automatically flag another.
 *   SCRUM-36 AC5  Approve of a change request runs the same flag after the event write.
 */
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
const {
  changedCriticalFields,
  venueCannotHoldAttendance,
  flagArrangementsForReview,
} = require('../src/services/criticalChange.service');
const eventsService = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');

const SLOT = {
  start_at: '2026-11-10T09:00:00.000Z',
  end_at: '2026-11-10T17:00:00.000Z',
};

const OTHER_SLOT = {
  start_at: '2026-11-11T09:00:00.000Z',
  end_at: '2026-11-11T17:00:00.000Z',
};

function eventRow(overrides = {}) {
  return {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    status: 'PLANNING',
    name: 'Workshop',
    purpose: 'Learn',
    description: 'A workshop',
    start_at: SLOT.start_at,
    end_at: SLOT.end_at,
    expected_attendance: 80,
    venue_requirements: 'Lecture theatre',
    requested_venue_id: null,
    equipment_notes: '2 mics',
    ...overrides,
  };
}

function booking(overrides = {}) {
  return {
    id: 7,
    event_id: 3,
    venue_id: 8,
    status: 'APPROVED',
    start_at: SLOT.start_at,
    end_at: SLOT.end_at,
    ...overrides,
  };
}

function requestRow(overrides = {}) {
  return { id: 12, event_id: 3, status: 'PENDING', ...overrides };
}

const user = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };

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
  db.fetchOne.mockImplementation(async () => eventRow());
});

describe('SCRUM-41 classify critical vs non-critical', () => {
  /*
   * AC:       SCRUM-41 AC1 + AC3
   * Scenario: Attendance moves from 80 to 150.
   * Setup:    Previous and next event rows differ only on expected_attendance.
   * Expected: expectedAttendance is the only critical field reported.
   * Type:     normal
   */
  it('AC1+AC3: 80 → 150 is a critical attendance change', () => {
    expect(changedCriticalFields(eventRow(), eventRow({ expected_attendance: 150 }))).toEqual([
      'expectedAttendance',
    ]);
  });

  /*
   * AC:       SCRUM-41 AC3
   * Scenario: Attendance is saved as 80 again.
   * Setup:    Previous and next both 80 (number vs string still equal).
   * Expected: No critical fields.
   * Type:     boundary
   */
  it('AC3: 80 → 80 is not a change', () => {
    expect(changedCriticalFields(eventRow(), eventRow({ expected_attendance: '80' }))).toEqual([]);
  });

  /*
   * AC:       SCRUM-41 AC1 + AC3
   * Scenario: Attendance decreases.
   * Setup:    150 → 80.
   * Expected: Still classified as a critical change.
   * Type:     boundary
   */
  it('AC1+AC3: an attendance decrease is still critical', () => {
    expect(changedCriticalFields(
      eventRow({ expected_attendance: 150 }),
      eventRow({ expected_attendance: 80 })
    )).toEqual(['expectedAttendance']);
  });

  /*
   * AC:       SCRUM-41 AC1
   * Scenario: Date/time, venue text, requested venue or equipment notes change.
   * Expected: Each is reported as critical.
   * Type:     normal
   */
  it('AC1: date, time, venue and equipment fields are critical', () => {
    expect(changedCriticalFields(eventRow(), eventRow({ start_at: OTHER_SLOT.start_at }))).toEqual(['startAt']);
    expect(changedCriticalFields(eventRow(), eventRow({ end_at: OTHER_SLOT.end_at }))).toEqual(['endAt']);
    expect(changedCriticalFields(eventRow(), eventRow({ venue_requirements: 'Banquet' }))).toEqual(['venueRequirements']);
    expect(changedCriticalFields(eventRow(), eventRow({ requested_venue_id: 9 }))).toEqual(['requestedVenueId']);
    expect(changedCriticalFields(eventRow(), eventRow({ equipment_notes: '4 mics' }))).toEqual(['equipmentNotes']);
  });

  /*
   * AC:       SCRUM-41 AC2
   * Scenario: Only the event name, purpose or description is edited.
   * Expected: Not critical.
   * Type:     normal
   */
  it('AC2: name, purpose and description are not critical', () => {
    expect(changedCriticalFields(eventRow(), eventRow({ name: 'Renamed', purpose: 'New', description: 'New' }))).toEqual([]);
  });
});

describe('SCRUM-41 AC3 venue capacity vs new attendance', () => {
  /*
   * AC:       SCRUM-41 AC3
   * Scenario: Compare venue capacity to the new headcount.
   * Expected: Below the new figure is affected; equal capacity can hold it; missing capacity
   *           is treated as unknown and therefore affected.
   * Type:     boundary
   */
  it('AC3: a room is affected only when capacity is below the new attendance', () => {
    expect(venueCannotHoldAttendance(100, 150)).toBe(true);
    expect(venueCannotHoldAttendance(150, 150)).toBe(false);
    expect(venueCannotHoldAttendance(200, 150)).toBe(false);
    expect(venueCannotHoldAttendance(null, 150)).toBe(true);
  });
});

describe('SCRUM-42 flagArrangementsForReview', () => {
  /*
   * AC:       SCRUM-42 AC1 + AC2 / SCRUM-41 AC3
   * Scenario: Attendance 80 → 150 with an approved 100-capacity room and a pending request.
   * Setup:    One APPROVED booking, one PENDING equipment request, venue capacity 100.
   * Expected: Both rows get needs_review; status is not written; CRITICAL_CHANGE is audited.
   * Type:     normal
   */
  it('AC1+AC2: over-capacity booking and equipment are flagged, status untouched', async () => {
    db.fetchMany
      .mockResolvedValueOnce([booking()])
      .mockResolvedValueOnce([requestRow()])
      .mockResolvedValueOnce([{ id: 8, capacity: 100 }]);

    const result = await flagArrangementsForReview(
      user,
      eventRow(),
      eventRow({ expected_attendance: 150 })
    );

    expect(result.flaggedBookingIds).toEqual([7]);
    expect(result.flaggedRequestIds).toEqual([12]);
    expect(db.updateById).toHaveBeenCalledWith('venue_bookings', 7, expect.objectContaining({ needs_review: true }));
    expect(db.updateById).toHaveBeenCalledWith('equipment_requests', 12, expect.objectContaining({ needs_review: true }));
    const bookingPatch = db.updateById.mock.calls.find((call) => call[0] === 'venue_bookings')[2];
    expect(bookingPatch.status).toBeUndefined();
    expect(audit.writeAudit).toHaveBeenCalledWith(
      2,
      'CRITICAL_CHANGE',
      'event',
      3,
      expect.objectContaining({ fields: ['expectedAttendance'], flaggedBookingIds: [7], flaggedRequestIds: [12] })
    );
  });

  /*
   * AC:       SCRUM-41 AC3 / SCRUM-42 AC1
   * Scenario: Attendance 80 → 150 but the room holds 200.
   * Setup:    APPROVED booking, venue capacity 200; one PENDING equipment request.
   * Expected: Booking is not flagged; equipment still is (attendance change).
   * Type:     boundary
   */
  it('AC3: a room that can hold the new attendance is not flagged', async () => {
    db.fetchMany
      .mockResolvedValueOnce([booking()])
      .mockResolvedValueOnce([requestRow()])
      .mockResolvedValueOnce([{ id: 8, capacity: 200 }]);

    const result = await flagArrangementsForReview(
      user,
      eventRow(),
      eventRow({ expected_attendance: 150 })
    );

    expect(result.flaggedBookingIds).toEqual([]);
    expect(result.flaggedRequestIds).toEqual([12]);
    expect(db.updateById).not.toHaveBeenCalledWith('venue_bookings', expect.anything(), expect.anything());
  });

  /*
   * AC:       SCRUM-42 AC4 (W7 #3)
   * Scenario: Event date/time moves; two approved bookings exist.
   * Setup:    Booking 7 matches the previous slot; booking 8 is a different window.
   * Expected: Only booking 7 is flagged. Equipment in PENDING is flagged.
   * Type:     normal
   */
  it('AC4: a booking for a different window is not automatically flagged', async () => {
    db.fetchMany
      .mockResolvedValueOnce([
        booking({ id: 7 }),
        booking({ id: 8, start_at: OTHER_SLOT.start_at, end_at: OTHER_SLOT.end_at }),
      ])
      .mockResolvedValueOnce([requestRow()]);

    const result = await flagArrangementsForReview(
      user,
      eventRow(),
      eventRow({ start_at: OTHER_SLOT.start_at, end_at: OTHER_SLOT.end_at })
    );

    expect(result.flaggedBookingIds).toEqual([7]);
    expect(result.flaggedRequestIds).toEqual([12]);
    expect(db.updateById).toHaveBeenCalledWith('venue_bookings', 7, expect.objectContaining({ needs_review: true }));
    expect(db.updateById).not.toHaveBeenCalledWith('venue_bookings', 8, expect.anything());
  });

  /*
   * AC:       SCRUM-42 AC1
   * Scenario: Date change with REJECTED / CANCELLED bookings and UNAVAILABLE equipment.
   * Setup:    Those rows are in the event lists alongside one active booking.
   * Expected: Only the active booking is flagged; inactive equipment is not.
   * Type:     error / boundary
   */
  it('AC1: rejected, cancelled and unavailable rows are not flagged', async () => {
    db.fetchMany
      .mockResolvedValueOnce([
        booking({ id: 7, status: 'APPROVED' }),
        booking({ id: 8, status: 'REJECTED' }),
        booking({ id: 9, status: 'CANCELLED' }),
      ])
      .mockResolvedValueOnce([
        requestRow({ id: 12, status: 'PENDING' }),
        requestRow({ id: 13, status: 'UNAVAILABLE' }),
      ]);

    const result = await flagArrangementsForReview(
      user,
      eventRow(),
      eventRow({ start_at: OTHER_SLOT.start_at })
    );

    expect(result.flaggedBookingIds).toEqual([7]);
    expect(result.flaggedRequestIds).toEqual([12]);
  });

  /*
   * AC:       SCRUM-42 AC1
   * Scenario: Only equipment notes change.
   * Setup:    One APPROVED booking and one PENDING equipment request.
   * Expected: Equipment is flagged; venue booking is not.
   * Type:     normal
   */
  it('AC1: equipment-notes change flags equipment only', async () => {
    db.fetchMany
      .mockResolvedValueOnce([booking()])
      .mockResolvedValueOnce([requestRow()]);

    const result = await flagArrangementsForReview(
      user,
      eventRow(),
      eventRow({ equipment_notes: '4 mics' })
    );

    expect(result.flaggedBookingIds).toEqual([]);
    expect(result.flaggedRequestIds).toEqual([12]);
  });

  /*
   * AC:       SCRUM-42 AC1
   * Scenario: Only venue requirements text changes (requested venue id unchanged).
   * Setup:    One TENTATIVE booking and one PENDING equipment request.
   * Expected: The booking is flagged; equipment is not.
   * Type:     normal
   */
  it('AC1: venue-requirements text flags all active venue bookings, not equipment', async () => {
    db.fetchMany
      .mockResolvedValueOnce([booking({ status: 'TENTATIVE' })])
      .mockResolvedValueOnce([requestRow()]);

    const result = await flagArrangementsForReview(
      user,
      eventRow(),
      eventRow({ venue_requirements: 'Banquet' })
    );

    expect(result.flaggedBookingIds).toEqual([7]);
    expect(result.flaggedRequestIds).toEqual([]);
  });

  /*
   * AC:       SCRUM-42 AC1
   * Scenario: requested_venue_id is set to venue 8.
   * Setup:    Booking 7 is venue 8; booking 9 is venue 10. Both APPROVED.
   * Expected: Only the booking for a different venue is flagged.
   * Type:     normal
   */
  it('AC1: requested venue id flags only bookings for a different venue', async () => {
    db.fetchMany
      .mockResolvedValueOnce([
        booking({ id: 7, venue_id: 8 }),
        booking({ id: 9, venue_id: 10 }),
      ])
      .mockResolvedValueOnce([]);

    const result = await flagArrangementsForReview(
      user,
      eventRow({ requested_venue_id: null }),
      eventRow({ requested_venue_id: 8 })
    );

    expect(result.flaggedBookingIds).toEqual([9]);
  });

  /*
   * AC:       SCRUM-41 AC2 / SCRUM-42 AC1
   * Scenario: A non-critical name change.
   * Expected: No booking/equipment writes and no CRITICAL_CHANGE audit.
   * Type:     normal
   */
  it('AC2: a non-critical change does not set or clear flags', async () => {
    const result = await flagArrangementsForReview(
      user,
      eventRow(),
      eventRow({ name: 'Renamed workshop' })
    );

    expect(result.critical).toBe(false);
    expect(db.fetchMany).not.toHaveBeenCalled();
    expect(db.updateById).not.toHaveBeenCalled();
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });
});

describe('SCRUM-41 / SCRUM-42 updateEvent hook', () => {
  /*
   * AC:       SCRUM-41 AC2
   * Scenario: Assigned coordinator edits only the event name.
   * Expected: Event is updated; venue_bookings and equipment_requests are not written.
   * Type:     normal
   */
  it('AC2: a name-only edit does not flag arrangements', async () => {
    await eventsService.updateEvent(coordinator, 3, { name: 'Renamed workshop' });

    expect(db.updateById).toHaveBeenCalledWith('events', 3, expect.objectContaining({ name: 'Renamed workshop' }));
    expect(db.updateById).not.toHaveBeenCalledWith('venue_bookings', expect.anything(), expect.anything());
    expect(db.updateById).not.toHaveBeenCalledWith('equipment_requests', expect.anything(), expect.anything());
  });

  /*
   * AC:       SCRUM-41 AC1 / SCRUM-42 AC1 + AC4
   * Scenario: Assigned coordinator moves the event time.
   * Setup:    One APPROVED booking on the previous slot; fetchMany returns it then no equipment.
   * Expected: That booking is flagged; status is not in the patch.
   * Type:     normal
   */
  it('AC1: a coordinator date change flags the previous-slot booking', async () => {
    db.fetchMany
      .mockResolvedValueOnce([booking()])
      .mockResolvedValueOnce([]);

    await eventsService.updateEvent(coordinator, 3, { startAt: OTHER_SLOT.start_at, endAt: OTHER_SLOT.end_at });

    expect(db.updateById).toHaveBeenCalledWith('venue_bookings', 7, expect.objectContaining({ needs_review: true }));
    const bookingPatch = db.updateById.mock.calls.find((call) => call[0] === 'venue_bookings')[2];
    expect(bookingPatch.status).toBeUndefined();
  });
});

const { supabase, fetchMany, updateById } = require('../config/db');
const { BOOKING_STATUS } = require('../constants/statuses');
const { writeAudit } = require('./audit.service');

/**
 * Purpose: event columns that W4 / the story notes treat as critical (date, time,
 * attendance, venue, equipment). Anything else is a non-critical change.
 * AC: SCRUM-41 AC1, AC2
 * Business rule: Notes — "Critical fields are date, time, attendance, venue and equipment."
 */
const CRITICAL_COLUMNS = [
  { column: 'start_at', field: 'startAt', kind: 'time' },
  { column: 'end_at', field: 'endAt', kind: 'time' },
  { column: 'expected_attendance', field: 'expectedAttendance', kind: 'number' },
  { column: 'venue_requirements', field: 'venueRequirements', kind: 'text' },
  { column: 'requested_venue_id', field: 'requestedVenueId', kind: 'number' },
  { column: 'equipment_notes', field: 'equipmentNotes', kind: 'text' },
];

const ACTIVE_BOOKING_STATUSES = new Set([
  BOOKING_STATUS.PENDING,
  BOOKING_STATUS.TENTATIVE,
  BOOKING_STATUS.APPROVED,
]);

const ACTIVE_EQUIPMENT_STATUSES = new Set(['PENDING', 'RESERVED']);

/**
 * Purpose: compare two stored values of one kind so "80" and 80 are the same attendance.
 * AC: SCRUM-41 AC1
 */
function valuesEqual(kind, left, right) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  if (kind === 'time') {
    const a = new Date(left).getTime();
    const b = new Date(right).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return String(left) === String(right);
    return a === b;
  }
  if (kind === 'number') return Number(left) === Number(right);
  return String(left).trim() === String(right).trim();
}

/**
 * Purpose: which critical event fields actually changed between the row before the write
 * and the row after. Unchanged critical fields are not a change.
 * AC: SCRUM-41 AC1, AC2, AC3 (80 → 150 is a change; 80 → 80 is not)
 * Inputs: previous and next event rows (snake_case). Output: API field names that changed.
 */
function changedCriticalFields(previous, next) {
  if (!previous || !next) return [];
  return CRITICAL_COLUMNS
    .filter(({ column, kind }) => !valuesEqual(kind, previous[column], next[column]))
    .map(({ field }) => field);
}

/**
 * Purpose: a booking is "for the old event slot" when its window is the previous start/end.
 * AC: SCRUM-42 AC4 (W7 #3 — a second booking with different times is not automatically affected)
 */
function bookingMatchesPreviousSlot(booking, previous) {
  return valuesEqual('time', booking.start_at, previous.start_at)
    && valuesEqual('time', booking.end_at, previous.end_at);
}

/**
 * Purpose: venue capacity below the new headcount cannot hold the event; missing capacity
 * is treated as unknown and therefore affected.
 * AC: SCRUM-41 AC3, SCRUM-42 AC1 (80 → 150 flags rooms that cannot take 150)
 */
function venueCannotHoldAttendance(capacity, attendance) {
  if (capacity == null || capacity === '') return true;
  return Number(capacity) < Number(attendance);
}

/**
 * Purpose: pick which active venue bookings and equipment requests need reassessment for
 * this set of critical fields. Status of a row is never changed here.
 * AC: SCRUM-42 AC1, AC4; W7 #3
 */
function selectAffected({ fields, previous, next, bookings, venuesById, requests }) {
  const flaggedBookings = new Set();
  const flaggedRequests = new Set();
  const activeBookings = bookings.filter((row) => ACTIVE_BOOKING_STATUSES.has(row.status));
  const activeRequests = requests.filter((row) => ACTIVE_EQUIPMENT_STATUSES.has(row.status));

  const timeChanged = fields.includes('startAt') || fields.includes('endAt');
  const attendanceChanged = fields.includes('expectedAttendance');
  const venueIdChanged = fields.includes('requestedVenueId');
  const venueTextChanged = fields.includes('venueRequirements');
  const equipmentChanged = fields.includes('equipmentNotes');

  if (timeChanged) {
    activeBookings
      .filter((row) => bookingMatchesPreviousSlot(row, previous))
      .forEach((row) => flaggedBookings.add(row.id));
    activeRequests.forEach((row) => flaggedRequests.add(row.id));
  }

  if (attendanceChanged) {
    activeBookings.forEach((row) => {
      const venue = venuesById.get(Number(row.venue_id));
      if (venueCannotHoldAttendance(venue?.capacity, next.expected_attendance)) {
        flaggedBookings.add(row.id);
      }
    });
    activeRequests.forEach((row) => flaggedRequests.add(row.id));
  }

  if (venueIdChanged) {
    const wanted = next.requested_venue_id == null ? null : Number(next.requested_venue_id);
    activeBookings.forEach((row) => {
      if (wanted == null || Number(row.venue_id) !== wanted) flaggedBookings.add(row.id);
    });
  } else if (venueTextChanged) {
    activeBookings.forEach((row) => flaggedBookings.add(row.id));
  }

  if (equipmentChanged) {
    activeRequests.forEach((row) => flaggedRequests.add(row.id));
  }

  return {
    flaggedBookingIds: [...flaggedBookings],
    flaggedRequestIds: [...flaggedRequests],
  };
}

/**
 * Purpose: after event fields are written, classify the change (SCRUM-41) and set
 * needs_review on the affected venue bookings and equipment requests (SCRUM-42). Does not
 * cancel anything (W4). Does not change booking status (W7 #3). Does not clear flags on
 * rows this change did not affect. The needs_review column is the mark SCRUM-58/60 reuse.
 * AC: SCRUM-41 AC1-AC3, SCRUM-42 AC1-AC4
 * Inputs: user (for the audit), previous event row, next event row (snake_case, already written).
 * Output: { critical, fields, flaggedBookingIds, flaggedRequestIds }.
 * Failure: database errors are passed on. Non-critical changes return critical: false and
 * write nothing.
 */
async function flagArrangementsForReview(user, previous, next) {
  const fields = changedCriticalFields(previous, next);
  if (!fields.length) {
    return { critical: false, fields: [], flaggedBookingIds: [], flaggedRequestIds: [] };
  }

  const eventId = previous.id;
  const bookings = await fetchMany(
    supabase.from('venue_bookings').select('*').eq('event_id', eventId)
  );
  const requests = await fetchMany(
    supabase.from('equipment_requests').select('*').eq('event_id', eventId)
  );

  const venuesById = new Map();
  if (fields.includes('expectedAttendance')) {
    const venueIds = [...new Set(
      bookings
        .filter((row) => ACTIVE_BOOKING_STATUSES.has(row.status))
        .map((row) => row.venue_id)
        .filter((id) => id != null)
    )];
    if (venueIds.length) {
      const venues = await fetchMany(
        supabase.from('venues').select('id, capacity').in('id', venueIds)
      );
      (venues || []).forEach((venue) => venuesById.set(Number(venue.id), venue));
    }
  }

  const { flaggedBookingIds, flaggedRequestIds } = selectAffected({
    fields,
    previous,
    next,
    bookings: bookings || [],
    venuesById,
    requests: requests || [],
  });

  const now = new Date().toISOString();
  for (const id of flaggedBookingIds) {
    await updateById('venue_bookings', id, { needs_review: true, updated_at: now });
  }
  for (const id of flaggedRequestIds) {
    await updateById('equipment_requests', id, { needs_review: true, updated_at: now });
  }

  if (user?.id) {
    await writeAudit(user.id, 'CRITICAL_CHANGE', 'event', eventId, {
      fields,
      flaggedBookingIds,
      flaggedRequestIds,
    });
  }

  return { critical: true, fields, flaggedBookingIds, flaggedRequestIds };
}

module.exports = {
  CRITICAL_COLUMNS,
  changedCriticalFields,
  flagArrangementsForReview,
  bookingMatchesPreviousSlot,
  venueCannotHoldAttendance,
};

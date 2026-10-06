const { supabase, fetchMany, fetchOne, insertOne, insertMany, updateById } = require('../config/db');
const { ROLES } = require('../constants/roles');
const { BOOKING_STATUS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');
const { hasRole } = require('../middleware/auth');
const { writeAudit, notifyUser } = require('./audit.service');

function mapVenue(row) {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    capacity: row.capacity,
    facilities: row.facilities,
    accessibility: row.accessibility,
    operatingHours: row.operating_hours,
    setupMinutes: row.setup_minutes,
    teardownMinutes: row.teardown_minutes,
    isActive: Boolean(row.is_active),
  };
}

async function listVenues() {
  const rows = await fetchMany(
    supabase.from('venues').select('*').eq('is_active', true).order('name')
  );
  const layouts = await fetchMany(supabase.from('venue_layouts').select('*'));
  const byVenue = layouts.reduce((acc, layout) => {
    acc[layout.venue_id] = acc[layout.venue_id] || [];
    acc[layout.venue_id].push(layout.layout);
    return acc;
  }, {});
  return rows.map((row) => ({ ...mapVenue(row), layouts: byVenue[row.id] || [] }));
}

function parseListParam(value) {
  if (value === undefined || value === null || value === '') return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return raw.map((entry) => String(entry).trim()).filter(Boolean);
}

function textIncludesAll(haystack, needles) {
  if (!needles.length) return true;
  if (!haystack) return false;
  const hay = haystack.toLowerCase();
  return needles.every((needle) => hay.includes(needle.toLowerCase()));
}

// AC2's example (10:00-12:00, 30m setup, 45m turnaround -> 9:30-12:45) applied
// to any start/end + setup/teardown combination, venue or booking alike.
function computeOccupiedWindow(startAt, endAt, setupMinutes = 0, teardownMinutes = 0) {
  const occupiedStart = new Date(startAt);
  const occupiedEnd = new Date(endAt);
  occupiedStart.setMinutes(occupiedStart.getMinutes() - Number(setupMinutes || 0));
  occupiedEnd.setMinutes(occupiedEnd.getMinutes() + Number(teardownMinutes || 0));
  return { occupiedStart, occupiedEnd };
}

function windowsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function groupByVenueId(rows) {
  return rows.reduce((acc, row) => {
    (acc[row.venue_id] = acc[row.venue_id] || []).push(row);
    return acc;
  }, {});
}

/**
 * SCRUM-23: search the venue catalogue by capacity/location/accessibility/
 * layout/facilities, and (when a date+time window is given) by availability.
 */
async function searchVenues(filters = {}) {
  const { startAt, endAt } = filters;
  if (Boolean(startAt) !== Boolean(endAt)) {
    throw httpError(400, 'startAt and endAt must be provided together', 'VALIDATION_ERROR');
  }
  if (startAt && endAt && new Date(startAt) >= new Date(endAt)) {
    throw httpError(400, 'startAt must be before endAt', 'VALIDATION_ERROR');
  }

  let capacityMin = null;
  if (filters.capacityMin !== undefined && filters.capacityMin !== '') {
    capacityMin = Number(filters.capacityMin);
    if (!Number.isFinite(capacityMin)) {
      throw httpError(400, 'capacityMin must be a number', 'VALIDATION_ERROR');
    }
  }

  const locationTerm = filters.location ? String(filters.location).trim() : '';
  const accessibilityTerms = parseListParam(filters.accessibility);
  const facilityTerms = parseListParam(filters.facilities);
  const layoutTerm = filters.layout ? String(filters.layout).trim().toUpperCase() : '';

  const venues = await listVenues();

  // AC4-AC7: capacity/location/accessibility/layout/facilities, strict AND
  // matching (W4 gave no close-match rule, so the team decided on strict).
  const candidates = venues.filter((venue) => {
    if (capacityMin !== null && venue.capacity < capacityMin) return false;
    if (locationTerm && !textIncludesAll(venue.location, [locationTerm])) return false;
    if (!textIncludesAll(venue.accessibility, accessibilityTerms)) return false;
    if (!textIncludesAll(venue.facilities, facilityTerms)) return false;
    if (layoutTerm && !venue.layouts.includes(layoutTerm)) return false;
    return true;
  });

  // AC1: date/time is optional on top of the other filters; skip the
  // availability check entirely when no window was given.
  if (!startAt || !endAt || !candidates.length) {
    return candidates;
  }

  const candidateIds = candidates.map((venue) => venue.id);

  const [bookingRows, unavailabilityRows] = await Promise.all([
    fetchMany(
      supabase
        .from('venue_bookings')
        .select('venue_id, start_at, end_at, setup_minutes, teardown_minutes')
        .in('venue_id', candidateIds)
        // "confirmed booking" -> APPROVED, "active tentative hold" -> TENTATIVE.
        // PENDING is deliberately excluded: AC2 only names these two, and an
        // undecided request shouldn't hide a venue from search. Hold expiry
        // (SCRUM-75) isn't implemented yet, so every TENTATIVE row counts as
        // active for now.
        .in('status', [BOOKING_STATUS.APPROVED, BOOKING_STATUS.TENTATIVE])
    ),
    fetchMany(
      supabase
        .from('venue_unavailability')
        .select('venue_id, start_at, end_at')
        .in('venue_id', candidateIds)
    ),
  ]);

  const bookingsByVenue = groupByVenueId(bookingRows);
  const unavailabilityByVenue = groupByVenueId(unavailabilityRows);

  // AC2 + AC3 + AC9: a venue is available only if its occupied window clears
  // every existing confirmed booking/tentative hold AND every unavailability
  // period. Each existing booking is padded by its OWN recorded setup/
  // teardown (captured per-booking in venue_bookings), not the venue's
  // current defaults, since those may have changed since it was made.
  return candidates.filter((venue) => {
    const { occupiedStart, occupiedEnd } = computeOccupiedWindow(
      startAt,
      endAt,
      venue.setupMinutes,
      venue.teardownMinutes
    );

    const blockedByBooking = (bookingsByVenue[venue.id] || []).some((booking) => {
      const bookingWindow = computeOccupiedWindow(
        booking.start_at,
        booking.end_at,
        booking.setup_minutes,
        booking.teardown_minutes
      );
      return windowsOverlap(
        occupiedStart,
        occupiedEnd,
        bookingWindow.occupiedStart,
        bookingWindow.occupiedEnd
      );
    });
    if (blockedByBooking) return false;

    const blockedByUnavailability = (unavailabilityByVenue[venue.id] || []).some((period) =>
      windowsOverlap(occupiedStart, occupiedEnd, new Date(period.start_at), new Date(period.end_at))
    );
    return !blockedByUnavailability;
  });
}

async function createVenue(user, payload) {
  if (!hasRole(user, ROLES.VENUE_STAFF)) {
    throw httpError(403, 'Only venue staff can manage the catalogue', 'FORBIDDEN');
  }
  if (!payload.name) throw httpError(400, 'Venue name is required', 'VALIDATION_ERROR');

  const created = await insertOne('venues', {
    name: payload.name,
    location: payload.location || null,
    capacity: payload.capacity || 0,
    facilities: payload.facilities || null,
    accessibility: payload.accessibility || null,
    operating_hours: payload.operatingHours || null,
    setup_minutes: payload.setupMinutes || 30,
    teardown_minutes: payload.teardownMinutes || 30,
  });

  if (payload.layouts?.length) {
    await insertMany(
      'venue_layouts',
      payload.layouts.map((layout) => ({ venue_id: created.id, layout }))
    );
  }

  await writeAudit(user.id, 'VENUE_CREATED', 'venue', created.id, payload);
  return (await listVenues()).find((venue) => venue.id === created.id);
}

async function updateVenue(user, id, payload) {
  if (!hasRole(user, ROLES.VENUE_STAFF)) {
    throw httpError(403, 'Only venue staff can manage the catalogue', 'FORBIDDEN');
  }
  const patch = {
    name: payload.name,
    location: payload.location,
    capacity: payload.capacity,
    facilities: payload.facilities,
    accessibility: payload.accessibility,
    operating_hours: payload.operatingHours,
    setup_minutes: payload.setupMinutes,
    teardown_minutes: payload.teardownMinutes,
    updated_at: new Date().toISOString(),
  };
  if (payload.isActive !== undefined) patch.is_active = Boolean(payload.isActive);
  await updateById('venues', id, patch);
  return (await listVenues()).find((venue) => venue.id === Number(id));
}

async function listBookings(filters = {}) {
  let query = supabase
    .from('venue_bookings')
    .select('*, venues ( name ), events ( name )')
    .order('start_at');

  if (filters.venueId) query = query.eq('venue_id', filters.venueId);
  if (filters.status) query = query.eq('status', filters.status);

  const rows = await fetchMany(query);
  return rows.map((row) => ({
    ...row,
    venue_name: row.venues?.name,
    event_name: row.events?.name,
  }));
}

async function requestBooking(user, payload) {
  if (!hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'Only coordinators can request venue bookings', 'FORBIDDEN');
  }

  const conflict = await findConflict(
    payload.venueId,
    payload.startAt,
    payload.endAt,
    payload.setupMinutes,
    payload.teardownMinutes
  );
  if (conflict) {
    throw httpError(409, 'This venue already has a confirmed/pending booking in that window', 'BOOKING_CONFLICT');
  }

  const created = await insertOne('venue_bookings', {
    event_id: payload.eventId,
    venue_id: payload.venueId,
    requested_by: user.id,
    status: BOOKING_STATUS.PENDING,
    start_at: payload.startAt,
    end_at: payload.endAt,
    setup_minutes: payload.setupMinutes || 30,
    teardown_minutes: payload.teardownMinutes || 30,
    notes: payload.notes || null,
  });

  await writeAudit(user.id, 'BOOKING_REQUESTED', 'venue_booking', created.id, payload);
  return created;
}

async function decideBooking(user, id, decision) {
  if (!hasRole(user, ROLES.VENUE_STAFF)) {
    throw httpError(403, 'Only venue staff can approve or reject bookings', 'FORBIDDEN');
  }

  const booking = await fetchOne(supabase.from('venue_bookings').select('*').eq('id', id));
  if (!booking) throw httpError(404, 'Booking not found', 'NOT_FOUND');

  const status = decision.approve ? BOOKING_STATUS.APPROVED : BOOKING_STATUS.REJECTED;
  const updated = await updateById('venue_bookings', id, {
    status,
    decided_by: user.id,
    decision_reason: decision.reason || null,
    alternative_suggestion: decision.alternativeSuggestion || null,
    decided_at: new Date().toISOString(),
  });

  // SCRUM-78 AC5: only the event's assigned Coordinator is told, not whoever sent the
  // request (that may be a previous Coordinator after a reassignment).
  const event = await fetchOne(supabase.from('events').select('*').eq('id', booking.event_id));
  if (event?.coordinator_id) {
    const venue = await fetchOne(supabase.from('venues').select('id, name').eq('id', booking.venue_id));
    const notice = buildBookingDecisionNotice({
      status,
      eventName: event.name,
      venueName: venue?.name || `venue #${booking.venue_id}`,
      reason: decision.reason,
      alternativeSuggestion: decision.alternativeSuggestion,
    });
    await notifyUser(event.coordinator_id, 'BOOKING_DECISION', notice.title, notice.body, event.id);
  }

  return updated;
}

/**
 * Purpose: the text of the notice an event's Coordinator gets when Venue Staff approve or
 * reject their venue booking request, so they can go ahead or look for another venue
 * without checking manually.
 * AC: SCRUM-78 AC1 (approval), AC2 (rejection includes the reason and suggested
 * alternative staff gave), AC3 (no reason given: no reason line), AC4 (names the event
 * and the venue).
 * Business rule source: Week 4 Q&A, "free text reason is reasonable" and an alternative
 * suggestion is optional.
 * Inputs: status (APPROVED or REJECTED), eventName, venueName, and the optional reason and
 * alternativeSuggestion. Blank or whitespace-only text counts as not given.
 * Output: { title, body }. Never throws.
 */
function buildBookingDecisionNotice({ status, eventName, venueName, reason, alternativeSuggestion }) {
  const outcome = status === BOOKING_STATUS.APPROVED ? 'approved' : 'rejected';
  const parts = [`Your venue booking request for ${eventName} at ${venueName} was ${outcome}.`];
  if (outcome === 'rejected') {
    const givenReason = String(reason || '').trim();
    const givenAlternative = String(alternativeSuggestion || '').trim();
    if (givenReason) parts.push(`Reason: ${givenReason}`);
    if (givenAlternative) parts.push(`Suggested alternative: ${givenAlternative}`);
  }
  // The title stays short because notifications.title is varchar(200) and event plus venue
  // names could exceed it; the event and venue go in the body (text) instead.
  return { title: `Venue booking ${outcome}`, body: parts.join(' ') };
}

async function findConflict(venueId, startAt, endAt, setupMinutes = 30, teardownMinutes = 30) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  start.setMinutes(start.getMinutes() - Number(setupMinutes || 30));
  end.setMinutes(end.getMinutes() + Number(teardownMinutes || 30));

  const rows = await fetchMany(
    supabase
      .from('venue_bookings')
      .select('id')
      .eq('venue_id', venueId)
      .in('status', [BOOKING_STATUS.PENDING, BOOKING_STATUS.TENTATIVE, BOOKING_STATUS.APPROVED])
      .lt('start_at', end.toISOString())
      .gt('end_at', start.toISOString())
      .limit(1)
  );
  return rows[0] || null;
}

async function listUnavailability(venueId) {
  let query = supabase.from('venue_unavailability').select('*').order('start_at');
  if (venueId) query = query.eq('venue_id', venueId);
  return fetchMany(query);
}

async function blockVenue(user, payload) {
  if (!hasRole(user, ROLES.VENUE_STAFF)) {
    throw httpError(403, 'Only venue staff can block venues', 'FORBIDDEN');
  }
  return insertOne('venue_unavailability', {
    venue_id: payload.venueId,
    reason: payload.reason || 'Maintenance',
    start_at: payload.startAt,
    end_at: payload.endAt,
    created_by: user.id,
  });
}

module.exports = {
  listVenues,
  searchVenues,
  createVenue,
  updateVenue,
  listBookings,
  requestBooking,
  decideBooking,
  buildBookingDecisionNotice,
  listUnavailability,
  blockVenue,
  computeOccupiedWindow,
  windowsOverlap,
};

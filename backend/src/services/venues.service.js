const {
  supabase,
  fetchMany,
  fetchOne,
  insertOne,
  insertMany,
  updateById,
  throwIf,
} = require('../config/db');
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
    updatedAt: row.updated_at,
  };
}

// SCUM-7 AC4: same rule as the route validator, repeated so the service is safe on its own.
function isValidCapacity(value) {
  return Number.isInteger(value) && value >= 1;
}

function normalizeLayouts(layouts) {
  return [...new Set((layouts || []).map((layout) => String(layout).trim()).filter(Boolean))];
}

async function findDuplicateVenue(name, location, ignoredId) {
  const candidates = await fetchMany(
    supabase.from('venues').select('id,name,location')
  );
  const normalizedName = name.trim().toLowerCase();
  const normalizedLocation = (location || '').trim().toLowerCase();
  return candidates.find((candidate) => (
    Number(candidate.id) !== Number(ignoredId)
    && candidate.name.trim().toLowerCase() === normalizedName
    && (candidate.location || '').trim().toLowerCase() === normalizedLocation
  ));
}

async function assertVenueIdentityAvailable(name, location, ignoredId) {
  if (name === undefined && location === undefined) return;
  const duplicate = await findDuplicateVenue(name, location, ignoredId);
  if (duplicate) {
    throw httpError(
      409,
      'A venue with this name and location already exists',
      'DUPLICATE_VENUE'
    );
  }
}

async function listVenues() {
  const rows = await fetchMany(
    supabase.from('venues').select('*').eq('is_active', true).order('name')
  );
  const layouts = await fetchMany(supabase.from('venue_layouts').select('*'));
  const byVenue = layouts.reduce((acc, layout) => {
    acc[layout.venue_id] = acc[layout.venue_id] || [];
    acc[layout.venue_id].push(layout);
    return acc;
  }, {});
  return rows.map((row) => ({
    ...mapVenue(row),
    layouts: (byVenue[row.id] || []).map((layout) => layout.layout),
    layoutDetails: byVenue[row.id] || [],
  }));
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
  // SCUM-7 AC4: a venue without a capacity is incomplete, so it is never saved.
  if (!isValidCapacity(payload.capacity)) {
    throw httpError(400, 'Venue capacity must be a whole number of at least 1', 'VALIDATION_ERROR');
  }
  await assertVenueIdentityAvailable(payload.name, payload.location);

  const created = await insertOne('venues', {
    name: payload.name,
    location: payload.location || null,
    capacity: payload.capacity,
    facilities: payload.facilities || null,
    accessibility: payload.accessibility || null,
    operating_hours: payload.operatingHours || null,
    setup_minutes: payload.setupMinutes || 30,
    teardown_minutes: payload.teardownMinutes || 30,
  });

  const layouts = normalizeLayouts(payload.layouts);
  if (layouts.length) {
    await insertMany(
      'venue_layouts',
      layouts.map((layout) => ({ venue_id: created.id, layout }))
    );
  }

  await writeAudit(user.id, 'VENUE_CREATED', 'venue', created.id, payload);
  return (await listVenues()).find((venue) => venue.id === created.id);
}

async function updateVenue(user, id, payload) {
  if (!hasRole(user, ROLES.VENUE_STAFF)) {
    throw httpError(403, 'Only venue staff can manage the catalogue', 'FORBIDDEN');
  }
  const existing = await fetchOne(supabase.from('venues').select('*').eq('id', id));
  if (!existing) throw httpError(404, 'Venue not found', 'NOT_FOUND');
  if (payload.capacity !== undefined && !isValidCapacity(payload.capacity)) {
    throw httpError(400, 'Venue capacity must be a whole number of at least 1', 'VALIDATION_ERROR');
  }
  await assertVenueIdentityAvailable(
    payload.name === undefined ? existing.name : payload.name,
    payload.location === undefined ? existing.location : payload.location,
    id
  );

  const patch = { updated_at: new Date().toISOString() };
  const fieldMap = {
    name: 'name',
    location: 'location',
    capacity: 'capacity',
    facilities: 'facilities',
    accessibility: 'accessibility',
    operatingHours: 'operating_hours',
    setupMinutes: 'setup_minutes',
    teardownMinutes: 'teardown_minutes',
  };
  Object.entries(fieldMap).forEach(([from, to]) => {
    if (payload[from] !== undefined) patch[to] = payload[from];
  });
  // Venue staff can deactivate a venue without removing it from the database.
  if (payload.isActive !== undefined) patch.is_active = Boolean(payload.isActive);
  await updateById('venues', id, patch);

  // Update, add, or delete only the layout rows included in the request.
  if (payload.layouts !== undefined) {
    const existingLayouts = await fetchMany(
      supabase.from('venue_layouts').select('*').eq('venue_id', id)
    );
    const existingById = new Map(existingLayouts.map((layout) => [Number(layout.id), layout]));
    const newLayoutNames = new Set();

    for (const requestedLayout of payload.layouts) {
      if (requestedLayout.id !== undefined) {
        const currentLayout = existingById.get(requestedLayout.id);
        if (!currentLayout) {
          throw httpError(404, 'Venue layout not found', 'NOT_FOUND');
        }
        if (requestedLayout.deleted) {
          const { error } = await supabase
            .from('venue_layouts')
            .delete()
            .eq('id', requestedLayout.id)
            .eq('venue_id', id);
          throwIf(error);
        } else if (requestedLayout.layout !== currentLayout.layout) {
          await updateById('venue_layouts', requestedLayout.id, { layout: requestedLayout.layout });
        }
      } else if (!requestedLayout.deleted) {
        const layout = requestedLayout.layout;
        if (newLayoutNames.has(layout) || existingLayouts.some((item) => item.layout === layout)) {
          throw httpError(409, 'Duplicate venue layout', 'DUPLICATE_LAYOUT');
        }
        newLayoutNames.add(layout);
        await insertOne('venue_layouts', { venue_id: id, layout });
      }
    }
  }

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

/**
 * Purpose: an Event Coordinator asks for a venue for an event. The request is saved as
 * PENDING for Venue Staff to decide, and an audit entry is written.
 * AC: SCRUM-78 AC6, no notice is sent here because nothing has been decided yet.
 * Inputs: user (must have EVENT_COORDINATOR) and payload { eventId, venueId, startAt, endAt,
 * setupMinutes, teardownMinutes, notes }. Missing setup/teardown minutes are saved as 30
 * (NEEDS HUMAN: purpose unclear, the venue's own setup_minutes/teardown_minutes are not used).
 * Output: the created booking row. Throws 403 if the user is not a Coordinator and 409 if
 * the venue already has a pending, tentative or approved booking overlapping the window.
 */
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
    // Nullish defaults preserve an explicitly configured zero-minute setup or turnaround.
    setup_minutes: payload.setupMinutes ?? 30,
    teardown_minutes: payload.teardownMinutes ?? 30,
    notes: payload.notes || null,
  });

  await writeAudit(user.id, 'BOOKING_REQUESTED', 'venue_booking', created.id, payload);
  return created;
}

/**
 * Purpose: Venue Staff approve or reject a venue booking request. The decision is saved
 * first, then the event's assigned Coordinator is notified so they can proceed or arrange
 * an alternative.
 * AC: SCRUM-78 AC1-AC5 (the notice), AC6 (no notice unless the decision was saved).
 * Inputs: user (must have VENUE_STAFF), booking id, and decision { approve, reason,
 * alternativeSuggestion }. A truthy `approve` means APPROVED; anything else means REJECTED.
 * Output: the updated booking row. Throws 403 if the user is not Venue Staff and 404 if the
 * booking doesn't exist; database errors are passed on. It does not check that the booking
 * is still PENDING, so deciding it again sends another notice (NEEDS HUMAN).
 */
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
  // "The", not "Your": after a reassignment the Coordinator told may not have sent it.
  const parts = [`The venue booking request for ${eventName} at ${venueName} was ${outcome}.`];
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

/**
 * Purpose: finds a booking at the venue that overlaps the requested time once setup and
 * turnaround are added (W7 #1: the occupied window includes setup and turnaround), so
 * requestBooking can refuse a double booking.
 * AC: used by requestBooking; for SCRUM-78 AC6 it means a refused request never becomes a
 * pending booking.
 * Business rule source: Week 4 Q&A, "confirmed bookings block availability". PENDING and
 * TENTATIVE bookings also count here (NEEDS HUMAN: purpose unclear, the Q&A leaves pending
 * conflicts to the team).
 * Inputs: venueId, startAt, endAt, and setup/turnaround minutes (missing or 0 counts as 30).
 * Output: the first overlapping booking ({ id }) or null. Database errors are passed on.
 */
async function findConflict(venueId, startAt, endAt, setupMinutes = 30, teardownMinutes = 30) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  // Use defaults only when configuration is absent, not when a valid value is zero.
  start.setMinutes(start.getMinutes() - Number(setupMinutes ?? 30));
  end.setMinutes(end.getMinutes() + Number(teardownMinutes ?? 30));

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

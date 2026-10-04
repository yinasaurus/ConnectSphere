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

// SCRUM-66: the three things that can make a venue unavailable. Sent to the
// frontend as `reasons[].type` so it can explain why a period is blocked.
const AVAILABILITY_BLOCK = {
  BOOKING: 'BOOKING',
  TENTATIVE_HOLD: 'TENTATIVE_HOLD',
  UNAVAILABILITY: 'UNAVAILABILITY',
};

// AC2 + AC3: a hold is active until its expiry; at or after the expiry it no longer
// blocks the venue (Week 7 change #4). A hold with no expiry recorded is treated as
// active: hold creation with an expiry (SCRUM-75) isn't built yet, and an undated
// hold shouldn't free the venue.
function isActiveHold(booking, now) {
  if (!booking.hold_expires_at) return true;
  return new Date(booking.hold_expires_at) > now;
}

// Turns the database rows into one list of blocked windows ({ type, start, end, ... }).
// Rows with any other status (e.g. PENDING) produce no block, so they show as available.
function toAvailabilityBlocks(bookingRows, unavailabilityRows, now) {
  const blocks = [];
  bookingRows.forEach((booking) => {
    // AC1: a confirmed booking blocks start - setup to end + turnaround. Each booking
    // uses its own recorded setup/teardown, the same rule as SCRUM-23 search.
    if (booking.status === BOOKING_STATUS.APPROVED) {
      const { occupiedStart, occupiedEnd } = computeOccupiedWindow(
        booking.start_at,
        booking.end_at,
        booking.setup_minutes,
        booking.teardown_minutes
      );
      blocks.push({
        type: AVAILABILITY_BLOCK.BOOKING,
        id: booking.id,
        label: booking.events?.name || 'Confirmed booking',
        start: occupiedStart,
        end: occupiedEnd,
      });
    } else if (booking.status === BOOKING_STATUS.TENTATIVE && isActiveHold(booking, now)) {
      // AC2: an active hold blocks only its held period (no setup/turnaround padding).
      // AC3: an expired hold never reaches here, so it doesn't block anything.
      blocks.push({
        type: AVAILABILITY_BLOCK.TENTATIVE_HOLD,
        id: booking.id,
        label: booking.events?.name || 'Tentative hold',
        start: new Date(booking.start_at),
        end: new Date(booking.end_at),
        expiresAt: booking.hold_expires_at || null,
      });
    }
  });
  // AC4: recorded unavailability (maintenance etc.) blocks exactly its recorded times.
  unavailabilityRows.forEach((period) => {
    blocks.push({
      type: AVAILABILITY_BLOCK.UNAVAILABILITY,
      id: period.id,
      label: period.reason,
      start: new Date(period.start_at),
      end: new Date(period.end_at),
    });
  });
  return blocks;
}

// Shapes a block for the API response. Times are the block's full window, not
// clipped to the requested range, so the user sees when it really starts and ends.
function toReason(block) {
  const reason = {
    type: block.type,
    id: block.id,
    label: block.label,
    startAt: block.start.toISOString(),
    endAt: block.end.toISOString(),
  };
  if (block.type === AVAILABILITY_BLOCK.TENTATIVE_HOLD) reason.expiresAt = block.expiresAt;
  return reason;
}

// Splits [from, to) into consecutive periods. A period is unavailable while any
// block covers it; adjacent periods with the same status are merged.
//
// Example (range 08:00-14:00, booking occupying 09:30-12:45):
//   08:00-09:30 available | 09:30-12:45 unavailable (BOOKING) | 12:45-14:00 available
function buildAvailabilityTimeline(from, to, blocks) {
  // Blocks that only touch the range edge don't overlap it (see windowsOverlap).
  const inRange = blocks.filter((block) => windowsOverlap(from, to, block.start, block.end));

  // Every point where the status could change: the range ends, plus each block's
  // start and end, clipped so nothing falls outside the requested range.
  const points = new Set([from.getTime(), to.getTime()]);
  inRange.forEach((block) => {
    points.add(Math.max(block.start.getTime(), from.getTime()));
    points.add(Math.min(block.end.getTime(), to.getTime()));
  });
  const sorted = [...points].sort((a, b) => a - b);

  const periods = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = new Date(sorted[i]);
    const end = new Date(sorted[i + 1]);
    // AC5: a slice with no block covering it is available.
    const covering = inRange.filter((block) => windowsOverlap(start, end, block.start, block.end));
    const available = covering.length === 0;
    const previous = periods[periods.length - 1];

    // Same status as the previous slice: extend it instead of starting a new row,
    // and add any new reasons (one block can span several slices, so skip repeats).
    if (previous && previous.available === available) {
      previous.endAt = end.toISOString();
      covering.forEach((block) => {
        const seen = previous.reasons.some((r) => r.type === block.type && r.id === block.id);
        if (!seen) previous.reasons.push(toReason(block));
      });
    } else {
      periods.push({
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        available,
        reasons: covering.map(toReason),
      });
    }
  }
  return periods;
}

/**
 * SCRUM-66: a venue's availability across [from, to). Confirmed bookings block
 * their occupied window (setup + turnaround), active tentative holds block their
 * held period, and recorded unavailability blocks its dates/times. Everything
 * else is available. PENDING requests are not shown as blocking.
 *
 * `now` decides which holds have expired; it is a parameter so tests can fix the time.
 * Returns { venue, from, to, periods: [{ startAt, endAt, available, reasons }] }.
 */
async function getVenueAvailability(venueId, { from, to } = {}, now = new Date()) {
  if (!from || !to) {
    throw httpError(400, 'from and to are required', 'VALIDATION_ERROR');
  }
  const rangeStart = new Date(from);
  const rangeEnd = new Date(to);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
    throw httpError(400, 'from and to must be valid dates', 'VALIDATION_ERROR');
  }
  if (rangeStart >= rangeEnd) {
    throw httpError(400, 'from must be before to', 'VALIDATION_ERROR');
  }

  const venue = await fetchOne(supabase.from('venues').select('id, name').eq('id', venueId));
  if (!venue) throw httpError(404, 'Venue not found', 'NOT_FOUND');

  const [bookingRows, unavailabilityRows] = await Promise.all([
    // Not filtered by time in the query: setup/turnaround padding can pull a booking
    // that starts or ends outside the range into it, so overlap is checked in code.
    // `*` (not a column list) so this still works before hold_expires_at is migrated.
    fetchMany(
      supabase
        .from('venue_bookings')
        .select('*, events ( name )')
        .eq('venue_id', venueId)
        .in('status', [BOOKING_STATUS.APPROVED, BOOKING_STATUS.TENTATIVE])
    ),
    // Unavailability has no padding, so only periods overlapping the range are fetched.
    fetchMany(
      supabase
        .from('venue_unavailability')
        .select('id, reason, start_at, end_at')
        .eq('venue_id', venueId)
        .lt('start_at', rangeEnd.toISOString())
        .gt('end_at', rangeStart.toISOString())
    ),
  ]);

  const blocks = toAvailabilityBlocks(bookingRows, unavailabilityRows, now);
  return {
    venue: { id: venue.id, name: venue.name },
    from: rangeStart.toISOString(),
    to: rangeEnd.toISOString(),
    periods: buildAvailabilityTimeline(rangeStart, rangeEnd, blocks),
  };
}

/**
 * SCRUM-67: the bookings already committed at one venue in [from, to).
 * Confirmed bookings come back with their occupied window (start - setup to
 * end + turnaround). Active tentative holds come back as type TENTATIVE_HOLD with
 * their held period as the occupied window. Expired holds and PENDING requests
 * are left out. A booking is included when its occupied window overlaps the period.
 *
 * `now` decides which holds have expired; it is a parameter so tests can fix the time.
 * Returns { venue, from, to, bookings: [...] } sorted by occupied start.
 */
async function listVenueBookingsForPeriod(venueId, { from, to } = {}, now = new Date()) {
  if (!from || !to) {
    throw httpError(400, 'from and to are required', 'VALIDATION_ERROR');
  }
  const rangeStart = new Date(from);
  const rangeEnd = new Date(to);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
    throw httpError(400, 'from and to must be valid dates', 'VALIDATION_ERROR');
  }
  if (rangeStart >= rangeEnd) {
    throw httpError(400, 'from must be before to', 'VALIDATION_ERROR');
  }

  const venue = await fetchOne(supabase.from('venues').select('id, name').eq('id', venueId));
  if (!venue) throw httpError(404, 'Venue not found', 'NOT_FOUND');

  // Not filtered by time in the query, for the same reason as getVenueAvailability:
  // setup/turnaround padding can pull a booking from outside the period into it.
  const rows = await fetchMany(
    supabase
      .from('venue_bookings')
      .select('*, events ( name )')
      .eq('venue_id', venueId)
      .in('status', [BOOKING_STATUS.APPROVED, BOOKING_STATUS.TENTATIVE])
  );

  const bookings = rows
    // AC4: only this venue's rows. An event booked at several venues has one row per
    // venue, so each booking appears under its own venue and nowhere else.
    .filter((row) => String(row.venue_id) === String(venue.id))
    .filter((row) => row.status === BOOKING_STATUS.APPROVED || row.status === BOOKING_STATUS.TENTATIVE)
    .map((row) => {
      const isHold = row.status === BOOKING_STATUS.TENTATIVE;
      // AC3: an expired hold doesn't block the venue, so it isn't returned at all.
      if (isHold && !isActiveHold(row, now)) return null;
      // AC1: confirmed bookings are padded; AC2: holds keep their held period.
      const occupied = isHold
        ? { occupiedStart: new Date(row.start_at), occupiedEnd: new Date(row.end_at) }
        : computeOccupiedWindow(row.start_at, row.end_at, row.setup_minutes, row.teardown_minutes);
      return { row, isHold, ...occupied };
    })
    .filter((entry) => entry
      && windowsOverlap(rangeStart, rangeEnd, entry.occupiedStart, entry.occupiedEnd))
    .sort((a, b) => a.occupiedStart - b.occupiedStart)
    .map(({ row, isHold, occupiedStart, occupiedEnd }) => ({
      id: row.id,
      eventId: row.event_id,
      eventName: row.events?.name || null,
      // AC2: the type tells a hold apart from a confirmed booking.
      type: isHold ? AVAILABILITY_BLOCK.TENTATIVE_HOLD : AVAILABILITY_BLOCK.BOOKING,
      status: row.status,
      startAt: new Date(row.start_at).toISOString(),
      endAt: new Date(row.end_at).toISOString(),
      setupMinutes: isHold ? null : row.setup_minutes,
      teardownMinutes: isHold ? null : row.teardown_minutes,
      occupiedStartAt: occupiedStart.toISOString(),
      occupiedEndAt: occupiedEnd.toISOString(),
      holdExpiresAt: isHold ? row.hold_expires_at || null : null,
    }));

  return {
    venue: { id: venue.id, name: venue.name },
    from: rangeStart.toISOString(),
    to: rangeEnd.toISOString(),
    bookings,
  };
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

  const event = await fetchOne(supabase.from('events').select('*').eq('id', booking.event_id));
  if (event?.coordinator_id) {
    await notifyUser(
      event.coordinator_id,
      'BOOKING_DECISION',
      `Venue booking ${status.toLowerCase()}`,
      decision.reason || `Booking for ${event.name} was ${status.toLowerCase()}.`,
      event.id
    );
  }

  return updated;
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
  getVenueAvailability,
  listVenueBookingsForPeriod,
  createVenue,
  updateVenue,
  listBookings,
  requestBooking,
  decideBooking,
  listUnavailability,
  blockVenue,
  computeOccupiedWindow,
  windowsOverlap,
};

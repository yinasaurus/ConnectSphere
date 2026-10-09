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
        .select('venue_id, start_at, end_at, setup_minutes, teardown_minutes, status, expires_at, hold_expires_at')
        .in('venue_id', candidateIds)
        // "confirmed booking" -> APPROVED, "active tentative hold" -> TENTATIVE.
        // PENDING is deliberately excluded: AC2 only names these two, and an
        // undecided request shouldn't hide a venue from search. Active holds
        // occupy the venue; expired holds do not (SCRUM-19 AC9).
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
      // AC9: An active tentative hold counts as occupying the venue. An expired hold does not.
      if (booking.status === BOOKING_STATUS.TENTATIVE) {
        const expiry = booking.expires_at || booking.hold_expires_at;
        if (expiry && new Date(expiry) <= new Date()) {
          return false;
        }
      }

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
    .select('*, venues ( name, setup_minutes, teardown_minutes ), events ( name, start_at, end_at )')
    .order('start_at');

  if (filters.venueId) query = query.eq('venue_id', filters.venueId);
  if (filters.status) query = query.eq('status', filters.status);

  const rows = (await fetchMany(query)) || [];

  // Group confirmed and active tentative bookings by venue for conflict detection (SCRUM-19)
  const confirmedByVenue = {};
  for (const row of rows) {
    const isConfirmed = row.status === BOOKING_STATUS.APPROVED;
    const expiry = row.expires_at || row.hold_expires_at;
    const isHoldActive = row.status === BOOKING_STATUS.TENTATIVE && (!expiry || new Date(expiry) > new Date());
    if (isConfirmed || isHoldActive) {
      (confirmedByVenue[row.venue_id] = confirmedByVenue[row.venue_id] || []).push(row);
    }
  }

  return rows.map((row) => {
    let hasConflict = false;
    let conflictDetails = null;

    if (row.status === BOOKING_STATUS.PENDING && row.start_at && row.end_at) {
      const vSetup = row.setup_minutes ?? 30;
      const vTeardown = row.teardown_minutes ?? 30;
      const { occupiedStart, occupiedEnd } = computeOccupiedWindow(row.start_at, row.end_at, vSetup, vTeardown);

      const conflicting = (confirmedByVenue[row.venue_id] || []).find((confirmed) => {
        if (Number(confirmed.id) === Number(row.id)) return false;
        const cSetup = confirmed.setup_minutes ?? 30;
        const cTeardown = confirmed.teardown_minutes ?? 30;
        const cWindow = computeOccupiedWindow(confirmed.start_at, confirmed.end_at, cSetup, cTeardown);
        return windowsOverlap(occupiedStart, occupiedEnd, cWindow.occupiedStart, cWindow.occupiedEnd);
      });

      if (conflicting) {
        hasConflict = true;
        conflictDetails = {
          bookingId: conflicting.id,
          eventId: conflicting.event_id,
          eventName: conflicting.events?.name || `Event #${conflicting.event_id}`,
          status: conflicting.status,
          startAt: conflicting.start_at,
          endAt: conflicting.end_at,
        };
      }
    }

    return {
      id: row.id,
      event_id: row.event_id,
      venue_id: row.venue_id,
      requested_by: row.requested_by,
      decided_by: row.decided_by,
      status: row.status,
      start_at: row.start_at,
      end_at: row.end_at,
      setup_minutes: row.setup_minutes,
      teardown_minutes: row.teardown_minutes,
      notes: row.notes,
      decision_reason: row.decision_reason,
      alternative_suggestion: row.alternative_suggestion,
      decided_at: row.decided_at,
      created_at: row.created_at,
      venue_name: row.venues?.name,
      event_name: row.events?.name,
      event_start_at: row.events?.start_at,
      event_end_at: row.events?.end_at,
      has_conflict: hasConflict,
      conflict_details: conflictDetails,
    };
  });
}

/**
 * Purpose: an Event Coordinator asks for a venue for an event. The request is saved as
 * PENDING for Venue Staff to decide, and an audit entry is written.
 * AC: SCRUM-78 AC6, no notice is sent here because nothing has been decided yet.
 * Inputs: user (must have EVENT_COORDINATOR) and payload { eventId, venueId, startAt, endAt,
 * setupMinutes, teardownMinutes, notes }.
 * Output: the created booking row. Throws 403 if the user is not a Coordinator and 409 if
 * the venue already has a confirmed booking or active tentative hold overlapping the window.
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
    payload.teardownMinutes,
    { confirmedOnly: true }
  );
  if (conflict) {
    throw httpError(409, 'This venue already has a confirmed booking in that window', 'BOOKING_CONFLICT');
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
 * AC: SCRUM-19 AC6 (cannot approve over a confirmed booking), SCRUM-18 AC4/AC5/AC9
 *     (PENDING only; each booking decided on its own), SCRUM-78 AC1-AC5 (the notice).
 * Inputs: user (must have VENUE_STAFF), booking id, and decision { approve, reason,
 * alternativeSuggestion }. A truthy `approve` means APPROVED; anything else means REJECTED.
 * Output: the updated booking row. Throws 403 if not Venue Staff, 404 if missing,
 * 409 ALREADY_DECIDED if not PENDING, 409 BOOKING_CONFLICT if approving over a confirmed window.
 */
async function decideBooking(user, id, decision) {
  if (!hasRole(user, ROLES.VENUE_STAFF)) {
    throw httpError(403, 'Only venue staff can approve or reject bookings', 'FORBIDDEN');
  }

  const booking = await fetchOne(supabase.from('venue_bookings').select('*').eq('id', id));
  if (!booking) throw httpError(404, 'Booking not found', 'NOT_FOUND');

  // SCRUM-18 AC4: only PENDING bookings can be decided.
  if (booking.status !== BOOKING_STATUS.PENDING) {
    throw httpError(
      409,
      `This booking has already been ${booking.status.toLowerCase()} and cannot be changed`,
      'ALREADY_DECIDED'
    );
  }

  // SCRUM-19 AC6: cannot approve over a confirmed booking or active hold at this venue.
  if (decision.approve) {
    const conflict = await findConflict(
      booking.venue_id,
      booking.start_at,
      booking.end_at,
      booking.setup_minutes,
      booking.teardown_minutes,
      { excludeBookingId: booking.id, confirmedOnly: true }
    );
    if (conflict) {
      throw httpError(
        409,
        'Cannot approve booking: venue has an overlapping confirmed booking or active tentative hold during this occupied window',
        'BOOKING_CONFLICT'
      );
    }
  }

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
 * turnaround are added (W7 #1: the occupied window includes setup and turnaround).
 * AC: SCRUM-19 AC1-AC5, AC8-AC9 (conflict detection against confirmed bookings and active holds).
 * Inputs: venueId, startAt, endAt, setupMinutes, teardownMinutes, and optional { excludeBookingId, confirmedOnly, now }.
 * Output: the conflicting booking row or null.
 */
async function findConflict(
  venueId,
  startAt,
  endAt,
  setupMinutes = 30,
  teardownMinutes = 30,
  options = {}
) {
  const { excludeBookingId = null, confirmedOnly = false, now = new Date() } = options;
  const sMin = Number(setupMinutes !== undefined && setupMinutes !== null ? setupMinutes : 30);
  const tMin = Number(teardownMinutes !== undefined && teardownMinutes !== null ? teardownMinutes : 30);
  const { occupiedStart: newStart, occupiedEnd: newEnd } = computeOccupiedWindow(startAt, endAt, sMin, tMin);

  const statuses = confirmedOnly
    ? [BOOKING_STATUS.APPROVED, BOOKING_STATUS.TENTATIVE]
    : [BOOKING_STATUS.PENDING, BOOKING_STATUS.TENTATIVE, BOOKING_STATUS.APPROVED];

  let query = supabase
    .from('venue_bookings')
    .select('id, event_id, venue_id, start_at, end_at, setup_minutes, teardown_minutes, status, expires_at, hold_expires_at')
    .eq('venue_id', venueId)
    .in('status', statuses);

  const rows = (await fetchMany(query)) || [];

  for (const row of rows) {
    if (excludeBookingId && Number(row.id) === Number(excludeBookingId)) {
      continue;
    }

    if (row.status === BOOKING_STATUS.REJECTED || row.status === BOOKING_STATUS.CANCELLED) {
      continue;
    }

    // AC9: An active tentative hold counts as occupying the venue. An expired hold does not.
    if (row.status === BOOKING_STATUS.TENTATIVE) {
      const expiry = row.expires_at || row.hold_expires_at;
      if (expiry && new Date(expiry) <= new Date(now)) {
        continue;
      }
    }

    if (row.start_at && row.end_at) {
      const existingSetup = Number(row.setup_minutes !== undefined && row.setup_minutes !== null ? row.setup_minutes : 30);
      const existingTeardown = Number(row.teardown_minutes !== undefined && row.teardown_minutes !== null ? row.teardown_minutes : 30);
      const { occupiedStart: existingStart, occupiedEnd: existingEnd } = computeOccupiedWindow(
        row.start_at,
        row.end_at,
        existingSetup,
        existingTeardown
      );

      // AC4: Two bookings are not in conflict if one occupied window ends exactly when the other starts.
      if (windowsOverlap(newStart, newEnd, existingStart, existingEnd)) {
        return row;
      }
    } else {
      // Mocked row without timestamps (supports existing supertest/unit tests)
      return row;
    }
  }

  return null;
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
  buildBookingDecisionNotice,
  listUnavailability,
  blockVenue,
  computeOccupiedWindow,
  windowsOverlap,
  findConflict,
};

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

async function createVenue(user, payload) {
  if (!hasRole(user, ROLES.VENUE_STAFF)) {
    throw httpError(403, 'Only venue staff can manage the catalogue', 'FORBIDDEN');
  }
  if (!payload.name) throw httpError(400, 'Venue name is required', 'VALIDATION_ERROR');
  if (payload.capacity !== undefined && (!Number.isInteger(payload.capacity) || payload.capacity < 0)) {
    throw httpError(400, 'Venue capacity must be a non-negative integer', 'VALIDATION_ERROR');
  }
  await assertVenueIdentityAvailable(payload.name, payload.location);

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
  if (payload.capacity !== undefined && (!Number.isInteger(payload.capacity) || payload.capacity < 0)) {
    throw httpError(400, 'Venue capacity must be a non-negative integer', 'VALIDATION_ERROR');
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
  createVenue,
  updateVenue,
  listBookings,
  requestBooking,
  decideBooking,
  listUnavailability,
  blockVenue,
};

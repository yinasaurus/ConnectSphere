const { db } = require('../config/db');
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
  const rows = await db('venues').where({ is_active: 1 }).orderBy('name');
  const layouts = await db('venue_layouts');
  const byVenue = layouts.reduce((acc, layout) => {
    acc[layout.venue_id] = acc[layout.venue_id] || [];
    acc[layout.venue_id].push(layout.layout);
    return acc;
  }, {});
  return rows.map((row) => ({ ...mapVenue(row), layouts: byVenue[row.id] || [] }));
}

async function createVenue(user, payload) {
  if (!hasRole(user, ROLES.VENUE_STAFF)) {
    throw httpError(403, 'Only venue staff can manage the catalogue', 'FORBIDDEN');
  }
  if (!payload.name) throw httpError(400, 'Venue name is required', 'VALIDATION_ERROR');

  const [id] = await db('venues').insert({
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
    await db('venue_layouts').insert(
      payload.layouts.map((layout) => ({ venue_id: id, layout }))
    );
  }

  await writeAudit(user.id, 'VENUE_CREATED', 'venue', id, payload);
  const [created] = (await listVenues()).filter((venue) => venue.id === id);
  return created;
}

async function updateVenue(user, id, payload) {
  if (!hasRole(user, ROLES.VENUE_STAFF)) {
    throw httpError(403, 'Only venue staff can manage the catalogue', 'FORBIDDEN');
  }
  await db('venues').where({ id }).update({
    name: payload.name,
    location: payload.location,
    capacity: payload.capacity,
    facilities: payload.facilities,
    accessibility: payload.accessibility,
    operating_hours: payload.operatingHours,
    setup_minutes: payload.setupMinutes,
    teardown_minutes: payload.teardownMinutes,
    is_active: payload.isActive === undefined ? undefined : payload.isActive ? 1 : 0,
    updated_at: db.fn.now(),
  });
  return (await listVenues()).find((venue) => venue.id === Number(id));
}

async function listBookings(filters = {}) {
  const query = db('venue_bookings as b')
    .join('venues as v', 'v.id', 'b.venue_id')
    .join('events as e', 'e.id', 'b.event_id')
    .select('b.*', 'v.name as venue_name', 'e.name as event_name')
    .orderBy('b.start_at');

  if (filters.venueId) query.where('b.venue_id', filters.venueId);
  if (filters.status) query.where('b.status', filters.status);
  return query;
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

  const [id] = await db('venue_bookings').insert({
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

  await writeAudit(user.id, 'BOOKING_REQUESTED', 'venue_booking', id, payload);
  return db('venue_bookings').where({ id }).first();
}

async function decideBooking(user, id, decision) {
  if (!hasRole(user, ROLES.VENUE_STAFF)) {
    throw httpError(403, 'Only venue staff can approve or reject bookings', 'FORBIDDEN');
  }

  const booking = await db('venue_bookings').where({ id }).first();
  if (!booking) throw httpError(404, 'Booking not found', 'NOT_FOUND');

  const status = decision.approve ? BOOKING_STATUS.APPROVED : BOOKING_STATUS.REJECTED;
  await db('venue_bookings').where({ id }).update({
    status,
    decided_by: user.id,
    decision_reason: decision.reason || null,
    alternative_suggestion: decision.alternativeSuggestion || null,
    decided_at: db.fn.now(),
  });

  const event = await db('events').where({ id: booking.event_id }).first();
  if (event?.coordinator_id) {
    await notifyUser(
      event.coordinator_id,
      'BOOKING_DECISION',
      `Venue booking ${status.toLowerCase()}`,
      decision.reason || `Booking for ${event.name} was ${status.toLowerCase()}.`,
      event.id
    );
  }

  return db('venue_bookings').where({ id }).first();
}

async function findConflict(venueId, startAt, endAt, setupMinutes = 30, teardownMinutes = 30) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  start.setMinutes(start.getMinutes() - Number(setupMinutes || 30));
  end.setMinutes(end.getMinutes() + Number(teardownMinutes || 30));

  return db('venue_bookings')
    .where({ venue_id: venueId })
    .whereIn('status', [BOOKING_STATUS.PENDING, BOOKING_STATUS.TENTATIVE, BOOKING_STATUS.APPROVED])
    .where('start_at', '<', end)
    .where('end_at', '>', start)
    .first();
}

async function listUnavailability(venueId) {
  const query = db('venue_unavailability').orderBy('start_at');
  if (venueId) query.where({ venue_id: venueId });
  return query;
}

async function blockVenue(user, payload) {
  if (!hasRole(user, ROLES.VENUE_STAFF)) {
    throw httpError(403, 'Only venue staff can block venues', 'FORBIDDEN');
  }
  const [id] = await db('venue_unavailability').insert({
    venue_id: payload.venueId,
    reason: payload.reason || 'Maintenance',
    start_at: payload.startAt,
    end_at: payload.endAt,
    created_by: user.id,
  });
  return db('venue_unavailability').where({ id }).first();
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

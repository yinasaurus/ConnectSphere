const { db } = require('../config/db');
const { ROLES } = require('../constants/roles');
const { EVENT_STATUS, SIGNIFICANT_FIELDS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');
const { hasRole } = require('../middleware/auth');
const { assertTransition } = require('../domain/statusMachine');
const { writeAudit, notifyUser } = require('./audit.service');

// SCUM-14: fields the customer briefing marks compulsory for a submitted event request.
// Drafts (SCUM-15) intentionally skip this — only `name` is required to save a draft.
const REQUIRED_FOR_SUBMISSION = [
  { column: 'name', field: 'name', label: 'Event name' },
  { column: 'purpose', field: 'purpose', label: 'Purpose' },
  { column: 'description', field: 'description', label: 'Description' },
  { column: 'start_at', field: 'startAt', label: 'Start date/time' },
  { column: 'end_at', field: 'endAt', label: 'End date/time' },
  { column: 'expected_attendance', field: 'expectedAttendance', label: 'Expected attendance' },
  { column: 'venue_requirements', field: 'venueRequirements', label: 'Venue requirements' },
  { column: 'accessibility_needs', field: 'accessibilityNeeds', label: 'Accessibility requirements' },
];

// MySQL DATETIME columns reject ISO 8601 strings with a `T`/`Z` (what the
// frontend sends via `.toISOString()`) under strict SQL mode. Converting to a
// real Date object here lets mysql2 format it correctly on insert/update.
function toSqlDateTime(value) {
  return value ? new Date(value) : null;
}

function findMissingSubmissionFields(row) {
  return REQUIRED_FOR_SUBMISSION.filter(({ column }) => {
    const value = row[column];
    if (column === 'expected_attendance') return !value || value <= 0;
    return value === null || value === undefined || String(value).trim() === '';
  });
}

function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    organisationId: row.organisation_id,
    organiserId: row.organiser_id,
    coordinatorId: row.coordinator_id,
    clonedFromEventId: row.cloned_from_event_id,
    name: row.name,
    description: row.description,
    purpose: row.purpose,
    category: row.category,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
    expectedAttendance: row.expected_attendance,
    accessibilityNeeds: row.accessibility_needs,
    layoutPreference: row.layout_preference,
    venueRequirements: row.venue_requirements,
    equipmentNotes: row.equipment_notes,
    specialRequests: row.special_requests,
    registrationRequired: Boolean(row.registration_required),
    registrationOpensAt: row.registration_opens_at,
    registrationClosesAt: row.registration_closes_at,
    registrationCapacity: row.registration_capacity,
    registrationOpen: Boolean(row.registration_open),
    rejectionReason: row.rejection_reason,
    operationalNotes: row.operational_notes,
    venueReady: Boolean(row.venue_ready),
    equipmentReady: Boolean(row.equipment_ready),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    organisationName: row.organisation_name,
    organiserName: row.organiser_name,
    coordinatorName: row.coordinator_name,
  };
}

function eventQuery() {
  return db('events as e')
    .leftJoin('organisations as o', 'o.id', 'e.organisation_id')
    .leftJoin('users as organiser', 'organiser.id', 'e.organiser_id')
    .leftJoin('users as coordinator', 'coordinator.id', 'e.coordinator_id')
    .select(
      'e.*',
      'o.name as organisation_name',
      'organiser.full_name as organiser_name',
      'coordinator.full_name as coordinator_name'
    );
}

function applyVisibility(query, user) {
  if (hasRole(user, ROLES.EVENT_COORDINATOR)
    || hasRole(user, ROLES.VENUE_STAFF)
    || hasRole(user, ROLES.TECHNICAL_SUPPORT)) {
    return query;
  }

  if (hasRole(user, ROLES.EVENT_ORGANISER) && user.organisationId) {
    query.where('e.organisation_id', user.organisationId);
    return query;
  }

  if (hasRole(user, ROLES.ATTENDEE)) {
    query.where('e.status', EVENT_STATUS.CONFIRMED);
    query.where('e.registration_required', 1);
    return query;
  }

  query.whereRaw('1 = 0');
  return query;
}

async function listEvents(user, filters = {}) {
  const query = applyVisibility(eventQuery(), user).orderBy('e.start_at', 'asc');

  if (filters.status) query.where('e.status', filters.status);
  if (filters.q) {
    query.where((builder) => {
      builder
        .where('e.name', 'like', `%${filters.q}%`)
        .orWhere('e.purpose', 'like', `%${filters.q}%`);
    });
  }

  const rows = await query;
  return rows.map(mapEvent);
}

async function getEvent(user, id) {
  const row = await applyVisibility(eventQuery(), user).where('e.id', id).first();
  if (!row) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return mapEvent(row);
}

async function createEvent(user, payload) {
  if (!hasRole(user, ROLES.EVENT_ORGANISER) && !hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'Only organisers can create event requests', 'FORBIDDEN');
  }

  const name = (payload.name || '').trim();
  if (!name) throw httpError(400, 'Event name is required', 'VALIDATION_ERROR');

  const [id] = await db('events').insert({
    organisation_id: user.organisationId || payload.organisationId || null,
    organiser_id: hasRole(user, ROLES.EVENT_ORGANISER) ? user.id : payload.organiserId || user.id,
    cloned_from_event_id: payload.clonedFromEventId || null,
    name,
    description: payload.description || null,
    purpose: payload.purpose || null,
    category: payload.category || 'OTHER',
    status: EVENT_STATUS.DRAFT,
    start_at: toSqlDateTime(payload.startAt),
    end_at: toSqlDateTime(payload.endAt),
    expected_attendance: payload.expectedAttendance || null,
    accessibility_needs: payload.accessibilityNeeds || null,
    layout_preference: payload.layoutPreference || null,
    venue_requirements: payload.venueRequirements || null,
    equipment_notes: payload.equipmentNotes || null,
    special_requests: payload.specialRequests || null,
    registration_required: payload.registrationRequired ? 1 : 0,
    registration_capacity: payload.registrationCapacity || payload.expectedAttendance || null,
  });

  await writeAudit(user.id, 'EVENT_CREATED', 'event', id, { name });
  return getEvent(user, id);
}

async function updateEvent(user, id, payload) {
  const existing = await db('events').where({ id }).first();
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');

  const isOrganiser = existing.organiser_id === user.id;
  const isAssignedCoordinator = existing.coordinator_id === user.id
    && hasRole(user, ROLES.EVENT_COORDINATOR);

  if (existing.status !== EVENT_STATUS.DRAFT && isOrganiser && !isAssignedCoordinator) {
    throw httpError(
      409,
      'After submission, organisers request changes through the assigned coordinator',
      'EDIT_LOCKED'
    );
  }

  if (existing.status === EVENT_STATUS.CONFIRMED && isAssignedCoordinator) {
    const significant = SIGNIFICANT_FIELDS.filter((field) => payload[field] !== undefined);
    if (significant.length) {
      throw httpError(
        409,
        'Confirmed events cannot be edited directly. Create a change request instead.',
        'EDIT_LOCKED'
      );
    }
  }

  if (!isOrganiser && !isAssignedCoordinator && !hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'You cannot edit this event', 'FORBIDDEN');
  }

  if (hasRole(user, ROLES.EVENT_COORDINATOR) && !isAssignedCoordinator && !isOrganiser) {
    throw httpError(403, 'Coordinators can only edit events assigned to them', 'FORBIDDEN');
  }

  const patch = toEventPatch(payload);
  patch.updated_at = db.fn.now();
  await db('events').where({ id }).update(patch);
  await writeAudit(user.id, 'EVENT_UPDATED', 'event', id, payload);
  return getEvent(user, id);
}

function toEventPatch(payload) {
  const map = {
    name: 'name',
    description: 'description',
    purpose: 'purpose',
    category: 'category',
    startAt: 'start_at',
    endAt: 'end_at',
    expectedAttendance: 'expected_attendance',
    accessibilityNeeds: 'accessibility_needs',
    layoutPreference: 'layout_preference',
    venueRequirements: 'venue_requirements',
    equipmentNotes: 'equipment_notes',
    specialRequests: 'special_requests',
    registrationRequired: 'registration_required',
    registrationOpensAt: 'registration_opens_at',
    registrationClosesAt: 'registration_closes_at',
    registrationCapacity: 'registration_capacity',
    registrationOpen: 'registration_open',
    operationalNotes: 'operational_notes',
    venueReady: 'venue_ready',
    equipmentReady: 'equipment_ready',
  };

  const dateFields = new Set(['start_at', 'end_at', 'registration_opens_at', 'registration_closes_at']);

  const patch = {};
  for (const [from, to] of Object.entries(map)) {
    if (payload[from] !== undefined) {
      if (from === 'registrationRequired' || from === 'registrationOpen'
        || from === 'venueReady' || from === 'equipmentReady') {
        patch[to] = payload[from] ? 1 : 0;
      } else if (dateFields.has(to)) {
        patch[to] = toSqlDateTime(payload[from]);
      } else {
        patch[to] = payload[from];
      }
    }
  }
  return patch;
}

async function submitEvent(user, id) {
  const existing = await db('events').where({ id }).first();
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (existing.organiser_id !== user.id && !hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'Only the organiser can submit this request', 'FORBIDDEN');
  }

  const missing = findMissingSubmissionFields(existing);
  if (missing.length) {
    throw httpError(
      400,
      `Complete required fields before submitting: ${missing.map((m) => m.label).join(', ')}`,
      'VALIDATION_ERROR',
      { fields: missing.map((m) => m.field) }
    );
  }

  const from = existing.status === EVENT_STATUS.REJECTED
    ? EVENT_STATUS.REJECTED
    : existing.status;
  assertTransition(from, EVENT_STATUS.SUBMITTED);

  const coordinatorId = existing.coordinator_id || await assignCoordinator();
  await db('events').where({ id }).update({
    status: EVENT_STATUS.UNDER_REVIEW,
    coordinator_id: coordinatorId,
    rejection_reason: null,
    updated_at: db.fn.now(),
  });

  await writeStatusHistory(id, user.id, existing.status, EVENT_STATUS.UNDER_REVIEW, 'Submitted for review');
  await writeAudit(user.id, 'EVENT_SUBMITTED', 'event', id, { coordinatorId });
  await notifyUser(
    coordinatorId,
    'EVENT_ASSIGNED',
    'New event assigned to you',
    `${existing.name} is waiting for review.`,
    id
  );

  return getEvent(user, id);
}

async function changeStatus(user, id, nextStatus, reason) {
  if (!hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'Only coordinators can change event status', 'FORBIDDEN');
  }

  const existing = await db('events').where({ id }).first();
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (existing.coordinator_id && existing.coordinator_id !== user.id) {
    throw httpError(403, 'Only the assigned coordinator can update this event', 'FORBIDDEN');
  }

  assertTransition(existing.status, nextStatus);

  const patch = {
    status: nextStatus,
    updated_at: db.fn.now(),
  };

  if (nextStatus === EVENT_STATUS.REJECTED) {
    patch.rejection_reason = reason || 'Rejected';
  }
  if (nextStatus === EVENT_STATUS.CONFIRMED) {
    const ready = await isReadyToConfirm(existing);
    if (!ready.ok) {
      throw httpError(409, ready.message, 'NOT_READY_TO_CONFIRM');
    }
  }

  await db('events').where({ id }).update(patch);
  await writeStatusHistory(id, user.id, existing.status, nextStatus, reason || null);
  await writeAudit(user.id, 'EVENT_STATUS_CHANGED', 'event', id, {
    from: existing.status,
    to: nextStatus,
    reason,
  });

  if (existing.organiser_id) {
    await notifyUser(
      existing.organiser_id,
      'EVENT_STATUS_CHANGED',
      `Event ${nextStatus.toLowerCase().replace('_', ' ')}`,
      `${existing.name} is now ${nextStatus}.`,
      id
    );
  }

  return getEvent(user, id);
}

async function isReadyToConfirm(event) {
  const booking = await db('venue_bookings')
    .where({ event_id: event.id, status: 'APPROVED' })
    .first();
  if (!booking) {
    return { ok: false, message: 'A venue booking must be approved before confirmation' };
  }
  return { ok: true };
}

async function assignCoordinator() {
  const coordinators = await db('user_roles as ur')
    .join('users as u', 'u.id', 'ur.user_id')
    .where('ur.role', ROLES.EVENT_COORDINATOR)
    .where('u.is_active', 1)
    .select('u.id');

  if (!coordinators.length) {
    throw httpError(409, 'No event coordinators are available', 'NO_COORDINATOR');
  }

  const loads = await Promise.all(coordinators.map(async (coordinator) => {
    const [{ count }] = await db('events')
      .where({ coordinator_id: coordinator.id })
      .whereNotIn('status', [EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED, EVENT_STATUS.REJECTED])
      .count({ count: '*' });
    return { id: coordinator.id, count: Number(count) };
  }));

  loads.sort((a, b) => a.count - b.count || a.id - b.id);
  return loads[0].id;
}

async function requestCoordinatorChange(user, eventId, newCoordinatorId) {
  const existing = await db('events').where({ id: eventId }).first();
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (existing.coordinator_id !== user.id) {
    throw httpError(403, 'Only the current coordinator can request a reassignment', 'FORBIDDEN');
  }

  await db('coordinator_reassignments').insert({
    event_id: eventId,
    from_coordinator_id: user.id,
    to_coordinator_id: newCoordinatorId,
    status: 'PENDING',
  });

  await notifyUser(
    newCoordinatorId,
    'COORDINATOR_REASSIGN',
    'Coordinator reassignment requested',
    `${user.fullName} asked you to take over ${existing.name}.`,
    eventId
  );

  return { ok: true };
}

async function acceptCoordinatorChange(user, eventId) {
  const request = await db('coordinator_reassignments')
    .where({ event_id: eventId, to_coordinator_id: user.id, status: 'PENDING' })
    .first();
  if (!request) throw httpError(404, 'No pending reassignment found', 'NOT_FOUND');

  await db('events').where({ id: eventId }).update({
    coordinator_id: user.id,
    updated_at: db.fn.now(),
  });
  await db('coordinator_reassignments').where({ id: request.id }).update({
    status: 'ACCEPTED',
    resolved_at: db.fn.now(),
  });
  return getEvent(user, eventId);
}

async function writeStatusHistory(eventId, actorId, fromStatus, toStatus, note) {
  await db('event_status_history').insert({
    event_id: eventId,
    actor_id: actorId,
    from_status: fromStatus,
    to_status: toStatus,
    note,
  });
}

async function listHistory(user, eventId) {
  await getEvent(user, eventId);
  return db('event_status_history as h')
    .leftJoin('users as u', 'u.id', 'h.actor_id')
    .where('h.event_id', eventId)
    .orderBy('h.created_at', 'desc')
    .select('h.*', 'u.full_name as actor_name');
}

module.exports = {
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  submitEvent,
  changeStatus,
  requestCoordinatorChange,
  acceptCoordinatorChange,
  listHistory,
  findMissingSubmissionFields,
};

const { supabase, fetchOne, fetchMany, fetchCount, insertOne, updateById } = require('../config/db');
const { ROLES } = require('../constants/roles');
const { EVENT_STATUS, SIGNIFICANT_FIELDS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');
const { hasRole } = require('../middleware/auth');
const { assertTransition } = require('../domain/statusMachine');
const { writeAudit, notifyUser } = require('./audit.service');

const EVENT_SELECT = `
  *,
  organisation:organisations ( name ),
  organiser:users!organiser_id ( full_name ),
  coordinator:users!coordinator_id ( full_name )
`;
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
    organisationName: row.organisation?.name || null,
    organiserName: row.organiser?.full_name || null,
    coordinatorName: row.coordinator?.full_name || null,
  };
}

function canViewEvent(user, row) {
  if (hasRole(user, ROLES.EVENT_COORDINATOR)
    || hasRole(user, ROLES.VENUE_STAFF)
    || hasRole(user, ROLES.TECHNICAL_SUPPORT)) {
    return true;
  }
  if (hasRole(user, ROLES.EVENT_ORGANISER) && user.organisationId) {
    return row.organisation_id === user.organisationId;
  }
  if (hasRole(user, ROLES.ATTENDEE)) {
    return row.status === EVENT_STATUS.CONFIRMED && row.registration_required;
  }
  return false;
}

function canViewPlanning(user) {
  return [ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF, ROLES.TECHNICAL_SUPPORT]
    .some((role) => hasRole(user, role));
}

function visibleEvent(user, row) {
  const event = mapEvent(row);
  if (canViewPlanning(user)) return event;
  // Attendees receive registration details, not internal planning fields.
  const { id, name, description, purpose, category, status, startAt, endAt,
    registrationRequired, registrationOpensAt, registrationClosesAt,
    registrationCapacity, registrationOpen } = event;
  return { id, name, description, purpose, category, status, startAt, endAt,
    registrationRequired, registrationOpensAt, registrationClosesAt,
    registrationCapacity, registrationOpen };
}

async function assertPlanningAccess(user, eventId) {
  if (!canViewPlanning(user)) throw httpError(403, 'Planning information is restricted', 'FORBIDDEN');
  return getEvent(user, eventId);
}

function applyVisibility(query, user) {
  if (hasRole(user, ROLES.EVENT_COORDINATOR)
    || hasRole(user, ROLES.VENUE_STAFF)
    || hasRole(user, ROLES.TECHNICAL_SUPPORT)) {
    return query;
  }
  if (hasRole(user, ROLES.EVENT_ORGANISER) && user.organisationId) {
    return query.eq('organisation_id', user.organisationId);
  }
  if (hasRole(user, ROLES.ATTENDEE)) {
    return query.eq('status', EVENT_STATUS.CONFIRMED).eq('registration_required', true);
  }
  return query.eq('id', -1);
}

async function listEvents(user, filters = {}) {
  let query = applyVisibility(
    supabase.from('events').select(EVENT_SELECT).order('start_at', { ascending: true }),
    user
  );

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.q) {
    const term = String(filters.q).replace(/[,()%]/g, '');
    if (term) query = query.or(`name.ilike.%${term}%,purpose.ilike.%${term}%`);
  }

  const rows = await fetchMany(query);
  return rows.filter((row) => canViewEvent(user, row)).map((row) => visibleEvent(user, row));
}

async function getEvent(user, id) {
  const row = await fetchOne(
    supabase.from('events').select(EVENT_SELECT).eq('id', id)
  );
  if (!row || !canViewEvent(user, row)) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return visibleEvent(user, row);
}

async function listVenueBookings(user, eventId) {
  // Reuse event visibility before querying bookings, including client isolation.
  const event = await getEvent(user, eventId);
  let query = supabase.from('venue_bookings')
      .select('id, event_id, venue_id, status, venues ( name )')
      .eq('event_id', event.id)
      .order('start_at');
  if (!canViewPlanning(user)) query = query.eq('status', 'APPROVED');
  const rows = await fetchMany(query);
  // Event readers need booking status, not internal notes or decision metadata.
  return rows.map((row) => ({
    id: row.id,
    event_id: row.event_id,
    venue_id: row.venue_id,
    status: row.status,
    venue_name: row.venues?.name || null,
  }));
}

async function createEvent(user, payload) {
  if (!hasRole(user, ROLES.EVENT_ORGANISER) && !hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'Only organisers can create event requests', 'FORBIDDEN');
  }

  const name = (payload.name || '').trim();
  if (!name) throw httpError(400, 'Event name is required', 'VALIDATION_ERROR');

  const created = await insertOne('events', {
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
    registration_required: Boolean(payload.registrationRequired),
    registration_capacity: payload.registrationCapacity || payload.expectedAttendance || null,
  });

  await writeAudit(user.id, 'EVENT_CREATED', 'event', created.id, { name });
  return getEvent(user, created.id);
}

async function updateEvent(user, id, payload) {
  const existing = await fetchOne(supabase.from('events').select('*').eq('id', id));
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
  patch.updated_at = new Date().toISOString();
  await updateById('events', id, patch);
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
        patch[to] = Boolean(payload[from]);
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
  const existing = await fetchOne(supabase.from('events').select('*').eq('id', id));
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');
  const ownsRequest = existing.organiser_id === user.id
    && (hasRole(user, ROLES.EVENT_ORGANISER) || hasRole(user, ROLES.EVENT_COORDINATOR));
  const assignedCoordinator = existing.coordinator_id === user.id
    && hasRole(user, ROLES.EVENT_COORDINATOR);
  if (!ownsRequest && !assignedCoordinator) {
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
  await updateById('events', id, {
    status: EVENT_STATUS.UNDER_REVIEW,
    coordinator_id: coordinatorId,
    rejection_reason: null,
    updated_at: new Date().toISOString(),
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

  const existing = await fetchOne(supabase.from('events').select('*').eq('id', id));
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (existing.coordinator_id !== user.id) {
    throw httpError(403, 'Only the assigned coordinator can update this event', 'FORBIDDEN');
  }

  assertTransition(existing.status, nextStatus);

  const patch = {
    status: nextStatus,
    updated_at: new Date().toISOString(),
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

  await updateById('events', id, patch);
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
  const booking = await fetchOne(
    supabase
      .from('venue_bookings')
      .select('id')
      .eq('event_id', event.id)
      .eq('status', 'APPROVED')
  );
  if (!booking) {
    return { ok: false, message: 'A venue booking must be approved before confirmation' };
  }
  return { ok: true };
}

async function assignCoordinator() {
  const roleRows = await fetchMany(
    supabase.from('user_roles').select('user_id').eq('role', ROLES.EVENT_COORDINATOR)
  );
  const ids = roleRows.map((row) => row.user_id);
  if (!ids.length) {
    throw httpError(409, 'No event coordinators are available', 'NO_COORDINATOR');
  }

  const coordinators = await fetchMany(
    supabase.from('users').select('id').in('id', ids).eq('is_active', true)
  );
  if (!coordinators.length) {
    throw httpError(409, 'No event coordinators are available', 'NO_COORDINATOR');
  }

  const loads = await Promise.all(coordinators.map(async (coordinator) => {
    const count = await fetchCount(
      supabase
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('coordinator_id', coordinator.id)
        .not('status', 'in', '(COMPLETED,CANCELLED,REJECTED)')
    );
    return { id: coordinator.id, count };
  }));

  loads.sort((a, b) => a.count - b.count || a.id - b.id);
  return loads[0].id;
}

async function requestCoordinatorChange(user, eventId, newCoordinatorId) {
  const existing = await fetchOne(supabase.from('events').select('*').eq('id', eventId));
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (existing.coordinator_id !== user.id) {
    throw httpError(403, 'Only the current coordinator can request a reassignment', 'FORBIDDEN');
  }

  await insertOne('coordinator_reassignments', {
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
  const request = await fetchOne(
    supabase
      .from('coordinator_reassignments')
      .select('*')
      .eq('event_id', eventId)
      .eq('to_coordinator_id', user.id)
      .eq('status', 'PENDING')
  );
  if (!request) throw httpError(404, 'No pending reassignment found', 'NOT_FOUND');

  await updateById('events', eventId, {
    coordinator_id: user.id,
    updated_at: new Date().toISOString(),
  });
  await updateById('coordinator_reassignments', request.id, {
    status: 'ACCEPTED',
    resolved_at: new Date().toISOString(),
  });
  return getEvent(user, eventId);
}

async function writeStatusHistory(eventId, actorId, fromStatus, toStatus, note) {
  await insertOne('event_status_history', {
    event_id: eventId,
    actor_id: actorId,
    from_status: fromStatus,
    to_status: toStatus,
    note,
  });
}

async function listHistory(user, eventId) {
  await assertPlanningAccess(user, eventId);
  const rows = await fetchMany(
    supabase
      .from('event_status_history')
      .select('*, actor:users!actor_id ( full_name )')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
  );
  return rows.map((row) => ({
    ...row,
    actor_name: row.actor?.full_name || null,
  }));
}

module.exports = {
  listEvents,
  getEvent,
  listVenueBookings,
  assertPlanningAccess,
  createEvent,
  updateEvent,
  submitEvent,
  changeStatus,
  requestCoordinatorChange,
  acceptCoordinatorChange,
  listHistory,
  findMissingSubmissionFields,
};

const { supabase, fetchOne, fetchMany, insertOne, updateById } = require('../config/db');
const { ROLES } = require('../constants/roles');
const {
  EVENT_STATUS,
  EVENT_SUB_STATE,
  EVENT_DECISION,
  MIN_REJECTION_REASON_LENGTH,
  SIGNIFICANT_FIELDS,
  BOOKING_STATUS,
  CHANGE_REQUEST_STATUS,
  CHANGE_REQUEST_FIELDS,
} = require('../constants/statuses');
const { REJECTION_REASON_MESSAGE } = require('../validators/events.validators');
const { httpError } = require('../middleware/errorHandler');
const { hasRole } = require('../middleware/auth');
const { assertTransition, assertSubStateTransition } = require('../domain/statusMachine');
const { writeAudit, notifyUser } = require('./audit.service');
const { flagArrangementsForReview } = require('./criticalChange.service');

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

// Guards against events like "starts 6 Oct, ends 5 Oct" that are never valid,
// whichever of create/update set the dates. Skipped when either side is
// absent (e.g. a draft saved before its dates are filled in, SCUM-15).
function validateDateRange(startAt, endAt) {
  if (startAt === null || startAt === undefined || endAt === null || endAt === undefined) return;
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
  if (start >= end) {
    throw httpError(
      400,
      'Event start date/time must be before the end date/time',
      'VALIDATION_ERROR',
      { fields: ['startAt', 'endAt'] }
    );
  }
}

/**
 * Purpose: turns an events row (snake_case, with joined organisation/organiser/coordinator
 * names) into the camelCase event the API returns.
 * AC: SCRUM-39 AC2 (attendance, start/end date and time, venue needs and equipment notes
 * come from here).
 * Input: a database row or null. Output: the event object, or null for no row. Empty
 * columns stay null.
 */
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
    subState: row.sub_state || null,
    reviewRemarks: row.review_remarks || null,
    clarificationResponse: row.clarification_response || null,
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

/**
 * Purpose: true for internal staff who may read every event, including ones they
 * are not assigned to. Coordinators may view (not change) other people's events.
 * AC: SCRUM-54 AC6 (Coordinator view of unassigned / other events);
 *     Lead and Safety Officer need the same read access to use AC3 and AC4.
 * Business rule: W4 — Coordinators can view other events but not edit them.
 */
function isInternalEventReader(user) {
  return [
    ROLES.EVENT_COORDINATOR,
    ROLES.EVENT_COORDINATOR_LEAD,
    ROLES.SAFETY_OFFICER,
    ROLES.VENUE_STAFF,
    ROLES.TECHNICAL_SUPPORT,
  ].some((role) => hasRole(user, role));
}

/**
 * Purpose: decide whether this user may read this event row. Coordinators (and
 * other internal staff) may view events they are not assigned to.
 * AC: SCRUM-54 AC6. SCRUM-39 AC1 (who the "authorised users" are). SCRUM-65 AC5 —
 * the Lead can open a queued request to see its full details.
 * Business rule source: Week 4 Q&A, "Coordinator can view other events for planning
 * purpose"; Week 2 Q&A, Organisers can't view events of unrelated clients (requirements
 * document section 8b).
 * Rules: Coordinators, Lead, Safety Officer, Venue Staff and Technical Support see every
 * event; Organisers see their own organisation's (none if they have no organisation);
 * Attendees see only Confirmed events that take registrations; anyone else sees nothing.
 * Output: true or false. Never throws. getEvent treats false as 404 so we do not leak that the row exists.
 */
function canViewEvent(user, row) {
  if (isInternalEventReader(user)) {
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

/**
 * Purpose: whether a user's roles allow planning details (attendance, venue needs,
 * equipment, history, comments) rather than the public Attendee view.
 * AC: SCRUM-39 AC1 + AC2 (Attendees keep the public view, agreed decision).
 *     SCRUM-54 AC6 — Coordinators, Leads and Safety Officers are planning readers.
 *     SCRUM-65 AC4, AC5 — the Lead needs those planning fields on the queue and the detail page.
 *     SCRUM-71 AC1 — Lead is a planning reader so they can assign from the event page.
 * Output: true for Organiser, Coordinator, Lead, Safety Officer, Venue Staff or Technical Support; false otherwise.
 */
function canViewPlanning(user) {
  return [
    ROLES.EVENT_ORGANISER,
    ROLES.EVENT_COORDINATOR,
    ROLES.EVENT_COORDINATOR_LEAD,
    ROLES.SAFETY_OFFICER,
    ROLES.VENUE_STAFF,
    ROLES.TECHNICAL_SUPPORT,
  ].some((role) => hasRole(user, role));
}

/**
 * Purpose: returns the full event for planning roles and a reduced public copy for others.
 * AC: SCRUM-39 AC2 (planning roles get every AC2 field), AC1 (Attendees don't).
 * Inputs: the user and an events row the user may already see (checked by canViewEvent).
 */
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

/**
 * Purpose: constrain an events list query to rows this user is allowed to see.
 * AC: SCRUM-54 AC6 — internal staff (including Coordinators) are not filtered by assignment.
 *     SCRUM-65 AC1 — the Lead's queue is not limited to one organiser's organisation.
 *     SCRUM-71 AC1 — Lead sees all events, same as other internal staff, so unassigned Submitted ones appear.
 * Inputs: supabase query, session user. Output: the same query or a filter. Failure: unknown roles match no rows (id = -1).
 */
function applyVisibility(query, user) {
  if (isInternalEventReader(user)) {
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

/**
 * Purpose: list events the caller may see, optionally narrowed to the Lead's
 * unassigned queue (Submitted + no Coordinator) without building a queue UI.
 * AC: SCRUM-28 AC3, AC4 (queue membership is Submitted and unassigned; drafts are excluded)
 * Business rule: W7 #5 — viewing the queue is SCRUM-65; this only exposes the data set.
 * Inputs: user, filters.status, filters.unassigned, filters.subState, filters.q
 * Outputs: mapped events the user can view
 * Failure: none (empty list when nothing matches)
 */
async function listEvents(user, filters = {}) {
  let query = applyVisibility(
    supabase.from('events').select(EVENT_SELECT).order('start_at', { ascending: true }),
    user
  );

  if (filters.unassigned) {
    // Queue = Submitted and no Coordinator. Do not include drafts or assigned events.
    query = query.eq('status', EVENT_STATUS.SUBMITTED).is('coordinator_id', null);
  } else if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.subState) query = query.eq('sub_state', filters.subState);
  if (filters.q) {
    const term = String(filters.q).replace(/[,()%]/g, '');
    if (term) query = query.or(`name.ilike.%${term}%,purpose.ilike.%${term}%`);
  }

  const rows = await fetchMany(query);
  return rows
    .filter((row) => canViewEvent(user, row))
    .filter((row) => !filters.unassigned || isInUnassignedQueue(row))
    .map((row) => visibleEvent(user, row));
}

/**
 * Purpose: loads one event for the signed-in user, always fresh from the database, so the
 * details shown are the latest.
 * AC: SCRUM-39 AC1 + AC2. SCRUM-28 AC1, AC2 — after submit the organiser sees Submitted
 *     and no Coordinator.
 *     SCRUM-54 AC6 — Coordinators may view events they are not assigned to (view only).
 *     SCRUM-65 AC5 — the Lead can open any queued request's full details.
 * Inputs: the user and the event id. Output: the event as visibleEvent shapes it.
 * Failure: 404 "Event not found" both when it doesn't exist and when the user may not see
 * it, so outsiders can't tell the two apart.
 */
async function getEvent(user, id) {
  const row = await fetchOne(
    supabase.from('events').select(EVENT_SELECT).eq('id', id)
  );
  if (!row || !canViewEvent(user, row)) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return visibleEvent(user, row);
}

/**
 * Purpose: the venue bookings for one event (venue name and status), shown with its details.
 * AC: SCRUM-39 AC2 (venue). SCRUM-42 AC3 — includes needs_review so the event page can show
 *     "Requires review" without changing the booking status.
 * Attendees only get APPROVED bookings. Failure: 404 from getEvent, before bookings are read.
 */
async function listVenueBookings(user, eventId) {
  // Reuse event visibility before querying bookings, including client isolation.
  const event = await getEvent(user, eventId);
  let query = supabase.from('venue_bookings')
      // Return saved timing values so each event request can show its own occupied window.
      // Include venue capabilities so suitability remains assessable for inactive historical venues.
      // Include decision reason and alternative suggestion for planning roles (SCRUM-18 AC7).
      .select('id, event_id, venue_id, status, start_at, end_at, setup_minutes, teardown_minutes, created_at, decision_reason, alternative_suggestion, needs_review, venues ( name, capacity, facilities, accessibility, venue_layouts ( layout ) )')
      .eq('event_id', event.id)
      .order('created_at', { ascending: false });
  if (!canViewPlanning(user)) query = query.eq('status', 'APPROVED');
  const rows = await fetchMany(query);
  return rows.map((row) => {
    const item = {
      id: row.id,
      event_id: row.event_id,
      venue_id: row.venue_id,
      status: row.status,
      // Expose timing fields needed to display request dates and occupied windows.
      start_at: row.start_at,
      end_at: row.end_at,
      setup_minutes: row.setup_minutes,
      teardown_minutes: row.teardown_minutes,
      created_at: row.created_at,
      needs_review: Boolean(row.needs_review),
      venue_name: row.venues?.name || null,
      // Return only catalogue attributes needed to assess this request's venue independently.
      venue_details: row.venues ? {
        capacity: row.venues.capacity,
        facilities: row.venues.facilities,
        accessibility: row.venues.accessibility,
        layouts: (row.venues.venue_layouts || []).map((layout) => layout.layout),
      } : null,
    };
    if (canViewPlanning(user)) {
      if (row.decision_reason !== undefined) item.decision_reason = row.decision_reason;
      if (row.alternative_suggestion !== undefined) item.alternative_suggestion = row.alternative_suggestion;
    }
    return item;
  });
}

/**
 * Purpose: the equipment requested for one event (item, quantity, status), shown with the
 * event details so authorised users can see its equipment requirement in one place.
 * AC: SCRUM-39 AC2 (equipment requirement), AC1 (only users allowed to see the event).
 * Inputs: the signed-in user and the event id.
 * Output: [{ id, event_id, equipment_id, equipment_name, quantity, status, needs_review }], newest first.
 *     SCRUM-42 AC3 — needs_review is the review flag, not a status.
 * Failure: 403 for roles without planning access (Attendees get the public view only);
 * 404 if the event doesn't exist or the user can't see it (e.g. another organisation),
 * checked before any equipment is read.
 */
async function listEquipmentRequests(user, eventId) {
  if (!canViewPlanning(user)) throw httpError(403, 'Planning information is restricted', 'FORBIDDEN');
  const event = await getEvent(user, eventId);
  const rows = await fetchMany(
    supabase.from('equipment_requests')
      .select('id, event_id, equipment_id, quantity, status, needs_review, equipment ( name )')
      .eq('event_id', event.id)
      .order('id', { ascending: false })
  );
  // Decision reasons and who asked/decided are left out; readers need the requirement itself.
  return rows.map((row) => ({
    id: row.id,
    event_id: row.event_id,
    equipment_id: row.equipment_id,
    equipment_name: row.equipment?.name || null,
    quantity: row.quantity,
    status: row.status,
    needs_review: Boolean(row.needs_review),
  }));
}

/**
 * Purpose: save a new event request as a Draft so the organiser can finish it later (SCUM-15).
 * AC: SCRUM-28 AC4 — a draft stays DRAFT with no Coordinator and is not placed in the unassigned queue.
 * Inputs: user (organiser or coordinator), payload (name required; other fields optional)
 * Outputs: the created mapped event
 * Failure: 403 if the role cannot create; 400 if the name is missing or dates are invalid
 */
async function createEvent(user, payload) {
  if (!hasRole(user, ROLES.EVENT_ORGANISER) && !hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'Only organisers can create event requests', 'FORBIDDEN');
  }

  const name = (payload.name || '').trim();
  if (!name) throw httpError(400, 'Event name is required', 'VALIDATION_ERROR');

  validateDateRange(payload.startAt, payload.endAt);

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

/**
 * Purpose: patch an event the organiser still owns as a draft, or the assigned coordinator may edit.
 * AC: SCRUM-28 AC4 — saving more draft fields does not submit or place the request in the queue.
 *     SCRUM-54 AC5, AC6, AC7 — a Coordinator who is not assigned is refused and the row is unchanged.
 *     SCRUM-41 / SCRUM-42 — after a successful write, critical field changes flag affected
 *     venue/equipment rows for review (status unchanged).
 * Inputs: user, event id, payload of fields to change
 * Outputs: mapped event after the patch
 * Failure: 404 if missing; 403 FORBIDDEN with no event body when the coordinator is not assigned;
 *     409 if the organiser is locked after submit
 */
async function updateEvent(user, id, payload) {
  const existing = await fetchOne(supabase.from('events').select('*').eq('id', id));
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');

  const isOrganiser = existing.organiser_id === user.id;
  const isAssignedCoordinator = existing.coordinator_id === user.id
    && hasRole(user, ROLES.EVENT_COORDINATOR);

  const canOrganiserEdit = existing.status === EVENT_STATUS.DRAFT
    || (existing.status === EVENT_STATUS.UNDER_REVIEW && existing.sub_state === EVENT_SUB_STATE.ACTION_REQUIRED);

  if (!canOrganiserEdit && isOrganiser && !isAssignedCoordinator) {
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
  const nextStart = 'start_at' in patch ? patch.start_at : existing.start_at;
  const nextEnd = 'end_at' in patch ? patch.end_at : existing.end_at;
  validateDateRange(nextStart, nextEnd);

  patch.updated_at = new Date().toISOString();
  await updateById('events', id, patch);
  await writeAudit(user.id, 'EVENT_UPDATED', 'event', id, payload);
  // SCRUM-41 / SCRUM-42: after a real write, flag affected venue/equipment if a critical field changed.
  await flagArrangementsForReview(user, existing, { ...existing, ...patch });
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

/**
 * Purpose: membership test for the Lead's unassigned queue.
 * AC: SCRUM-28 AC1, AC3, AC4
 * Business rule: W7 #5 — a request is queued only while it is Submitted and has no Coordinator.
 * Inputs: event row (snake_case) or mapped event (camelCase)
 * Outputs: true if the request belongs in the unassigned queue
 * Failure: none (boolean)
 */
function isInUnassignedQueue(event) {
  if (!event) return false;
  const status = event.status;
  const coordinatorId = Object.prototype.hasOwnProperty.call(event, 'coordinatorId')
    ? event.coordinatorId
    : event.coordinator_id;
  return status === EVENT_STATUS.SUBMITTED && coordinatorId == null;
}

/**
 * Purpose: show the Lead every Submitted request that still has no Coordinator,
 * with the basic fields needed to choose someone (W7 #5).
 * AC: SCRUM-65 AC1, AC2, AC3, AC4
 * Business rule: W7 #5 — the Lead sees the unassigned queue before assigning (SCRUM-71).
 * Inputs: authenticated Lead. Output: mapped events (name, organiser, times, attendance, venue/equipment needs).
 * Failure: 403 if the caller is not a Lead. Assigned and Draft rows are never returned.
 */
async function listUnassignedQueue(user) {
  if (!hasRole(user, ROLES.EVENT_COORDINATOR_LEAD)) {
    throw httpError(403, 'Only an Event Coordinator Lead can open the unassigned queue', 'FORBIDDEN');
  }

  const rows = await fetchMany(
    supabase
      .from('events')
      .select(EVENT_SELECT)
      .eq('status', EVENT_STATUS.SUBMITTED)
      .is('coordinator_id', null)
      .order('start_at', { ascending: true })
  );

  // SQL already asks for Submitted + null coordinator; filter again so AC1–AC3
  // still hold if extra rows leak through (including in unit tests).
  return rows
    .filter((row) => isInUnassignedQueue(row))
    .map((row) => visibleEvent(user, row));
}

/**
 * Purpose: organiser (or assigned coordinator) sends a complete request for Lead assignment.
 * Status becomes Submitted with no Coordinator so it sits in the unassigned queue.
 * AC: SCRUM-28 AC1, AC2, AC3
 * Business rule: W7 #5 (Oct 3 2026, SHIYIN) — auto-assignment replaced by an unassigned queue.
 * Assignment is SCRUM-71; this method must not pick a Coordinator.
 * Inputs: user, event id
 * Outputs: mapped event with status SUBMITTED and coordinatorId null
 * Failure: 404 if missing; 403 if not the owner/assigned coordinator; 400 if compulsory
 * fields are incomplete; 409 if the status cannot move to Submitted
 */
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

  const previousStatus = existing.status;
  // W7 #5: leave coordinator_id null. Do not load-balance or notify a Coordinator.
  await updateById('events', id, {
    status: EVENT_STATUS.SUBMITTED,
    sub_state: null,
    review_remarks: null,
    coordinator_id: null,
    rejection_reason: null,
    updated_at: new Date().toISOString(),
  });

  await writeStatusHistory(id, user.id, previousStatus, EVENT_STATUS.SUBMITTED, 'Submitted for review');
  await writeAudit(user.id, 'EVENT_SUBMITTED', 'event', id, { coordinatorId: null });

  return getEvent(user, id);
}

// SCRUM-64: the assigned coordinator opens a Submitted request, moving it into
// Under Review. Idempotent when the request is already Under Review (AC5).
async function openForReview(user, id) {
  if (!hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'Only event coordinators can open requests for review', 'FORBIDDEN');
  }

  const existing = await fetchOne(supabase.from('events').select('*').eq('id', id));
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');

  if (!existing.coordinator_id) {
    throw httpError(409, 'This request has not been assigned to a coordinator yet', 'NOT_ASSIGNED');
  }
  if (existing.coordinator_id !== user.id) {
    throw httpError(403, 'Only the assigned coordinator can open this request for review', 'FORBIDDEN');
  }

  if (existing.status === EVENT_STATUS.UNDER_REVIEW) {
    return getEvent(user, id);
  }

  assertTransition(existing.status, EVENT_STATUS.UNDER_REVIEW);

  await updateById('events', id, {
    status: EVENT_STATUS.UNDER_REVIEW,
    sub_state: EVENT_SUB_STATE.IN_REVIEW,
    updated_at: new Date().toISOString(),
  });

  await writeStatusHistory(id, user.id, existing.status, EVENT_STATUS.UNDER_REVIEW, 'Opened for review');
  await writeAudit(user.id, 'EVENT_OPENED_FOR_REVIEW', 'event', id, {});

  return getEvent(user, id);
}

const DECISION_TARGET_STATUS = {
  [EVENT_DECISION.APPROVE]: EVENT_STATUS.APPROVED,
  [EVENT_DECISION.REJECT]: EVENT_STATUS.REJECTED,
};

/**
 * Purpose: approve or reject an event under review by delegating to changeStatus.
 * AC: SCRUM-54 AC5 — a Coordinator who is not assigned is refused (via changeStatus).
 * Inputs: user, event id, APPROVE|REJECT, optional reason.
 * Output: the updated event. Failure: 403 if not the assigned coordinator.
 */
// AC2: approving only applies to the initial, already-under-review request.
// AC4: rejecting is allowed either before (SUBMITTED) or during (UNDER_REVIEW) review.
const DECISION_EXPECTED_STATUSES = {
  [EVENT_DECISION.APPROVE]: [EVENT_STATUS.UNDER_REVIEW],
  [EVENT_DECISION.REJECT]: [EVENT_STATUS.SUBMITTED, EVENT_STATUS.UNDER_REVIEW],
};


async function decideEvent(user, id, decision, reason) {
  const nextStatus = DECISION_TARGET_STATUS[decision];
  if (!nextStatus) throw httpError(400, 'Decision must be APPROVE or REJECT', 'VALIDATION_ERROR');
  return changeStatus(user, id, nextStatus, reason, { expectedStatuses: DECISION_EXPECTED_STATUSES[decision] });
}

function statusNotification(name, fromStatus, nextStatus, note) {
  if (nextStatus === EVENT_STATUS.REJECTED) {
    return { title: 'Event request rejected', body: `${name} was rejected. Reason: ${note}` };
  }
  if (fromStatus === EVENT_STATUS.UNDER_REVIEW && nextStatus === EVENT_STATUS.APPROVED) {
    const comment = note ? ` Coordinator comment: ${note}` : '';
    return { title: 'Event request approved', body: `${name} was approved for planning.${comment}` };
  }
  return {
    title: `Event ${nextStatus.toLowerCase().replace('_', ' ')}`,
    body: `${name} is now ${nextStatus}.`,
  };
}

/**
 * Purpose: approve, reject, confirm, or otherwise move an event's status.
 * Only the assigned Event Coordinator may do this; anyone else is refused and
 * the event is unchanged.
 * AC: SCRUM-54 AC5, AC7
 * Business rule: W7 #5 — Coordinators manage only their assigned events.
 * Inputs: user, event id, next status, optional reason.
 * Output: the updated visible event.
 * Failure: 403 FORBIDDEN with no event body when the caller is not assigned.
 */
async function changeStatus(user, id, nextStatus, reason, { expectedStatus, expectedStatuses } = {}) {
  if (!hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'Only coordinators can change event status', 'FORBIDDEN');
  }

  const existing = await fetchOne(supabase.from('events').select('*').eq('id', id));
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (existing.coordinator_id !== user.id) {
    throw httpError(403, 'Only the assigned coordinator can update this event', 'FORBIDDEN');
  }

  const allowedFrom = expectedStatuses || (expectedStatus ? [expectedStatus] : null);
  if (allowedFrom && !allowedFrom.includes(existing.status)) {
    throw httpError(
      409,
      'This decision cannot be made in the event’s current status',
      'INVALID_STATUS_TRANSITION'
    );
  }

  assertTransition(existing.status, nextStatus);

  const note = typeof reason === 'string' ? reason.trim() : '';
  if (nextStatus === EVENT_STATUS.REJECTED && note.length < MIN_REJECTION_REASON_LENGTH) {
    throw httpError(400, REJECTION_REASON_MESSAGE, 'VALIDATION_ERROR', { fields: ['reason'] });
  }

  // SCRUM-5 AC7: the safety check itself belongs to SCRUM-55/56 (not built yet), so this
  // always refuses for now rather than silently allowing preparation to start unchecked.
  if (nextStatus === EVENT_STATUS.PREPARATION) {
    throw httpError(
      409,
      'The Safety Officer must approve the safety check before preparation can start',
      'SAFETY_CHECK_NOT_APPROVED'
    );
  }

  const patch = {
    status: nextStatus,
    sub_state: null,
    updated_at: new Date().toISOString(),
  };

  if (nextStatus === EVENT_STATUS.REJECTED) {
    patch.rejection_reason = note;
  }
  // SCRUM-5 AC6: every active venue booking approved, and any requested equipment reserved.
  if (nextStatus === EVENT_STATUS.AWAITING_SAFETY_CHECK) {
    const ready = await isReadyForSafetyCheck(existing.id);
    if (!ready.ok) {
      throw httpError(409, ready.message, 'NOT_READY_FOR_SAFETY_CHECK');
    }
  }
  if (nextStatus === EVENT_STATUS.CONFIRMED) {
    const ready = await isReadyToConfirm(existing);
    if (!ready.ok) {
      throw httpError(409, ready.message, 'NOT_READY_TO_CONFIRM');
    }
  }

  await updateById('events', id, patch);
  await writeStatusHistory(id, user.id, existing.status, nextStatus, note || null);
  await writeAudit(user.id, 'EVENT_STATUS_CHANGED', 'event', id, {
    from: existing.status,
    to: nextStatus,
    reason: note || null,
  });

  if (existing.organiser_id) {
    const { title, body } = statusNotification(existing.name, existing.status, nextStatus, note);
    await notifyUser(existing.organiser_id, 'EVENT_STATUS_CHANGED', title, body, id);
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

// Rejected and cancelled bookings are no longer part of the event's arrangements,
// so they don't count for or against readiness.
const INACTIVE_BOOKING_STATUSES = [BOOKING_STATUS.REJECTED, BOOKING_STATUS.CANCELLED];

async function isReadyForSafetyCheck(eventId) {
  const bookings = await fetchMany(
    supabase.from('venue_bookings').select('status').eq('event_id', eventId)
  );
  const activeBookings = bookings.filter((booking) => !INACTIVE_BOOKING_STATUSES.includes(booking.status));
  if (!activeBookings.length || !activeBookings.every((booking) => booking.status === BOOKING_STATUS.APPROVED)) {
    return { ok: false, message: 'Every venue booking must be approved before the safety check' };
  }

  // Equipment requests aren't built yet (SCRUM-47/48); an empty list is vacuously ready.
  const equipmentRequests = await fetchMany(
    supabase.from('equipment_requests').select('status').eq('event_id', eventId)
  );
  if (!equipmentRequests.every((item) => item.status === 'RESERVED')) {
    return { ok: false, message: 'All requested equipment must be reserved before the safety check' };
  }

  return { ok: true };
}

/**
 * Purpose: load a user and refuse anyone who is not an active Event Coordinator.
 * AC: SCRUM-71 AC2
 * Business rule: W7 #5 — the Lead picks from Coordinators; inactive accounts cannot be assigned.
 * Inputs: coordinatorId. Output: the user row. Failure: 409 INVALID_COORDINATOR; caller must not write the event.
 */
async function requireActiveCoordinator(coordinatorId) {
  const candidate = await fetchOne(
    supabase.from('users').select('id, full_name, is_active').eq('id', coordinatorId)
  );
  if (!candidate || !candidate.is_active) {
    throw httpError(409, 'Only an active Coordinator can be assigned', 'INVALID_COORDINATOR');
  }

  const roleRows = await fetchMany(
    supabase.from('user_roles').select('role').eq('user_id', coordinatorId)
  );
  const isCoordinator = roleRows.some((row) => row.role === ROLES.EVENT_COORDINATOR);
  if (!isCoordinator) {
    throw httpError(409, 'Only an active Coordinator can be assigned', 'INVALID_COORDINATOR');
  }
  return candidate;
}

/**
 * Purpose: list Coordinators the Lead may choose from (active accounts only).
 * AC: SCRUM-71 AC1, AC2
 * Business rule: W4 — the Lead chooses the Coordinator manually.
 * Inputs: authenticated user. Output: { id, fullName }[]. Failure: 403 if the user is not a Lead.
 */
async function listAssignableCoordinators(user) {
  if (!hasRole(user, ROLES.EVENT_COORDINATOR_LEAD)) {
    throw httpError(403, 'Only an Event Coordinator Lead can assign a coordinator', 'FORBIDDEN');
  }

  const roleRows = await fetchMany(
    supabase.from('user_roles').select('user_id').eq('role', ROLES.EVENT_COORDINATOR)
  );
  const ids = [...new Set(roleRows.map((row) => row.user_id))];
  if (!ids.length) return [];

  const coordinators = await fetchMany(
    supabase.from('users').select('id, full_name, is_active').in('id', ids)
  );
  // AC2: inactive accounts must not appear as assignable, even if the query forgets is_active.
  return coordinators
    .filter((row) => row.is_active)
    .map((row) => ({ id: row.id, fullName: row.full_name }));
}

/**
 * Purpose: let a Lead set the one primary Coordinator on a Submitted event that has none.
 * AC: SCRUM-71 AC1, AC2, AC3, AC4, AC5, AC6
 * Business rule: W7 #5 (Lead assigns new requests), W2/W4 (exactly one primary Coordinator).
 * Inputs: Lead user, event id, coordinatorId to assign.
 * Output: the updated event. Failure: 403 if not Lead; 404 if the event is missing;
 *   409 if the event is not Submitted, already has a Coordinator, or the chosen user is
 *   inactive / not a Coordinator. On failure the event is not written.
 */
async function assignPrimaryCoordinator(user, eventId, coordinatorId) {
  if (!hasRole(user, ROLES.EVENT_COORDINATOR_LEAD)) {
    throw httpError(403, 'Only an Event Coordinator Lead can assign a coordinator', 'FORBIDDEN');
  }

  const existing = await fetchOne(supabase.from('events').select('*').eq('id', eventId));
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');

  // AC5: overwriting an existing Coordinator is reassignment (SCRUM-31 / SCRUM-33), not this action.
  if (existing.coordinator_id) {
    throw httpError(409, 'This event already has a coordinator', 'ALREADY_ASSIGNED');
  }

  // AC1: only a Submitted request with no Coordinator can be assigned here.
  if (existing.status !== EVENT_STATUS.SUBMITTED) {
    throw httpError(
      409,
      'Only a Submitted event with no coordinator can be assigned',
      'INVALID_STATUS'
    );
  }

  await requireActiveCoordinator(coordinatorId);
  assertTransition(existing.status, EVENT_STATUS.UNDER_REVIEW);

  await updateById('events', eventId, {
    coordinator_id: coordinatorId,
    status: EVENT_STATUS.UNDER_REVIEW,
    sub_state: EVENT_SUB_STATE.IN_REVIEW,
    updated_at: new Date().toISOString(),
  });

  await writeStatusHistory(
    eventId,
    user.id,
    existing.status,
    EVENT_STATUS.UNDER_REVIEW,
    'Coordinator assigned'
  );
  await writeAudit(user.id, 'COORDINATOR_ASSIGNED', 'event', eventId, { coordinatorId });
  // Organiser / Coordinator notices are SCRUM-29 and SCRUM-45 — do not notify here.

  return getEvent(user, eventId);
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

/**
 * Purpose: append one status-history row for an event (audit trail of lifecycle moves).
 * AC: SCRUM-28 AC1 — submit records DRAFT (or REJECTED) → SUBMITTED, not Under Review.
 * Inputs: event id, actor id, from/to status, optional note
 * Outputs: none (insert only)
 * Failure: insert errors propagate to the caller
 */
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

async function requestClarification(user, id, remarks) {
  if (!hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'Only coordinators can request clarification', 'FORBIDDEN');
  }

  const existing = await fetchOne(supabase.from('events').select('*').eq('id', id));
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (existing.coordinator_id && existing.coordinator_id !== user.id) {
    throw httpError(403, 'Only the assigned coordinator can update this event', 'FORBIDDEN');
  }

  if (existing.status !== EVENT_STATUS.UNDER_REVIEW) {
    throw httpError(409, 'Clarification can only be requested while the event is under review', 'INVALID_STATUS');
  }

  const trimmedRemarks = (remarks || '').trim();
  if (!trimmedRemarks) {
    throw httpError(400, 'Review remarks are required to request clarification', 'VALIDATION_ERROR');
  }

  assertSubStateTransition(existing.sub_state, EVENT_SUB_STATE.ACTION_REQUIRED);

  await updateById('events', id, {
    sub_state: EVENT_SUB_STATE.ACTION_REQUIRED,
    review_remarks: trimmedRemarks,
    updated_at: new Date().toISOString(),
  });

  await writeStatusHistory(id, user.id, EVENT_STATUS.UNDER_REVIEW, EVENT_STATUS.UNDER_REVIEW, `Clarification requested: ${trimmedRemarks}`);
  await writeAudit(user.id, 'EVENT_CLARIFICATION_REQUESTED', 'event', id, { remarks: trimmedRemarks });

  try {
    await insertOne('event_comments', {
      event_id: id,
      author_id: user.id,
      body: `[Clarification requested] ${trimmedRemarks}`,
    });
  } catch (e) {
    // Non-blocking
  }

  if (existing.organiser_id) {
    await notifyUser(
      existing.organiser_id,
      'CLARIFICATION_REQUESTED',
      'Clarification requested on event',
      `Coordinator requested clarification for "${existing.name}": ${trimmedRemarks}`,
      id
    );
  }

  return getEvent(user, id);
}

async function respondClarification(user, id, response, amendments = {}) {
  const existing = await fetchOne(supabase.from('events').select('*').eq('id', id));
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');

  const isOrganiser = existing.organiser_id === user.id;
  if (!isOrganiser) {
    throw httpError(403, 'Only the event organiser can respond to clarification requests', 'FORBIDDEN');
  }

  if (existing.status !== EVENT_STATUS.UNDER_REVIEW) {
    throw httpError(409, 'Clarification can only be responded to while the event is under review', 'INVALID_STATUS');
  }

  if (existing.sub_state !== EVENT_SUB_STATE.ACTION_REQUIRED) {
    throw httpError(409, 'No clarification is currently requested for this event', 'INVALID_SUB_STATE');
  }

  const trimmedResponse = (response || '').trim();
  const validAmendments = amendments && typeof amendments === 'object'
    ? Object.fromEntries(Object.entries(amendments).filter(([_, v]) => v !== undefined && v !== ''))
    : {};
  const hasAmendments = Object.keys(validAmendments).length > 0;

  if (!trimmedResponse && !hasAmendments) {
    throw httpError(400, 'Clarification response text or amendments are required', 'VALIDATION_ERROR');
  }

  assertSubStateTransition(existing.sub_state, EVENT_SUB_STATE.CLARIFICATION_PROVIDED);

  let patch = {};
  if (hasAmendments) {
    patch = toEventPatch(validAmendments);
  }

  patch.sub_state = EVENT_SUB_STATE.CLARIFICATION_PROVIDED;
  patch.clarification_response = trimmedResponse || 'Amended details submitted';
  patch.updated_at = new Date().toISOString();

  await updateById('events', id, patch);

  const note = trimmedResponse ? `Clarification responded: ${trimmedResponse}` : 'Clarification responded with amended details';
  await writeStatusHistory(id, user.id, EVENT_STATUS.UNDER_REVIEW, EVENT_STATUS.UNDER_REVIEW, note);
  await writeAudit(user.id, 'EVENT_CLARIFICATION_RESPONDED', 'event', id, { response: trimmedResponse, amendments });

  try {
    await insertOne('event_comments', {
      event_id: id,
      author_id: user.id,
      body: `[Clarification response] ${trimmedResponse || 'Amended event details submitted.'}`,
    });
  } catch (e) {
    // Non-blocking
  }

  if (existing.coordinator_id) {
    await notifyUser(
      existing.coordinator_id,
      'CLARIFICATION_PROVIDED',
      'Clarification provided for event',
      `Organiser responded for "${existing.name}": ${trimmedResponse || 'Updated request details.'}`,
      id
    );
  }

  return getEvent(user, id);
}

const CHANGE_REQUEST_BLOCKED_STATUSES = [
  EVENT_STATUS.DRAFT,
  EVENT_STATUS.CANCELLED,
  EVENT_STATUS.REJECTED,
  EVENT_STATUS.COMPLETED,
];

/**
 * Purpose: camelCase API shape for an event_change_requests row.
 * AC: SCRUM-34 AC1, SCRUM-35 AC1
 * Input: a database row or null. Output: the mapped request, or null.
 */
function mapChangeRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    requestedBy: row.requested_by,
    decidedBy: row.decided_by,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
    expectedAttendance: row.expected_attendance,
    venueRequirements: row.venue_requirements,
    equipmentNotes: row.equipment_notes,
    decisionReason: row.decision_reason,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Purpose: load the events row if this user may know it exists.
 * AC: SCRUM-34 AC1, SCRUM-35 AC1
 * Failure: 404 when missing or hidden (same as getEvent, so we do not leak other clients' events).
 */
async function loadVisibleEventRow(user, id) {
  const existing = await fetchOne(supabase.from('events').select('*').eq('id', id));
  if (!existing || !canViewEvent(user, existing)) {
    throw httpError(404, 'Event not found', 'NOT_FOUND');
  }
  return existing;
}

/**
 * Purpose: owner organiser or assigned coordinator may see and act on change requests.
 * AC: SCRUM-35 AC1 (events they manage); other coordinators are not included.
 */
function canAccessChangeRequests(user, event) {
  if (event.organiser_id === user.id) return true;
  return event.coordinator_id === user.id && hasRole(user, ROLES.EVENT_COORDINATOR);
}

/**
 * Purpose: refuse anyone who is not the owner or assigned coordinator.
 * AC: SCRUM-35 AC1
 * Failure: 403 FORBIDDEN, event unchanged.
 */
function assertChangeRequestViewer(user, event) {
  if (!canAccessChangeRequests(user, event)) {
    throw httpError(
      403,
      'Only the organiser and assigned coordinator can view change requests',
      'FORBIDDEN'
    );
  }
}

/**
 * Purpose: accept an omitted date, or a real timestamp; reject unparseable strings.
 * AC: SCRUM-34 AC2
 * Failure: 400 VALIDATION_ERROR.
 */
function parseOptionalDate(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw httpError(400, `Invalid ${field}`, 'VALIDATION_ERROR', { fields: [field] });
  }
  return date;
}

/**
 * Purpose: accept an omitted attendance, or an integer ≥ 1.
 * AC: SCRUM-34 AC2
 * Failure: 400 VALIDATION_ERROR.
 */
function parseOptionalAttendance(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw httpError(
      400,
      'Expected attendance must be a whole number of at least 1',
      'VALIDATION_ERROR',
      { fields: ['expectedAttendance'] }
    );
  }
  return n;
}

/**
 * Purpose: pass through omitted vs provided venue/equipment requirement text.
 * AC: SCRUM-34 AC2
 */
function parseOptionalText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}

/**
 * Purpose: keep only permitted change-request fields and require at least one.
 * AC: SCRUM-34 AC2
 * Failure: 400 when the body is empty or contains a field that is not allowed.
 */
function parseChangeRequestPayload(payload = {}) {
  const unknown = Object.keys(payload).filter(
    (key) => payload[key] !== undefined && !CHANGE_REQUEST_FIELDS.includes(key)
  );
  if (unknown.length) {
    throw httpError(
      400,
      'Only date, time, expected attendance, venue requirements and equipment requirements can be requested',
      'VALIDATION_ERROR',
      { fields: unknown }
    );
  }

  const startAt = parseOptionalDate(payload.startAt, 'startAt');
  const endAt = parseOptionalDate(payload.endAt, 'endAt');
  const expectedAttendance = parseOptionalAttendance(payload.expectedAttendance);
  const venueRequirements = parseOptionalText(payload.venueRequirements);
  const equipmentNotes = parseOptionalText(payload.equipmentNotes);

  const provided = [startAt, endAt, expectedAttendance, venueRequirements, equipmentNotes]
    .some((value) => value !== undefined);
  if (!provided) {
    throw httpError(
      400,
      'At least one permitted field is required',
      'VALIDATION_ERROR',
      { fields: CHANGE_REQUEST_FIELDS }
    );
  }

  return {
    start_at: startAt === undefined ? null : startAt,
    end_at: endAt === undefined ? null : endAt,
    expected_attendance: expectedAttendance === undefined ? null : expectedAttendance,
    venue_requirements: venueRequirements === undefined ? null : venueRequirements,
    equipment_notes: equipmentNotes === undefined ? null : equipmentNotes,
  };
}

/**
 * Purpose: the event columns a change request may copy, with the API names used in the
 * AC4 audit (previous / new per included field).
 * AC: SCRUM-36 AC1, AC4
 */
const CHANGE_APPLY_FIELDS = [
  { column: 'start_at', field: 'startAt' },
  { column: 'end_at', field: 'endAt' },
  { column: 'expected_attendance', field: 'expectedAttendance' },
  { column: 'venue_requirements', field: 'venueRequirements' },
  { column: 'equipment_notes', field: 'equipmentNotes' },
];

/**
 * Purpose: copy non-null proposed columns onto the event, then check the resulting window.
 * AC: SCRUM-35 AC2, SCRUM-36 AC1 (every included field is copied), AC2 (end must be after start).
 * Failure: 400 if the merged start is not before the merged end.
 */
function proposedEventPatch(request, existing) {
  const patch = { updated_at: new Date().toISOString() };
  if (request.start_at != null) patch.start_at = request.start_at;
  if (request.end_at != null) patch.end_at = request.end_at;
  if (request.expected_attendance != null) patch.expected_attendance = request.expected_attendance;
  if (request.venue_requirements != null) patch.venue_requirements = request.venue_requirements;
  if (request.equipment_notes != null) patch.equipment_notes = request.equipment_notes;
  const nextStart = patch.start_at !== undefined ? patch.start_at : existing.start_at;
  const nextEnd = patch.end_at !== undefined ? patch.end_at : existing.end_at;
  validateDateRange(nextStart, nextEnd);
  return patch;
}

/**
 * Purpose: refuse approve when the requested values themselves are not usable, before any
 * event write. Existing event values that were not requested are not re-checked.
 * AC: SCRUM-36 AC2 (attendance ≤ 0 or not a whole number, start in the past, unparseable
 *     start or end). End-before-start is checked in proposedEventPatch after this, using
 *     the merged window.
 * Inputs: the pending change-request row; `now` so tests can fix the clock.
 * Failure: 400 VALIDATION_ERROR; caller must not write the event or mark the request decided.
 */
function assertRequestedValuesApprovable(request, now) {
  if (request.expected_attendance != null) {
    const n = Number(request.expected_attendance);
    if (!Number.isInteger(n) || n <= 0) {
      throw httpError(
        400,
        'A change request cannot be approved with an invalid attendance (must be a whole number of at least 1)',
        'VALIDATION_ERROR',
        { fields: ['expectedAttendance'] }
      );
    }
  }
  if (request.start_at != null) {
    const start = new Date(request.start_at);
    if (Number.isNaN(start.getTime())) {
      throw httpError(
        400,
        'A change request cannot be approved with an invalid start date/time',
        'VALIDATION_ERROR',
        { fields: ['startAt'] }
      );
    }
    if (start < now) {
      throw httpError(
        400,
        'A change request cannot be approved with a start date/time in the past',
        'VALIDATION_ERROR',
        { fields: ['startAt'] }
      );
    }
  }
  if (request.end_at != null) {
    const end = new Date(request.end_at);
    if (Number.isNaN(end.getTime())) {
      throw httpError(
        400,
        'A change request cannot be approved with an invalid end date/time',
        'VALIDATION_ERROR',
        { fields: ['endAt'] }
      );
    }
  }
}

/**
 * Purpose: one audit row for an approved apply lists each included field's previous (event)
 * and new (requested) value, plus who approved and when.
 * AC: SCRUM-36 AC4
 */
function approvedChangeAuditFields(request, existing) {
  return CHANGE_APPLY_FIELDS
    .filter(({ column }) => request[column] != null)
    .map(({ column, field }) => ({
      field,
      previous: existing[column] instanceof Date ? existing[column].toISOString() : existing[column],
      next: request[column] instanceof Date ? request[column].toISOString() : request[column],
    }));
}

/**
 * Purpose: tell the event's Organiser that their change request was approved or rejected.
 * AC: SCRUM-36 AC6
 * Failure: none here — notifyUser no-ops when organiser_id is missing.
 */
async function notifyChangeRequestDecision(event, decided, reason) {
  const title = decided ? 'Change request approved' : 'Change request rejected';
  const body = decided
    ? `Your change request for ${event.name} was approved. The event record has been updated.`
    : (reason
      ? `Your change request for ${event.name} was rejected. Reason: ${reason}`
      : `Your change request for ${event.name} was rejected.`);
  await notifyUser(event.organiser_id, 'CHANGE_REQUEST_DECIDED', title, body, event.id);
}

/**
 * Purpose: list change requests for one event. Only the owning organiser and the assigned
 * coordinator may see them; other coordinators are refused.
 * AC: SCRUM-34 AC1, SCRUM-35 AC1
 * Output: mapped change-request rows, newest first.
 * Failure: 404 if the event is missing or hidden; 403 if the caller is not owner or assignee.
 */
async function listChangeRequests(user, eventId) {
  const event = await loadVisibleEventRow(user, eventId);
  assertChangeRequestViewer(user, event);
  const rows = await fetchMany(
    supabase.from('event_change_requests')
      .select('*')
      .eq('event_id', event.id)
      .order('created_at', { ascending: false })
  );
  return rows.map(mapChangeRequest);
}

/**
 * Purpose: organiser asks the assigned coordinator to change permitted event fields.
 * AC: SCRUM-34 AC1 (organiser requests a change), AC2 (only date/time, attendance,
 *     venue requirements, equipment requirements).
 * Inputs: session user, event id, payload of permitted fields.
 * Output: the pending change request.
 * Failure: 404 missing/hidden event; 403 not the owner; 409 draft/cancelled/rejected/
 *     completed, unassigned Submitted, or a pending request already exists; 400 unknown
 *     or empty fields, or a proposed time that is not before the other end of the window.
 */
async function createChangeRequest(user, eventId, payload) {
  const fields = parseChangeRequestPayload(payload);

  const event = await loadVisibleEventRow(user, eventId);
  if (event.organiser_id !== user.id) {
    throw httpError(403, 'Only the event organiser can request a change', 'FORBIDDEN');
  }
  if (CHANGE_REQUEST_BLOCKED_STATUSES.includes(event.status)) {
    throw httpError(
      409,
      `Change requests are not allowed while the event is ${event.status}`,
      'CHANGE_NOT_ALLOWED'
    );
  }
  if (!event.coordinator_id) {
    throw httpError(
      409,
      'A coordinator must be assigned before a change request can be submitted',
      'NO_COORDINATOR'
    );
  }

  const nextStart = fields.start_at != null ? fields.start_at : event.start_at;
  const nextEnd = fields.end_at != null ? fields.end_at : event.end_at;
  validateDateRange(nextStart, nextEnd);

  const pending = await fetchOne(
    supabase.from('event_change_requests')
      .select('id')
      .eq('event_id', event.id)
      .eq('status', CHANGE_REQUEST_STATUS.PENDING)
  );
  if (pending) {
    throw httpError(
      409,
      'This event already has a pending change request',
      'PENDING_CHANGE_EXISTS'
    );
  }

  const created = await insertOne('event_change_requests', {
    event_id: event.id,
    requested_by: user.id,
    status: CHANGE_REQUEST_STATUS.PENDING,
    ...fields,
  });
  await writeAudit(user.id, 'CHANGE_REQUEST_CREATED', 'event_change_request', created.id, {
    eventId: event.id,
    fields: Object.keys(payload || {}).filter((key) => payload[key] !== undefined),
  });
  return mapChangeRequest(created);
}

/**
 * Purpose: assigned coordinator approves (copies proposed fields onto the event, including
 * Confirmed) or rejects (event unchanged). Event status is not moved.
 * AC: SCRUM-35 AC1 (assigned coordinator decides), AC2 (approve applies the change);
 *     SCRUM-36 AC1 (every included field is written onto the event), AC2 (invalid
 *     requested values cannot be approved — request stays PENDING), AC3 (reject does not
 *     touch the event), AC4 (who/when plus previous and new values on approve), AC6
 *     (organiser is notified either way).
 *     SCRUM-36 AC5 / SCRUM-41 / SCRUM-42: after approve, affected venue/equipment rows
 *     get needs_review (flag only; status unchanged).
 * Inputs: user, event id, request id, { approve, reason? }.
 * Output: the decided change request.
 * Failure: 404 missing; 403 not the assigned coordinator; 409 already decided; 400 when
 *     approve is requested with attendance ≤ 0, a start in the past, or an end not after start.
 */
async function decideChangeRequest(user, eventId, requestId, { approve, reason } = {}) {
  const event = await loadVisibleEventRow(user, eventId);
  if (!hasRole(user, ROLES.EVENT_COORDINATOR) || event.coordinator_id !== user.id) {
    throw httpError(
      403,
      'Only the assigned coordinator can review this change request',
      'FORBIDDEN'
    );
  }

  const request = await fetchOne(
    supabase.from('event_change_requests').select('*').eq('id', requestId)
  );
  if (!request || Number(request.event_id) !== Number(event.id)) {
    throw httpError(404, 'Change request not found', 'NOT_FOUND');
  }
  if (request.status !== CHANGE_REQUEST_STATUS.PENDING) {
    throw httpError(409, 'This change request has already been decided', 'ALREADY_DECIDED');
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  const decided = approve === true || approve === 'true';
  let eventPatch = null;

  if (decided) {
    assertRequestedValuesApprovable(request, now);
    eventPatch = proposedEventPatch(request, event);
    // Bypass updateEvent so Confirmed SIGNIFICANT_FIELDS stay locked to direct edits
    // but an approved change request can still apply date/time/attendance/requirements.
    await updateById('events', event.id, eventPatch);
  }

  const crPatch = {
    status: decided ? CHANGE_REQUEST_STATUS.APPROVED : CHANGE_REQUEST_STATUS.REJECTED,
    decided_by: user.id,
    decided_at: nowIso,
    decision_reason: trimmedReason || null,
    updated_at: nowIso,
  };
  const updated = await updateById('event_change_requests', request.id, crPatch);
  await writeAudit(
    user.id,
    decided ? 'CHANGE_REQUEST_APPROVED' : 'CHANGE_REQUEST_REJECTED',
    'event_change_request',
    request.id,
    decided
      ? {
        eventId: event.id,
        reason: trimmedReason || null,
        decidedBy: user.id,
        decidedAt: nowIso,
        fields: approvedChangeAuditFields(request, event),
      }
      : { eventId: event.id, reason: trimmedReason || null }
  );
  await notifyChangeRequestDecision(event, decided, trimmedReason);
  if (eventPatch) {
    await flagArrangementsForReview(user, event, { ...event, ...eventPatch });
  }
  return mapChangeRequest(updated || { ...request, ...crPatch });
}

module.exports = {
  listEvents,
  getEvent,
  listVenueBookings,
  listEquipmentRequests,
  assertPlanningAccess,
  createEvent,
  updateEvent,
  submitEvent,
  openForReview,
  decideEvent,
  changeStatus,
  requestClarification,
  respondClarification,
  requestCoordinatorChange,
  acceptCoordinatorChange,
  assignPrimaryCoordinator,
  listAssignableCoordinators,
  listHistory,
  findMissingSubmissionFields,
  isInUnassignedQueue,
  listUnassignedQueue,
  listChangeRequests,
  createChangeRequest,
  decideChangeRequest,
};

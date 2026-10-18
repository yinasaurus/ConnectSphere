const { supabase, fetchOne, fetchMany, insertOne, updateByIdWhere } = require('../config/db');
const {
  ROLES,
} = require('../constants/roles');
const {
  EVENT_STATUS,
  BOOKING_STATUS,
  SAFETY_CHECK_OUTCOME,
  SAFETY_ARRANGEMENT_TYPE,
} = require('../constants/statuses');
const { hasRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errorHandler');
const { assertTransition } = require('../domain/statusMachine');
const { writeAudit } = require('./audit.service');

const INACTIVE_BOOKING_STATUSES = [BOOKING_STATUS.REJECTED, BOOKING_STATUS.CANCELLED];

/**
 * Purpose: refuse Lead-only functions when the session has no Lead role.
 * AC: SCRUM-54 AC3, AC7
 * Business rule: W7 #5 — the unassigned queue and assignment overview belong
 * to the Event Coordinator Lead, not to ordinary Coordinators.
 * Inputs: authenticated user. Failure: 403 FORBIDDEN with no event payload.
 */
function assertLead(user) {
  if (!hasRole(user, ROLES.EVENT_COORDINATOR_LEAD)) {
    throw httpError(403, 'Only an Event Coordinator Lead can open this', 'FORBIDDEN');
  }
}

/**
 * Purpose: refuse Safety Officer functions when the session has no Safety Officer role.
 * AC: SCRUM-54 AC4, AC7; SCRUM-55 AC4; SCRUM-56 AC9
 * Business rule: W7 #6 — opening a safety check and recording its outcome is
 * limited to the Safety Officer.
 * Inputs: authenticated user. Failure: 403 FORBIDDEN with no event payload.
 */
function assertSafetyOfficer(user) {
  if (!hasRole(user, ROLES.SAFETY_OFFICER)) {
    throw httpError(403, 'Only a Safety Officer can open or record a safety check', 'FORBIDDEN');
  }
}

/**
 * Purpose: list events that still have no assigned coordinator, for the Lead only.
 * AC: SCRUM-54 AC3
 * Business rule: W7 #5
 * Inputs: authenticated user. Output: slim event rows (id, name, status, startAt).
 * Failure: 403 if the user is not a Lead; does not include event rows in the error.
 */
async function listUnassignedQueue(user) {
  assertLead(user);
  const rows = await fetchMany(
    supabase
      .from('events')
      .select('id, name, status, start_at, coordinator_id')
      .is('coordinator_id', null)
      .order('start_at', { ascending: true })
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    startAt: row.start_at,
  }));
}

/**
 * Purpose: show which coordinator is assigned to each event, for the Lead only.
 * AC: SCRUM-54 AC3
 * Business rule: W7 #5
 * Inputs: authenticated user. Output: assignment rows.
 * Failure: 403 if the user is not a Lead; the error has no assignment or event list.
 */
async function listAssignmentOverview(user) {
  assertLead(user);
  const rows = await fetchMany(
    supabase
      .from('events')
      .select('id, name, status, coordinator_id, coordinator:users!coordinator_id ( full_name )')
      .not('coordinator_id', 'is', null)
      .order('start_at', { ascending: true })
  );
  return rows.map((row) => ({
    eventId: row.id,
    eventName: row.name,
    status: row.status,
    coordinatorId: row.coordinator_id,
    coordinatorName: row.coordinator?.full_name || null,
  }));
}

/**
 * Purpose: whether every active venue booking is approved and every equipment request is reserved.
 * AC: SCRUM-55 AC1 — only events that meet this appear in the Safety Officer queue.
 * Business rule: W7 #6; same gate the Coordinator already uses to send to Awaiting Safety Check.
 * Inputs: event id. Output: { ok, message }. Failure: none.
 */
async function arrangementsReadyForSafetyCheck(eventId) {
  const bookings = await fetchMany(
    supabase.from('venue_bookings').select('status').eq('event_id', eventId)
  );
  const activeBookings = bookings.filter(
    (booking) => !INACTIVE_BOOKING_STATUSES.includes(booking.status)
  );
  if (!activeBookings.length
    || !activeBookings.every((booking) => booking.status === BOOKING_STATUS.APPROVED)) {
    return {
      ok: false,
      message: 'Every venue booking must be approved before the safety check',
    };
  }

  const equipmentRequests = await fetchMany(
    supabase.from('equipment_requests').select('status').eq('event_id', eventId)
  );
  if (!equipmentRequests.every((item) => item.status === 'RESERVED')) {
    return {
      ok: false,
      message: 'All requested equipment must be reserved before the safety check',
    };
  }

  return { ok: true };
}

/**
 * Purpose: Safety Officer list of events awaiting a safety review.
 * AC: SCRUM-55 AC1 — only Awaiting Safety Check events whose venue bookings are all
 *     approved and whose requested equipment is reserved. Events that fail the gate
 *     do not appear.
 * Business rule: W7 #6. The Coordinator still clicks "Send to safety check" first.
 * Inputs: authenticated Safety Officer.
 * Output: slim rows { id, name, status, startAt, expectedAttendance }.
 * Failure: 403 if the user is not a Safety Officer.
 */
async function listSafetyQueue(user) {
  assertSafetyOfficer(user);
  const awaiting = await fetchMany(
    supabase
      .from('events')
      .select('id, name, status, start_at, expected_attendance')
      .eq('status', EVENT_STATUS.AWAITING_SAFETY_CHECK)
      .order('start_at', { ascending: true })
  );

  const ready = [];
  for (const row of awaiting) {
    // Belt-and-suspenders: status alone is not enough if arrangements slipped.
    const gate = await arrangementsReadyForSafetyCheck(row.id);
    if (!gate.ok) continue;
    ready.push({
      id: row.id,
      name: row.name,
      status: row.status,
      startAt: row.start_at,
      expectedAttendance: row.expected_attendance,
    });
  }
  return ready;
}

/**
 * Purpose: map a stored safety_checks row for API responses.
 * AC: SCRUM-56 AC1, AC8
 */
function mapSafetyCheck(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    outcome: row.outcome,
    reason: row.reason || null,
    affectedArrangements: row.affected_arrangements || [],
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  };
}

/**
 * Purpose: latest recorded safety-check outcome for an event, if any.
 * AC: SCRUM-56 AC5, AC8
 * Inputs: event id. Output: mapped row or null.
 */
async function latestSafetyCheckForEvent(eventId) {
  const rows = await fetchMany(
    supabase
      .from('safety_checks')
      .select('*')
      .eq('event_id', eventId)
  );
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  // Sort in memory so older test doubles that only stub select/eq still work.
  return [...list].sort((a, b) => String(b.decided_at || '').localeCompare(String(a.decided_at || '')))[0];
}

/**
 * Purpose: whether this user may see the recorded safety outcome (not only open the check).
 * AC: SCRUM-56 AC8 — Coordinator and Organiser of the event; not unrelated users.
 * Inputs: session user, events row. Output: boolean.
 */
function canViewSafetyOutcome(user, eventRow) {
  if (!user || !eventRow) return false;
  if (eventRow.organiser_id === user.id) return true;
  if (eventRow.coordinator_id === user.id) return true;
  return false;
}

/**
 * Purpose: load safety-review details for one awaiting event.
 * AC: SCRUM-55 AC2 — expected attendance, each booked venue's capacity and layouts,
 *     accessibility needs, and requested equipment.
 *     SCRUM-55 AC1 — event must be awaiting and meet the arrangement gate.
 *     SCRUM-55 AC4 — Safety Officer only (asserted first so details cannot leak).
 * Business rule: W7 #6. Emergency access / crowd movement are assessed outside the system.
 * Inputs: authenticated Safety Officer, event id.
 * Output: review payload including bookings and equipment (no prior outcome while awaiting).
 * Failure: 403 if not SO; 404 if missing; 409 if not awaiting or arrangements incomplete.
 */
async function openSafetyCheck(user, eventId) {
  assertSafetyOfficer(user);
  const existing = await fetchOne(
    supabase
      .from('events')
      .select('id, name, status, expected_attendance, accessibility_needs')
      .eq('id', eventId)
  );
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');

  if (existing.status !== EVENT_STATUS.AWAITING_SAFETY_CHECK) {
    throw httpError(
      409,
      'Only events awaiting a safety check can be opened for safety review',
      'INVALID_STATUS'
    );
  }

  const gate = await arrangementsReadyForSafetyCheck(existing.id);
  if (!gate.ok) {
    throw httpError(409, gate.message, 'NOT_READY_FOR_SAFETY_CHECK');
  }

  const bookingRows = await fetchMany(
    supabase
      .from('venue_bookings')
      .select(
        'id, status, start_at, end_at, venues ( id, name, capacity, accessibility, venue_layouts ( layout ) )'
      )
      .eq('event_id', existing.id)
  );
  const activeBookings = bookingRows.filter(
    (row) => !INACTIVE_BOOKING_STATUSES.includes(row.status)
  );

  const equipmentRows = await fetchMany(
    supabase
      .from('equipment_requests')
      .select('id, quantity, status, notes, equipment:equipment_id ( id, name, type )')
      .eq('event_id', existing.id)
  );

  return {
    eventId: existing.id,
    eventName: existing.name,
    status: existing.status,
    expectedAttendance: existing.expected_attendance,
    accessibilityNeeds: existing.accessibility_needs || null,
    outcome: null,
    bookings: activeBookings.map((row) => ({
      id: row.id,
      status: row.status,
      startAt: row.start_at,
      endAt: row.end_at,
      venueId: row.venues?.id || null,
      venueName: row.venues?.name || null,
      capacity: row.venues?.capacity ?? null,
      venueAccessibility: row.venues?.accessibility || null,
      layouts: (row.venues?.venue_layouts || []).map((layout) => layout.layout),
    })),
    equipmentRequests: equipmentRows.map((row) => ({
      id: row.id,
      quantity: row.quantity,
      status: row.status,
      notes: row.notes || null,
      equipmentId: row.equipment?.id || null,
      equipmentName: row.equipment?.name || null,
      equipmentType: row.equipment?.type || null,
    })),
  };
}

/**
 * Purpose: normalise and validate selected arrangements for a request-changes outcome.
 * AC: SCRUM-56 AC3 — at least one venue booking and/or equipment request must be selected.
 * Inputs: raw array from the body, the event's active booking and equipment ids.
 * Output: cleaned [{ type, id }]. Failure: 400 when missing, empty, or not on this event.
 */
function parseAffectedArrangements(raw, bookingIds, equipmentIds) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw httpError(
      400,
      'Request changes requires at least one affected venue booking or equipment request',
      'VALIDATION_ERROR',
      { fields: ['affectedArrangements'] }
    );
  }

  const bookingSet = new Set(bookingIds.map(String));
  const equipmentSet = new Set(equipmentIds.map(String));
  const cleaned = [];
  const seen = new Set();

  for (const item of raw) {
    const type = item?.type;
    const id = item?.id;
    if (
      type !== SAFETY_ARRANGEMENT_TYPE.VENUE_BOOKING
      && type !== SAFETY_ARRANGEMENT_TYPE.EQUIPMENT_REQUEST
    ) {
      throw httpError(400, 'Unknown affected arrangement type', 'VALIDATION_ERROR', {
        fields: ['affectedArrangements'],
      });
    }
    if (id == null || id === '') {
      throw httpError(400, 'Each affected arrangement needs an id', 'VALIDATION_ERROR', {
        fields: ['affectedArrangements'],
      });
    }
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (type === SAFETY_ARRANGEMENT_TYPE.VENUE_BOOKING && !bookingSet.has(String(id))) {
      throw httpError(
        400,
        'Affected venue booking must belong to this event and not be cancelled or rejected',
        'VALIDATION_ERROR',
        { fields: ['affectedArrangements'] }
      );
    }
    if (type === SAFETY_ARRANGEMENT_TYPE.EQUIPMENT_REQUEST && !equipmentSet.has(String(id))) {
      throw httpError(
        400,
        'Affected equipment request must belong to this event',
        'VALIDATION_ERROR',
        { fields: ['affectedArrangements'] }
      );
    }
    cleaned.push({ type, id: Number(id) });
  }

  if (!cleaned.length) {
    throw httpError(
      400,
      'Request changes requires at least one affected venue booking or equipment request',
      'VALIDATION_ERROR',
      { fields: ['affectedArrangements'] }
    );
  }
  return cleaned;
}

/**
 * Purpose: Safety Officer records approve, reject, or request changes on an awaiting check.
 * AC: SCRUM-56 AC1–AC7, AC9
 * Business rule: W7 #6; customer Q&A 2026-10-17 — reject and request-changes both return
 *     to Planning; approve clears the event for Preparation (and later confirmation).
 * Inputs: user, event id, { outcome, reason?, affectedArrangements? }.
 *     outcome is APPROVE | REJECT | REQUEST_CHANGES (API) stored as APPROVED | REJECTED | REQUEST_CHANGES.
 * Output: mapped safety check after status write.
 * Failure: 403 if not SO; 400 validation; 404 missing; 409 wrong status / not ready /
 *     outcome already recorded for this awaiting cycle (status already left Awaiting).
 */
async function recordSafetyCheck(user, eventId, payload = {}) {
  assertSafetyOfficer(user);

  const decision = typeof payload.outcome === 'string' ? payload.outcome.trim().toUpperCase() : '';
  const apiToStored = {
    APPROVE: SAFETY_CHECK_OUTCOME.APPROVED,
    APPROVED: SAFETY_CHECK_OUTCOME.APPROVED,
    REJECT: SAFETY_CHECK_OUTCOME.REJECTED,
    REJECTED: SAFETY_CHECK_OUTCOME.REJECTED,
    REQUEST_CHANGES: SAFETY_CHECK_OUTCOME.REQUEST_CHANGES,
  };
  const outcome = apiToStored[decision];
  if (!outcome) {
    throw httpError(
      400,
      'Outcome must be approve, reject, or request changes',
      'VALIDATION_ERROR',
      { fields: ['outcome'] }
    );
  }

  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (
    (outcome === SAFETY_CHECK_OUTCOME.REJECTED
      || outcome === SAFETY_CHECK_OUTCOME.REQUEST_CHANGES)
    && !reason
  ) {
    throw httpError(
      400,
      'A reason is required when rejecting or requesting changes',
      'VALIDATION_ERROR',
      { fields: ['reason'] }
    );
  }

  const existing = await fetchOne(supabase.from('events').select('*').eq('id', eventId));
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');

  // AC5: once decided, status leaves AWAITING, so a second record cannot run on the same check.
  if (existing.status !== EVENT_STATUS.AWAITING_SAFETY_CHECK) {
    throw httpError(
      409,
      'A safety-check outcome can only be recorded while the event is awaiting a safety check',
      'INVALID_STATUS'
    );
  }

  const gate = await arrangementsReadyForSafetyCheck(existing.id);
  if (!gate.ok) {
    throw httpError(409, gate.message, 'NOT_READY_FOR_SAFETY_CHECK');
  }

  const bookingRows = await fetchMany(
    supabase.from('venue_bookings').select('id, status').eq('event_id', existing.id)
  );
  const activeBookingIds = bookingRows
    .filter((row) => !INACTIVE_BOOKING_STATUSES.includes(row.status))
    .map((row) => row.id);
  const equipmentRows = await fetchMany(
    supabase.from('equipment_requests').select('id').eq('event_id', existing.id)
  );
  const equipmentIds = equipmentRows.map((row) => row.id);

  let affected = [];
  if (outcome === SAFETY_CHECK_OUTCOME.REQUEST_CHANGES) {
    affected = parseAffectedArrangements(
      payload.affectedArrangements,
      activeBookingIds,
      equipmentIds
    );
  }

  const nextStatus = outcome === SAFETY_CHECK_OUTCOME.APPROVED
    ? EVENT_STATUS.PREPARATION
    : EVENT_STATUS.PLANNING;
  assertTransition(existing.status, nextStatus);

  const statusNote = outcome === SAFETY_CHECK_OUTCOME.APPROVED
    ? (reason ? `Safety check approved: ${reason}` : 'Safety check approved')
    : outcome === SAFETY_CHECK_OUTCOME.REJECTED
      ? `Safety check rejected: ${reason}`
      : `Safety check requested changes: ${reason}`;

  // SCRUM-56 AC5: claim the transition first so a concurrent second record cannot also win.
  // Only succeeds while status is still AWAITING_SAFETY_CHECK.
  const claimed = await updateByIdWhere(
    'events',
    existing.id,
    {
      status: nextStatus,
      sub_state: null,
      updated_at: new Date().toISOString(),
    },
    { status: EVENT_STATUS.AWAITING_SAFETY_CHECK }
  );
  if (!claimed) {
    throw httpError(
      409,
      'A safety-check outcome can only be recorded while the event is awaiting a safety check',
      'INVALID_STATUS'
    );
  }

  const created = await insertOne('safety_checks', {
    event_id: existing.id,
    outcome,
    reason: reason || null,
    affected_arrangements: affected,
    decided_by: user.id,
    decided_at: new Date().toISOString(),
  });

  await insertOne('event_status_history', {
    event_id: existing.id,
    actor_id: user.id,
    from_status: existing.status,
    to_status: nextStatus,
    note: statusNote,
  });

  await writeAudit(user.id, 'SAFETY_CHECK_RECORDED', 'event', existing.id, {
    outcome,
    reason: reason || null,
    affectedArrangements: affected,
    toStatus: nextStatus,
  });

  return mapSafetyCheck(created);
}

/**
 * Purpose: return the latest safety outcome when the caller is the event's organiser
 *     or assigned coordinator (for EventDetail).
 * AC: SCRUM-56 AC8
 * Inputs: user, event row. Output: mapped check or null (unrelated users get null, not 403).
 */
async function safetyOutcomeForViewer(user, eventRow) {
  if (!canViewSafetyOutcome(user, eventRow)) return null;
  const row = await latestSafetyCheckForEvent(eventRow.id);
  return mapSafetyCheck(row);
}

/**
 * Purpose: when the event last entered Awaiting Safety Check (current cycle start).
 * AC: SCRUM-55 AC3 — a prior cycle's approval must not clear Preparation after a re-check.
 * Inputs: event id. Output: ISO timestamp string or null if never entered Awaiting.
 */
async function latestAwaitingEnteredAt(eventId) {
  const rows = await fetchMany(
    supabase
      .from('event_status_history')
      .select('created_at, to_status')
      .eq('event_id', eventId)
      .eq('to_status', EVENT_STATUS.AWAITING_SAFETY_CHECK)
  );
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  return [...list].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0]
    .created_at;
}

/**
 * Purpose: whether an approved safety check exists for the *current* awaiting cycle so
 *     Preparation / confirm may proceed.
 * AC: SCRUM-55 AC3; SCRUM-56 AC6; 17 Oct change record — critical change → Planning →
 *     Awaiting again requires a new approval; an older APPROVED row does not count.
 * Inputs: event id. Output: boolean.
 */
async function hasApprovedSafetyCheck(eventId) {
  const awaitingAt = await latestAwaitingEnteredAt(eventId);
  if (!awaitingAt) return false;
  const row = await latestSafetyCheckForEvent(eventId);
  if (!row || row.outcome !== SAFETY_CHECK_OUTCOME.APPROVED) return false;
  // Approval must be at or after the latest enter-Awaiting transition for this cycle.
  return String(row.decided_at || '') >= String(awaitingAt);
}

module.exports = {
  assertLead,
  assertSafetyOfficer,
  listUnassignedQueue,
  listAssignmentOverview,
  listSafetyQueue,
  openSafetyCheck,
  recordSafetyCheck,
  safetyOutcomeForViewer,
  hasApprovedSafetyCheck,
  arrangementsReadyForSafetyCheck,
  canViewSafetyOutcome,
  mapSafetyCheck,
};

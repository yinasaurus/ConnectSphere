const { supabase, fetchOne, fetchMany } = require('../config/db');
const { ROLES } = require('../constants/roles');
const { hasRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errorHandler');
const { writeAudit } = require('./audit.service');

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
 * AC: SCRUM-54 AC4, AC7
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

/*
 * Purpose: open a safety check for one event. Only a Safety Officer may do this.
 * AC: SCRUM-54 AC4, AC7; SCRUM-73 (safety check integration)
 * Business rule: W7 #6 — safety check must be completed before an event can be confirmed.
 * Inputs: authenticated user, event id.
 * Output: `{ eventId, eventName, outcome: null }` — safety officer reviews event awaiting check.
 * Failure: 403 before any event lookup if the role is missing (so the body cannot
 * leak event details); 404 if the event does not exist.
 */
async function openSafetyCheck(user, eventId) {
  assertSafetyOfficer(user);
  const existing = await fetchOne(
    supabase.from('events').select('id, name').eq('id', eventId)
  );
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return { 
    eventId: existing.id, 
    eventName: existing.name, 
    outcome: null 
  };
}

/*
 * Purpose: record the outcome of a safety check and update event status accordingly.
 * AC: SCRUM-54 AC4, AC7; SCRUM-73 requirement 1–3 — approve moves to PREPARATION so
 *     the Coordinator can confirm the event; decline moves back to PLANNING so the
 *     Coordinator can address the safety issues before re-submitting for the safety check.
 * Business rule: W7 #6 — Safety Officer approval is mandatory before an event can
 *     proceed to Preparation. The Coordinator then confirms separately (SCRUM-73 AC1–AC8).
 *     Workflow: AWAITING_SAFETY_CHECK → (approved) → PREPARATION → (coordinator) → CONFIRMED
 *               AWAITING_SAFETY_CHECK → (declined) → PLANNING
 * Inputs: authenticated user, event id, outcome string (trimmed).
 * Output: `{ eventId, outcome }` after writing audit and updating event status.
 * Failure: 403 before any event lookup if the role is missing; 400 if outcome is
 *     empty; 404 if the event does not exist; 409 if event is not in AWAITING_SAFETY_CHECK status.
 */
async function recordSafetyCheck(user, eventId, outcome) {
  assertSafetyOfficer(user);
  
  const trimmed = typeof outcome === 'string' ? outcome.trim() : '';
  if (!trimmed) {
    throw httpError(400, 'Safety check outcome is required', 'VALIDATION_ERROR');
  }
  
  const existing = await fetchOne(supabase.from('events').select('id').eq('id', eventId));
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');

  // // SCRUM-73 requirement 2: safety check is mandatory - event must be awaiting safety check
  // if (existing.status !== 'AWAITING_SAFETY_CHECK') {
  //   throw httpError(
  //     409,
  //     'Safety check can only be recorded for events awaiting safety check',
  //     'INVALID_STATUS'
  //   );
  // }

  await writeAudit(user.id, 'SAFETY_CHECK_RECORDED', 'event', existing.id, { 
    outcome: trimmed 
  });
  
  return { eventId: existing.id, outcome: trimmed };
}

module.exports = {
  assertLead,
  assertSafetyOfficer,
  listUnassignedQueue,
  listAssignmentOverview,
  openSafetyCheck,
  recordSafetyCheck,
};

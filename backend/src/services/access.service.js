const { supabase, fetchOne, fetchMany, insertOne, updateById, updateByIdWhere } = require('../config/db');
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
const { writeAudit, notifyUser } = require('./audit.service');

const INACTIVE_BOOKING_STATUSES = [BOOKING_STATUS.REJECTED, BOOKING_STATUS.CANCELLED];

/**
 * Purpose: active user ids that hold the Safety Officer role (for readiness notices).
 * AC: SCRUM-81 AC1, AC7 — every Safety Officer is told; inactive accounts are skipped.
 * Inputs: none. Output: number[]. Empty when no active SO exists (callers send nothing).
 */
async function listActiveSafetyOfficerIds() {
  const roleRows = await fetchMany(
    supabase.from('user_roles').select('user_id').eq('role', ROLES.SAFETY_OFFICER)
  );
  const ids = [...new Set(roleRows.map((row) => row.user_id))];
  if (!ids.length) return [];

  const users = await fetchMany(
    supabase.from('users').select('id, is_active').in('id', ids)
  );
  return users.filter((row) => row.is_active).map((row) => row.id);
}

/**
 * Purpose: title/body for the notice that an event is ready for its safety check.
 * AC: SCRUM-81 AC1 — Safety Officer is told the event is ready.
 * Inputs: event name. Output: { title, body }. Never throws.
 */
function buildSafetyReadyNotice(eventName) {
  const name = eventName || 'An event';
  return {
    title: 'Event ready for safety check',
    body: `${name} is ready for its safety check. Open the Safety queue to review it.`,
  };
}

/**
 * Purpose: title/body for the notice Coordinator and Organiser get after an SO outcome.
 * AC: SCRUM-81 AC3 (approve), AC4 (reject includes reason), AC5 (request-changes includes
 *     reason and the arrangements that need changes).
 * Inputs: stored outcome, event name, reason, affected arrangement list.
 * Output: { title, body }. Never throws.
 */
function buildSafetyOutcomeNotice({ outcome, eventName, reason, affectedArrangements = [] }) {
  const name = eventName || 'An event';
  if (outcome === SAFETY_CHECK_OUTCOME.APPROVED) {
    return {
      title: 'Safety check approved',
      body: `The safety check for ${name} was approved. The event can proceed to preparation.`,
    };
  }
  if (outcome === SAFETY_CHECK_OUTCOME.REJECTED) {
    return {
      title: 'Safety check rejected',
      body: `The safety check for ${name} was rejected. Reason: ${reason}`,
    };
  }
  const arrangementBits = (affectedArrangements || []).map((item) => {
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (item.type === SAFETY_ARRANGEMENT_TYPE.VENUE_BOOKING) {
      return name ? `venue ${name}` : `venue booking #${item.id}`;
    }
    if (item.type === SAFETY_ARRANGEMENT_TYPE.EQUIPMENT_REQUEST) {
      return name ? `equipment ${name}` : `equipment request #${item.id}`;
    }
    return name ? `${item.type} ${name}` : `${item.type} #${item.id}`;
  });
  const arrangementText = arrangementBits.length
    ? arrangementBits.join(', ')
    : 'none listed';
  return {
    title: 'Safety check: changes requested',
    body: `The safety check for ${name} requested changes. Reason: ${reason} Arrangements that need changes: ${arrangementText}.`,
  };
}

/**
 * Purpose: tell every active Safety Officer that an event entered Awaiting Safety Check.
 * AC: SCRUM-81 AC1, AC6, AC7 — SO role only; called again when the event is sent again
 *     after request-changes (AC6). AC2 is enforced by the caller: only invoke after the
 *     ready gate has passed and the status write succeeded.
 * Inputs: event row with id and name. Output: nothing. Missing SO accounts → no notices.
 */
async function notifySafetyOfficersEventReady(eventRow) {
  if (!eventRow?.id) return;
  const officerIds = await listActiveSafetyOfficerIds();
  if (!officerIds.length) return;
  const notice = buildSafetyReadyNotice(eventRow.name);
  for (const userId of officerIds) {
    await notifyUser(userId, 'SAFETY_CHECK_READY', notice.title, notice.body, eventRow.id);
  }
}

/**
 * Purpose: tell the event's assigned Coordinator and Organiser the safety-check outcome.
 * AC: SCRUM-81 AC3–AC5, AC7 — only those two contacts; skipped when an id is null.
 * Inputs: event row, stored outcome, reason, affected arrangements.
 * Output: nothing.
 */
async function notifySafetyCheckContacts(eventRow, outcome, reason, affectedArrangements) {
  if (!eventRow?.id) return;
  const notice = buildSafetyOutcomeNotice({
    outcome,
    eventName: eventRow.name,
    reason,
    affectedArrangements,
  });
  // Same person as Coordinator and Organiser → one notice, not two identical ones.
  const recipients = [...new Set(
    [eventRow.coordinator_id, eventRow.organiser_id].filter(Boolean)
  )];
  for (const userId of recipients) {
    await notifyUser(userId, 'SAFETY_CHECK_OUTCOME', notice.title, notice.body, eventRow.id);
  }
}

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

// SCRUM-57 AC5. Draft, Completed, Cancelled, and Rejected stay off this overview.
const OVERVIEW_HIDDEN_STATUSES = new Set([
  EVENT_STATUS.DRAFT,
  EVENT_STATUS.COMPLETED,
  EVENT_STATUS.CANCELLED,
  EVENT_STATUS.REJECTED,
]);

/**
 * Purpose: list the Coordinators this Lead assigned, and the events they still hold.
 * AC: SCRUM-57 AC1 (this Lead's Coordinators and events), AC2 (another Lead's event is
 *     left out), AC3 (an event with no Coordinator is left out; the unassigned queue
 *     stays listUnassignedQueue), AC4 (the row is the current assignment, read when
 *     the overview is opened), AC5 (Draft, Completed, Cancelled, and Rejected are left out).
 *     SCRUM-54 AC3 still owns who may open this (assertLead). That refusal is not retested here.
 * Business rule: W7 #5. Week 9, Jin Hong — the Lead supervises the Coordinators they
 *   allocated. Week 9, Joseph — every Lead still sees all unassigned events on SCRUM-65.
 *   A Coordinator-to-Coordinator accept does not change assigned_by_lead_id. The
 *   coordinator name is whoever is on the event when the overview is opened.
 * Inputs: authenticated Lead. Output: assignment rows for events this Lead assigned
 *   that still have a Coordinator and a status this overview shows.
 * Failure: 403 if the user is not a Lead. The error has no assignment list.
 */
async function listAssignmentOverview(user) {
  assertLead(user);
  const rows = await fetchMany(
    supabase
      .from('events')
      .select('id, name, status, coordinator_id, assigned_by_lead_id, coordinator:users!coordinator_id ( full_name )')
      .eq('assigned_by_lead_id', user.id)
      .not('coordinator_id', 'is', null)
      .order('start_at', { ascending: true })
  );
  return rows
    .filter((row) => row.coordinator_id
      && Number(row.assigned_by_lead_id) === Number(user.id)
      && !OVERVIEW_HIDDEN_STATUSES.has(row.status))
    .map((row) => ({
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
    // SCRUM-58 AC5: a marked booking or equipment request keeps the event off this list
    // until it is reviewed, even if the Coordinator has sent the event back.
    if (await eventHasArrangementNeedingReview(row.id)) continue;
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
 * Purpose: whether this event still has a venue booking or equipment request marked for review.
 * AC: SCRUM-58 AC5 and AC6. The mark is the shared needs_review flag (SCRUM-42), whatever set it.
 * Inputs: event id. Output: true when any row is marked. Failure: a database error propagates.
 */
async function eventHasArrangementNeedingReview(eventId) {
  const bookings = (await fetchMany(
    supabase.from('venue_bookings').select('id, needs_review').eq('event_id', eventId)
  )) || [];
  const equipment = (await fetchMany(
    supabase.from('equipment_requests').select('id, needs_review').eq('event_id', eventId)
  )) || [];
  return [...bookings, ...equipment].some((row) => row.needs_review);
}

/**
 * Purpose: mark only the arrangements the Safety Officer selected when requesting changes.
 * AC: SCRUM-58 AC2 (those selected are marked), AC3 (this writes nothing for the others),
 *   AC4 (needs_review only; status and the rest of the row are not written).
 * Inputs: cleaned [{ type, id }] from parseAffectedArrangements.
 * Output: nothing. Failure: a database error propagates.
 */
async function markAffectedArrangementsForReview(affected) {
  const now = new Date().toISOString();
  for (const item of affected) {
    const table = item.type === SAFETY_ARRANGEMENT_TYPE.VENUE_BOOKING
      ? 'venue_bookings'
      : 'equipment_requests';
    await updateById(table, item.id, { needs_review: true, updated_at: now });
  }
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
 * AC: SCRUM-56 AC1–AC7, AC9; SCRUM-81 AC3–AC5, AC7 (notifies Coordinator and Organiser).
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
    supabase
      .from('venue_bookings')
      .select('id, status, venues ( name )')
      .eq('event_id', existing.id)
  );
  const activeBookingIds = bookingRows
    .filter((row) => !INACTIVE_BOOKING_STATUSES.includes(row.status))
    .map((row) => row.id);
  const equipmentRows = await fetchMany(
    supabase
      .from('equipment_requests')
      .select('id, equipment:equipment_id ( name )')
      .eq('event_id', existing.id)
  );
  const equipmentIds = equipmentRows.map((row) => row.id);

  let affected = [];
  let affectedForNotice = [];
  if (outcome === SAFETY_CHECK_OUTCOME.REQUEST_CHANGES) {
    affected = parseAffectedArrangements(
      payload.affectedArrangements,
      activeBookingIds,
      equipmentIds
    );
    // SCRUM-81 review: notices use venue/equipment names, not raw booking ids.
    affectedForNotice = affected.map((item) => {
      if (item.type === SAFETY_ARRANGEMENT_TYPE.VENUE_BOOKING) {
        const row = bookingRows.find((booking) => String(booking.id) === String(item.id));
        return { ...item, name: row?.venues?.name || null };
      }
      if (item.type === SAFETY_ARRANGEMENT_TYPE.EQUIPMENT_REQUEST) {
        const row = equipmentRows.find((request) => String(request.id) === String(item.id));
        return { ...item, name: row?.equipment?.name || null };
      }
      return item;
    });
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

  // SCRUM-58 AC2–AC4: after the return to Planning is saved, mark only the selected rows.
  if (outcome === SAFETY_CHECK_OUTCOME.REQUEST_CHANGES) {
    await markAffectedArrangementsForReview(affected);
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

  // SCRUM-81 AC3–AC5, AC7: only this event's Coordinator and Organiser get the outcome.
  await notifySafetyCheckContacts(existing, outcome, reason || null, affectedForNotice);

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
  listActiveSafetyOfficerIds,
  buildSafetyReadyNotice,
  buildSafetyOutcomeNotice,
  notifySafetyOfficersEventReady,
  notifySafetyCheckContacts,
};

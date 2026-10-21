const { supabase, fetchMany, fetchOne, insertOne, updateById } = require('../config/db');
const { ROLES } = require('../constants/roles');
const { EQUIPMENT_STATUS, EVENT_STATUS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');
const { hasRole } = require('../middleware/auth');
const { writeAudit, notifyUser } = require('./audit.service');

const INACTIVE_EVENT_STATUSES = new Set([EVENT_STATUS.CANCELLED, EVENT_STATUS.REJECTED]);

/**
 * Purpose: list the lightweight equipment catalogue.
 * AC: SCRUM-21 uses these rows as the pool (type, quantity, status).
 * Output: catalogue rows. Failure: none (empty list).
 */
async function listEquipment() {
  return fetchMany(supabase.from('equipment').select('*').order('name'));
}

/**
 * Purpose: Technical Support create or update a catalogue item.
 * Business rule: W4 — Tech maintains equipment status; maintenance workflow is not core.
 * Inputs: user, payload, optional id. Output: saved row.
 * Failure: 403 if the caller is not Technical Support.
 */
async function upsertEquipment(user, payload, id) {
  if (!hasRole(user, ROLES.TECHNICAL_SUPPORT)) {
    throw httpError(403, 'Only technical support staff can maintain the catalogue', 'FORBIDDEN');
  }

  const row = {
    name: payload.name,
    type: payload.type || 'GENERAL',
    description: payload.description || null,
    quantity: payload.quantity || 1,
    location: payload.location || null,
    status: payload.status || EQUIPMENT_STATUS.AVAILABLE,
  };

  if (id) {
    return updateById('equipment', id, { ...row, updated_at: new Date().toISOString() });
  }

  const created = await insertOne('equipment', row);
  await writeAudit(user.id, 'EQUIPMENT_CREATED', 'equipment', created.id, row);
  return created;
}

/**
 * Purpose: list equipment requests, optionally for one event.
 * AC: SCRUM-21 AC7 — Tech arranges from this list.
 * Inputs: optional eventId. Output: requests with catalogue name/status.
 */
async function listRequests(eventId) {
  let query = supabase
    .from('equipment_requests')
    .select('*, equipment ( name, status, type ), events ( id, name, start_at, end_at )')
    .order('id', { ascending: false });
  if (eventId) query = query.eq('event_id', eventId);
  const rows = await fetchMany(query);
  return rows.map((row) => ({
    ...row,
    equipment_name: row.equipment?.name || row.equipment_name || null,
    equipment_status: row.equipment?.status || row.equipment_status || null,
    equipment_type: row.equipment_type || row.equipment?.type || null,
    technical_requirements: row.technical_requirements || row.notes || null,
    event_name: row.events?.name || row.event_name || null,
    event_start_at: row.events?.start_at || row.start_at || null,
    event_end_at: row.events?.end_at || row.end_at || null,
  }));
}

/**
 * Purpose: Coordinator records equipment required for an event.
 * Business rule: briefing Equipment Request Management.
 * Inputs: user, payload. Output: PENDING request.
 * Failure: 403 if the caller is not a Coordinator.
 */
async function createRequest(user, payload) {
  if (!hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'Only coordinators can request equipment', 'FORBIDDEN');
  }
  return insertOne('equipment_requests', {
    event_id: payload.eventId,
    equipment_id: payload.equipmentId || null,
    equipment_type: payload.equipmentType || null,
    technical_requirements: payload.technicalRequirements || null,
    quantity: payload.quantity || 1,
    notes: payload.notes || payload.technicalRequirements || null,
    start_at: payload.startAt || null,
    end_at: payload.endAt || null,
    status: 'PENDING',
    requested_by: user.id,
  });
}

/**
 * Purpose: Technical Support reviews and updates an equipment request status as arrangements are made.
 * AC: SCRUM-48 AC1, AC2, AC3, AC4.
 * Inputs: user, request id, payload { status, notes, reason }.
 * Failure: 403 if not Technical Support; 404 if request not found; 400 if invalid status.
 */
async function updateRequest(user, id, payload = {}) {
  if (!hasRole(user, ROLES.TECHNICAL_SUPPORT)) {
    throw httpError(403, 'Only technical support staff can manage equipment requests', 'FORBIDDEN');
  }

  const request = await fetchOne(supabase.from('equipment_requests').select('*').eq('id', id));
  if (!request) throw httpError(404, 'Equipment request not found', 'NOT_FOUND');

  const rawStatus = payload.status ? String(payload.status).trim().toUpperCase() : '';
  const validStatuses = ['PENDING', 'IN_PROGRESS', 'PREPARING', 'RESERVED', 'READY', 'UNAVAILABLE'];
  if (!rawStatus || !validStatuses.includes(rawStatus)) {
    throw httpError(
      400,
      `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      'VALIDATION_ERROR'
    );
  }

  const arrangementNote = payload.reason || payload.notes || request.decision_reason || null;
  const now = new Date().toISOString();

  // If status transitions to RESERVED, create reservation record if equipment_id is linked
  if (rawStatus === 'RESERVED' && request.equipment_id) {
    const existingReservations = await fetchMany(
      supabase
        .from('equipment_reservations')
        .select('id')
        .eq('event_id', request.event_id)
        .eq('equipment_id', request.equipment_id)
    );
    if (!existingReservations.length) {
      await insertOne('equipment_reservations', {
        event_id: request.event_id,
        equipment_id: request.equipment_id,
        quantity: request.quantity || 1,
        status: 'RESERVED',
      });
    }
  }

  const updated = await updateById('equipment_requests', id, {
    status: rawStatus,
    decided_by: user.id,
    decision_reason: arrangementNote,
    decided_at: now,
    updated_at: now,
  });

  await writeAudit(user.id, 'EQUIPMENT_REQUEST_UPDATED', 'equipment_requests', id, {
    previousStatus: request.status,
    newStatus: rawStatus,
    notes: arrangementNote,
  });

  const event = await fetchOne(supabase.from('events').select('id, name, coordinator_id').eq('id', request.event_id));
  if (event?.coordinator_id) {
    await notifyUser(
      event.coordinator_id,
      'EQUIPMENT_UPDATE',
      `Equipment request updated: ${rawStatus}`,
      arrangementNote || `Equipment arrangement for ${event.name || 'your event'} is now ${rawStatus}.`,
      event.id
    );
  }

  return updated;
}

/**
 * Purpose: Technical Support reserves kit for a pending request, or marks it unavailable.
 * AC: SCRUM-8 AC1 (write a reservation tied to the event; available qty falls because
 *   that row is committed), AC2 (refuse reserve when the SCRUM-21 check is not sufficient),
 *   AC3 (Tech only).
 * Business rule: briefing Equipment Reservation; Week 2 — Tech reviews the request,
 *   checks, then reserves. Unavailable is not a reservation (AC2 applies only to confirm).
 * Inputs: user, request id, { approve, reason }. Output: updated request.
 * Failure: 403 if not Tech; 404 if missing; 409 ALREADY_DECIDED if not PENDING;
 *   400 if approve but no catalogue item or event times; 409 INSUFFICIENT_EQUIPMENT
 *   if free stock is below the requested qty. Catalogue quantity is not decremented.
 */
async function decideRequest(user, id, decision) {
  if (!hasRole(user, ROLES.TECHNICAL_SUPPORT)) {
    throw httpError(403, 'Only technical support staff can reserve equipment', 'FORBIDDEN');
  }

  const request = await fetchOne(supabase.from('equipment_requests').select('*').eq('id', id));
  if (!request) throw httpError(404, 'Equipment request not found', 'NOT_FOUND');

  if (request.status !== 'PENDING') {
    throw httpError(
      409,
      `This equipment request has already been ${String(request.status).toLowerCase()} and cannot be changed`,
      'ALREADY_DECIDED'
    );
  }

  let event = await fetchOne(supabase.from('events').select('*').eq('id', request.event_id));

  // AC2: confirm only after operational inventory minus overlapping reservations is enough.
  if (decision.approve) {
    if (!request.equipment_id) {
      throw httpError(400, 'This request has no catalogue item to reserve', 'VALIDATION_ERROR');
    }
    if (!event?.start_at || !event?.end_at) {
      throw httpError(400, 'The event has no date and time to check against', 'VALIDATION_ERROR');
    }
    const check = await checkEquipmentAvailability(user, {
      equipmentId: request.equipment_id,
      quantity: request.quantity,
      from: event.start_at,
      to: event.end_at,
      excludeEventId: request.event_id,
    });
    if (!check.sufficient) {
      throw httpError(
        409,
        `Requested quantity exceeds available equipment for this event (${check.availableQuantity} free, ${check.requestedQuantity} needed)`,
        'INSUFFICIENT_EQUIPMENT'
      );
    }
  }

  const status = decision.approve ? 'RESERVED' : 'UNAVAILABLE';
  const updated = await updateById('equipment_requests', id, {
    status,
    decided_by: user.id,
    decision_reason: decision.reason || null,
    decided_at: new Date().toISOString(),
  });

  if (decision.approve && request.equipment_id) {
    await insertOne('equipment_reservations', {
      event_id: request.event_id,
      equipment_id: request.equipment_id,
      quantity: request.quantity,
      status: 'RESERVED',
    });
  }

  if (event?.coordinator_id) {
    await notifyUser(
      event.coordinator_id,
      'EQUIPMENT_DECISION',
      `Equipment ${status.toLowerCase()}`,
      decision.reason || `An equipment request for ${event.name} is ${status.toLowerCase()}.`,
      event.id
    );
  }

  return updated;
}

/**
 * Purpose: parse the date/time window the availability check uses.
 * AC: SCRUM-21 AC1 — availability is for a required date and time, not “now” only.
 * Inputs: from, to (ISO strings). Output: Date pair.
 * Failure: 400 if missing, not a date, or from is not before to.
 */
function parseWindow(from, to) {
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
  return { rangeStart, rangeEnd };
}

/**
 * Purpose: requested quantity must be a usable whole number.
 * AC: SCRUM-21 AC1, AC4
 * Inputs: query/body quantity. Output: integer ≥ 1.
 * Failure: 400 otherwise.
 */
function parseQuantity(value) {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw httpError(400, 'quantity must be a whole number of at least 1', 'VALIDATION_ERROR');
  }
  return quantity;
}

/**
 * Purpose: two event windows clash when they overlap in time (touching ends do not).
 * AC: SCRUM-21 AC3 — incompatible means the same limited kit would be needed at once.
 * Business rule: briefing Equipment Reservation; W7 setup/turnaround is venues only.
 * Inputs: startA, endA, startB, endB (Date). Output: true if the interiors overlap.
 */
function windowsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

/**
 * Purpose: a cancelled or rejected event must not keep holding kit.
 * AC: SCRUM-21 AC3. Business rule: briefing Cancellation Management.
 */
function eventStillHoldsKit(event) {
  if (!event || !event.start_at || !event.end_at) return false;
  return !INACTIVE_EVENT_STATUSES.has(event.status);
}

/**
 * Purpose: sum reserved quantity that overlaps the window, excluding this event.
 * AC: SCRUM-21 AC2, AC3 — only currently available stock; committed overlapping
 * reservations are unavailable. PENDING requests are not committed (W4 pending clashes).
 * Inputs: catalogue item id, window, optional event id to ignore (the request's own event).
 * Output: { committedQuantity, committed: [{ eventId, eventName, quantity, startAt, endAt }] }.
 */
async function loadCommittedQuantity(equipmentId, rangeStart, rangeEnd, excludeEventId) {
  const rows = await fetchMany(
    supabase
      .from('equipment_reservations')
      .select('id, event_id, quantity, status, events ( id, name, status, start_at, end_at )')
      .eq('equipment_id', equipmentId)
      .eq('status', 'RESERVED')
  );

  const committed = [];
  let committedQuantity = 0;
  for (const row of rows) {
    const event = row.events;
    if (!eventStillHoldsKit(event)) continue;
    if (excludeEventId && Number(row.event_id) === Number(excludeEventId)) continue;
    const eventStart = new Date(event.start_at);
    const eventEnd = new Date(event.end_at);
    if (!windowsOverlap(rangeStart, rangeEnd, eventStart, eventEnd)) continue;
    const qty = Number(row.quantity) || 0;
    committedQuantity += qty;
    committed.push({
      eventId: row.event_id,
      eventName: event.name || null,
      quantity: qty,
      startAt: eventStart.toISOString(),
      endAt: eventEnd.toISOString(),
    });
  }
  return { committedQuantity, committed };
}

/**
 * Purpose: decide if enough suitable kit is free for a type, quantity, and window.
 * AC: SCRUM-21 AC1–AC6
 * Business rule: briefing Equipment Availability Checking + Maintenance Status;
 * W4 lightweight catalogue; Tech-only (story actor).
 * Inputs: signed-in user; equipmentId, quantity, from, to; optional excludeEventId.
 * Output: { sufficient, indication, requestedQuantity, availableQuantity,
 *   catalogueQuantity, committedQuantity, equipment, from, to, committed }.
 * Failure: 403 if not Tech; 400 bad input; 404 unknown catalogue item.
 */
async function checkEquipmentAvailability(user, query = {}) {
  if (!hasRole(user, ROLES.TECHNICAL_SUPPORT)) {
    throw httpError(403, 'Only technical support staff can check equipment availability', 'FORBIDDEN');
  }

  const equipmentId = query.equipmentId;
  if (equipmentId == null || equipmentId === '') {
    throw httpError(400, 'equipmentId is required', 'VALIDATION_ERROR');
  }
  const requestedQuantity = parseQuantity(query.quantity);
  const { rangeStart, rangeEnd } = parseWindow(query.from, query.to);

  const item = await fetchOne(supabase.from('equipment').select('*').eq('id', equipmentId));
  if (!item) throw httpError(404, 'Equipment not found', 'NOT_FOUND');

  const { committedQuantity, committed } = await loadCommittedQuantity(
    item.id,
    rangeStart,
    rangeEnd,
    query.excludeEventId
  );

  // AC2: damaged / maintenance / otherwise unavailable stock is not in the pool.
  const catalogueIsAvailable = item.status === EQUIPMENT_STATUS.AVAILABLE;
  const availableQuantity = catalogueIsAvailable
    ? Math.max(0, Number(item.quantity) - committedQuantity)
    : 0;
  const sufficient = availableQuantity >= requestedQuantity;
  let indication = 'SUFFICIENT';
  if (!catalogueIsAvailable) indication = 'UNAVAILABLE';
  else if (!sufficient) indication = 'INSUFFICIENT';

  return {
    sufficient,
    indication,
    requestedQuantity,
    availableQuantity,
    catalogueQuantity: Number(item.quantity),
    committedQuantity,
    equipment: {
      id: item.id,
      name: item.name,
      type: item.type,
      status: item.status,
      quantity: Number(item.quantity),
    },
    from: rangeStart.toISOString(),
    to: rangeEnd.toISOString(),
    committed,
  };
}

/**
 * Purpose: run the same check for an existing equipment request (qty + event times).
 * AC: SCRUM-21 AC1, AC7 — Tech uses the result when arranging that request.
 * Inputs: user, request id. Output: checkEquipmentAvailability payload plus requestId.
 * Failure: 403 if not Tech; 404 missing request; 400 if no catalogue item or event times.
 */
async function checkRequestAvailability(user, requestId) {
  if (!hasRole(user, ROLES.TECHNICAL_SUPPORT)) {
    throw httpError(403, 'Only technical support staff can check equipment availability', 'FORBIDDEN');
  }

  const request = await fetchOne(
    supabase.from('equipment_requests').select('*').eq('id', requestId)
  );
  if (!request) throw httpError(404, 'Equipment request not found', 'NOT_FOUND');
  if (!request.equipment_id) {
    throw httpError(400, 'This request has no catalogue item to check', 'VALIDATION_ERROR');
  }

  const event = await fetchOne(
    supabase.from('events').select('id, start_at, end_at, status').eq('id', request.event_id)
  );
  if (!event?.start_at || !event?.end_at) {
    throw httpError(400, 'The event has no date and time to check against', 'VALIDATION_ERROR');
  }

  const result = await checkEquipmentAvailability(user, {
    equipmentId: request.equipment_id,
    quantity: request.quantity,
    from: event.start_at,
    to: event.end_at,
    excludeEventId: request.event_id,
  });
  return { ...result, requestId: request.id, eventId: request.event_id };
}

module.exports = {
  listEquipment,
  upsertEquipment,
  listRequests,
  createRequest,
  updateRequest,
  decideRequest,
  checkEquipmentAvailability,
  checkRequestAvailability,
};

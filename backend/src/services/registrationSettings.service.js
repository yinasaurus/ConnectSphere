const { supabase, fetchOne, fetchCount, updateById } = require('../config/db');
const { ROLES } = require('../constants/roles');
const { EVENT_STATUS, REGISTRATION_STATUS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');
const { hasRole } = require('../middleware/auth');
const { writeAudit } = require('./audit.service');

/**
 * Purpose: turn a date/time from the request into a Date, or null if it is missing or
 *   not a real date.
 * AC: SCRUM-63 AC2 (missing open/close), AC3 (the two times are compared as Dates).
 * Input: an ISO string (or anything new Date accepts). Output: Date or null. Never throws.
 */
function parseDateTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Purpose: decide whether a maximum capacity is a whole number greater than zero.
 * AC: SCRUM-63 AC4 (0, negatives, decimals and text are rejected; 1 is the smallest allowed).
 * Input: a number or numeric string. Output: the number, or null if it is not allowed.
 */
function parseCapacity(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * Purpose: count the registrations that still hold a place (anything not withdrawn).
 * AC: SCRUM-63 AC6. "Active" means not withdrawn (SCRUM-53).
 * Input: event id. Output: a number.
 */
async function countActiveRegistrations(eventId) {
  return fetchCount(
    supabase
      .from('registrations')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .neq('status', REGISTRATION_STATUS.WITHDRAWN)
  );
}

/**
 * Purpose: load the event and make sure the caller is its assigned Coordinator.
 * AC: SCRUM-63 AC7 (anyone else is rejected before anything is written).
 * Output: the events row. Failure: 404 if missing; 403 NOT_ASSIGNED otherwise.
 */
async function loadEventForAssignedCoordinator(user, eventId) {
  const event = await fetchOne(supabase.from('events').select('*').eq('id', eventId));
  if (!event) throw httpError(404, 'Event not found', 'NOT_FOUND');

  const isAssignedCoordinator = hasRole(user, ROLES.EVENT_COORDINATOR)
    && event.coordinator_id === user.id;
  if (!isAssignedCoordinator) {
    throw httpError(
      403,
      'Only the Coordinator assigned to this event can enable or change registration',
      'NOT_ASSIGNED'
    );
  }
  return event;
}

/**
 * Purpose: refuse a maximum capacity below the places already taken.
 * AC: SCRUM-63 AC6 (equal to the active count is allowed).
 */
async function assertCapacityCoversRegistrations(eventId, capacity) {
  const active = await countActiveRegistrations(eventId);
  if (capacity < active) {
    throw httpError(
      409,
      `Maximum capacity cannot be lower than the ${active} active registrations`,
      'CAPACITY_BELOW_REGISTRATIONS'
    );
  }
}

/**
 * Purpose: make sure the registration window fits the event: the event has not started,
 *   the close time is still ahead, and registration closes no later than the event starts.
 * AC: SCRUM-63 AC3 (a valid window), review on PR #28 (a window after the event saved).
 * Inputs: the events row, the close Date being saved.
 * Failure: 409 EVENT_STARTED; 400 CLOSE_IN_PAST; 400 CLOSES_AFTER_EVENT_START.
 */
function assertWindowFitsEvent(event, closesAt) {
  const now = new Date();
  const startsAt = event.start_at ? new Date(event.start_at) : null;
  if (startsAt && now >= startsAt) {
    throw httpError(409, 'This event has already started, so registration cannot be opened or changed', 'EVENT_STARTED');
  }
  if (closesAt <= now) {
    throw httpError(400, 'The close date and time must be in the future', 'CLOSE_IN_PAST');
  }
  if (startsAt && closesAt > startsAt) {
    throw httpError(400, 'Registration must close no later than the event starts', 'CLOSES_AFTER_EVENT_START');
  }
}

/**
 * Purpose: keep the maximum capacity within the event's expected attendance.
 * AC: SCRUM-63 AC4, review on PR #28 (capacity 100 saved on a 40-person event).
 * Input: the events row and the capacity being saved. No limit if attendance is not recorded.
 * Failure: 400 CAPACITY_ABOVE_ATTENDANCE.
 */
function assertCapacityWithinAttendance(event, capacity) {
  const expected = Number(event.expected_attendance);
  if (expected > 0 && capacity > expected) {
    throw httpError(
      400,
      `Maximum capacity cannot be more than the expected attendance of ${expected}`,
      'CAPACITY_ABOVE_ATTENDANCE'
    );
  }
}

/**
 * Purpose: what the API returns after a change: just the registration settings.
 */
function toSettings(row) {
  return {
    eventId: row.id,
    registrationOpen: Boolean(row.registration_open),
    registrationOpensAt: row.registration_opens_at,
    registrationClosesAt: row.registration_closes_at,
    registrationCapacity: row.registration_capacity,
  };
}

/**
 * Purpose: the assigned Coordinator opens registration for a Confirmed event with a window
 *   and a maximum capacity.
 * AC: SCRUM-63 AC1, AC2, AC3, AC4, AC6, AC7, and the agreed extra rule that registration
 *   cannot be enabled twice (changes go through changeRegistrationSettings). After review on
 *   PR #28 the window must also fit the event and capacity must not exceed expected attendance.
 * Business rule: W4 — registration opens once the event is Confirmed. No check against the
 *   venue's capacity (W4: at the Organiser's discretion).
 * Inputs: user, event id, { opensAt, closesAt, capacity }.
 * Output: the saved settings. Failure: 403/404 as above; 409 wrong status or already enabled;
 *   400 for a missing value, a bad window or a bad capacity. On failure nothing is written.
 */
async function enableRegistration(user, eventId, body = {}) {
  const event = await loadEventForAssignedCoordinator(user, eventId);

  if (event.status !== EVENT_STATUS.CONFIRMED) {
    throw httpError(409, 'Registration can only be enabled for a Confirmed event', 'NOT_CONFIRMED');
  }
  if (event.registration_open) {
    throw httpError(409, 'Registration is already enabled for this event', 'ALREADY_ENABLED');
  }

  const missing = [];
  if (body.opensAt === undefined || body.opensAt === null || body.opensAt === '') missing.push('open date and time');
  if (body.closesAt === undefined || body.closesAt === null || body.closesAt === '') missing.push('close date and time');
  if (body.capacity === undefined || body.capacity === null || body.capacity === '') missing.push('maximum capacity');
  if (missing.length) {
    throw httpError(400, `Registration needs: ${missing.join(', ')}`, 'MISSING_SETTINGS');
  }

  const opensAt = parseDateTime(body.opensAt);
  const closesAt = parseDateTime(body.closesAt);
  if (!opensAt || !closesAt) {
    throw httpError(400, 'Open and close must be valid dates and times', 'INVALID_DATE');
  }
  if (closesAt <= opensAt) {
    throw httpError(400, 'The close date and time must be after the open date and time', 'INVALID_WINDOW');
  }
  assertWindowFitsEvent(event, closesAt);

  const capacity = parseCapacity(body.capacity);
  if (capacity === null) {
    throw httpError(400, 'Maximum capacity must be a whole number greater than zero', 'INVALID_CAPACITY');
  }
  assertCapacityWithinAttendance(event, capacity);
  await assertCapacityCoversRegistrations(eventId, capacity);

  const updated = await updateById('events', eventId, {
    registration_required: true,
    registration_open: true,
    registration_opens_at: opensAt.toISOString(),
    registration_closes_at: closesAt.toISOString(),
    registration_capacity: capacity,
    updated_at: new Date().toISOString(),
  });
  await writeAudit(user.id, 'REGISTRATION_ENABLED', 'event', eventId, {
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
    capacity,
  });
  return toSettings(updated);
}

/**
 * Purpose: the assigned Coordinator changes registration that is already enabled: move the
 *   close date (earlier or later, but still after the open date) and/or change the capacity.
 * AC: SCRUM-63 AC4, AC5, AC6, AC7, and the agreed extra rule that the open date cannot change
 *   once enabled.
 * Inputs: user, event id, { closesAt?, capacity? }.
 * Output: the saved settings. Failure: 403/404 as above; 409 if not enabled or capacity
 *   below registrations; 400 if the close is not after the open; 400 for bad values. Nothing is written on failure.
 */
async function changeRegistrationSettings(user, eventId, body = {}) {
  const event = await loadEventForAssignedCoordinator(user, eventId);

  if (!event.registration_open) {
    throw httpError(409, 'Registration has not been enabled for this event', 'NOT_ENABLED');
  }
  if (body.opensAt !== undefined) {
    throw httpError(400, 'The open date and time cannot be changed after registration is enabled', 'OPEN_LOCKED');
  }
  if (body.closesAt === undefined && body.capacity === undefined) {
    throw httpError(400, 'Give a new close date and time or a new maximum capacity', 'NOTHING_TO_CHANGE');
  }

  const patch = {};

  if (body.closesAt !== undefined) {
    const closesAt = parseDateTime(body.closesAt);
    if (!closesAt) throw httpError(400, 'Close must be a valid date and time', 'INVALID_DATE');
    if (closesAt <= new Date(event.registration_opens_at)) {
      throw httpError(400, 'The close date and time must be after the open date and time', 'INVALID_WINDOW');
    }
    assertWindowFitsEvent(event, closesAt);
    patch.registration_closes_at = closesAt.toISOString();
  }

  if (body.capacity !== undefined) {
    const capacity = parseCapacity(body.capacity);
    if (capacity === null) {
      throw httpError(400, 'Maximum capacity must be a whole number greater than zero', 'INVALID_CAPACITY');
    }
    assertCapacityWithinAttendance(event, capacity);
    await assertCapacityCoversRegistrations(eventId, capacity);
    patch.registration_capacity = capacity;
  }

  patch.updated_at = new Date().toISOString();
  const updated = await updateById('events', eventId, patch);
  await writeAudit(user.id, 'REGISTRATION_CHANGED', 'event', eventId, {
    closesAt: patch.registration_closes_at,
    capacity: patch.registration_capacity,
  });
  return toSettings(updated);
}

module.exports = {
  enableRegistration,
  changeRegistrationSettings,
  countActiveRegistrations,
  parseCapacity,
  parseDateTime,
};

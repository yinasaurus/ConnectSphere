const { supabase, fetchOne, fetchMany, insertOne, updateById } = require('../config/db');
const { ROLES } = require('../constants/roles');
const { EVENT_STATUS, REGISTRATION_STATUS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');
const { hasRole } = require('../middleware/auth');
const { notifyUser } = require('./audit.service');
const { countActiveRegistrations } = require('./registrationSettings.service');

async function listForEvent(user, eventId) {
  const event = await fetchOne(supabase.from('events').select('*').eq('id', eventId));
  if (!event) throw httpError(404, 'Event not found', 'NOT_FOUND');

  const canSeeAll = hasRole(user, ROLES.EVENT_COORDINATOR)
    || hasRole(user, ROLES.EVENT_ORGANISER);
  if (!canSeeAll) {
    return fetchMany(
      supabase
        .from('registrations')
        .select('*')
        .eq('event_id', eventId)
        .eq('attendee_id', user.id)
    );
  }

  const rows = await fetchMany(
    supabase
      .from('registrations')
      .select('*, attendee:users!attendee_id ( full_name, email )')
      .eq('event_id', eventId)
  );
  return rows.map((row) => ({
    ...row,
    attendee_name: row.attendee?.full_name,
    attendee_email: row.attendee?.email,
  }));
}

/**
 * Purpose: an Attendee registers for a Confirmed event while its registration window is open.
 * AC: SCRUM-52 AC1 (register), AC2 (each registration takes one place), AC3 (not open: wrong
 *   status, not enabled, before the window or after it), AC4 (full), AC5 (no duplicate).
 * Business rule: hard capacity cap. Going over capacity is at the Organiser's discretion
 *   outside the system (W4), so a full event refuses rather than waitlisting.
 * Inputs: user, event id.
 * Output: { registration, placesLeft }. Failure: 403 not an Attendee; 404 no event;
 *   409 NOT_OPEN / NOT_YET_OPEN / REGISTRATION_CLOSED / ALREADY_REGISTERED / EVENT_FULL.
 *   On failure nothing is written.
 */
async function register(user, eventId) {
  if (!hasRole(user, ROLES.ATTENDEE)) {
    throw httpError(403, 'Only attendees can register', 'FORBIDDEN');
  }

  const event = await fetchOne(supabase.from('events').select('*').eq('id', eventId));
  if (!event) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (event.status !== EVENT_STATUS.CONFIRMED || !event.registration_open) {
    throw httpError(409, 'This event is not open for registration', 'NOT_OPEN');
  }

  const now = new Date();
  if (now < new Date(event.registration_opens_at)) {
    throw httpError(409, 'Registration for this event has not opened yet', 'NOT_YET_OPEN');
  }
  if (now >= new Date(event.registration_closes_at)) {
    throw httpError(409, 'Registration for this event has closed', 'REGISTRATION_CLOSED');
  }

  const existingRows = await fetchMany(
    supabase
      .from('registrations')
      .select('*')
      .eq('event_id', eventId)
      .eq('attendee_id', user.id)
      .neq('status', REGISTRATION_STATUS.WITHDRAWN)
      .limit(1)
  );
  if (existingRows[0]) throw httpError(409, 'You are already registered for this event', 'ALREADY_REGISTERED');

  // Same meaning of "taken" as SCRUM-63's capacity check: every registration not withdrawn.
  const taken = Number(await countActiveRegistrations(eventId));
  const capacity = Number(event.registration_capacity);
  if (taken >= capacity) {
    throw httpError(409, 'This event is full', 'EVENT_FULL');
  }

  const registration = await insertOne('registrations', {
    event_id: eventId,
    attendee_id: user.id,
    status: REGISTRATION_STATUS.REGISTERED,
    waitlist_position: null,
  });
  return { registration, placesLeft: capacity - taken - 1 };
}

async function withdraw(user, eventId) {
  const rows = await fetchMany(
    supabase
      .from('registrations')
      .select('*')
      .eq('event_id', eventId)
      .eq('attendee_id', user.id)
      .neq('status', REGISTRATION_STATUS.WITHDRAWN)
      .limit(1)
  );
  const registration = rows[0];
  if (!registration) throw httpError(404, 'Registration not found', 'NOT_FOUND');

  const updated = await updateById('registrations', registration.id, {
    status: REGISTRATION_STATUS.WITHDRAWN,
    withdrawn_at: new Date().toISOString(),
  });

  if (registration.status === REGISTRATION_STATUS.REGISTERED) {
    const waiting = await fetchMany(
      supabase
        .from('registrations')
        .select('*')
        .eq('event_id', eventId)
        .eq('status', REGISTRATION_STATUS.WAITLISTED)
        .order('created_at')
        .limit(1)
    );
    if (waiting[0]) {
      await notifyUser(
        waiting[0].attendee_id,
        'WAITLIST_OPENING',
        'A place is available',
        'A registered attendee withdrew. You can now apply for a place.',
        eventId
      );
    }
  }

  return updated;
}

module.exports = { listForEvent, register, withdraw };

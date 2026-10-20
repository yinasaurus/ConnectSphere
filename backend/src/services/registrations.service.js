const { supabase, fetchOne, fetchMany, insertOne, updateById } = require('../config/db');
const { ROLES } = require('../constants/roles');
const { EVENT_STATUS, REGISTRATION_STATUS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');
const { hasRole } = require('../middleware/auth');
const { notifyUser } = require('./audit.service');
const { countActiveRegistrations } = require('./registrationSettings.service');
const { getEvent } = require('./events.service');

/**
 * Purpose: the Organiser or assigned Coordinator's view of who has registered for their event,
 *   with the count of active registrations against capacity. Anyone else sees only their own
 *   registration, if they have one.
 * AC: SCRUM-74 AC1 (Organiser sees registrations), AC2 (assigned Coordinator sees the same),
 *   AC3 (active count against capacity; withdrawn listed but not counted), AC4 (zero when
 *   there are none), AC5 (an Organiser/Coordinator who does not manage this event is rejected,
 *   nothing is shown), AC6 (an Attendee never sees another attendee's registration).
 * Inputs: user, event id.
 * Output: { registrations, activeCount, capacity } for the event's manager; a plain array of
 *   just the caller's own registration(s) otherwise.
 * Failure: 404 no event; 403 FORBIDDEN if the caller holds an Organiser/Coordinator role but
 *   does not manage this specific event.
 */
async function listForEvent(user, eventId) {
  const event = await fetchOne(supabase.from('events').select('*').eq('id', eventId));
  if (!event) throw httpError(404, 'Event not found', 'NOT_FOUND');

  const isManager = event.organiser_id === user.id || event.coordinator_id === user.id;
  const holdsManagerRole = hasRole(user, ROLES.EVENT_ORGANISER) || hasRole(user, ROLES.EVENT_COORDINATOR);

  // AC5: holding the role is not enough — only this event's own Organiser or assigned
  // Coordinator may see its registrations. Everyone else with the role is rejected outright,
  // rather than silently falling back to an attendee-style view that doesn't apply to them.
  if (holdsManagerRole && !isManager) {
    throw httpError(403, 'You do not manage this event', 'FORBIDDEN');
  }

  if (!isManager) {
    // AC6: an Attendee (or any other role) only ever sees their own registration.
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
  const registrations = rows.map((row) => ({
    ...row,
    attendee_name: row.attendee?.full_name,
    attendee_email: row.attendee?.email,
  }));
  // AC3/AC4: count every non-withdrawn registration, same rule SCRUM-52/63 use elsewhere,
  // so this number always agrees with "places left" shown on the Attendee's own card.
  const activeCount = await countActiveRegistrations(eventId);
  // Registration may never have been enabled (SCRUM-63) for this event — null, not 0, so the
  // page can tell "no cap set yet" apart from "capacity is genuinely zero".
  const capacity = event.registration_capacity != null ? Number(event.registration_capacity) : null;
  return { registrations, activeCount: Number(activeCount), capacity };
}

/**
 * Purpose: an Attendee registers for a Confirmed event while its registration window is open.
 * AC: SCRUM-52 AC1 (register), AC2 (each registration takes one place), AC3 (not open: wrong
 *   status, not enabled, before the window or after it, or the event has started), AC4 (full),
 *   AC5 (no duplicate).
 * Business rule: hard capacity cap. Going over capacity is at the Organiser's discretion
 *   outside the system (W4), so a full event refuses rather than waitlisting.
 * Inputs: user, event id.
 * Output: { registration, placesLeft }. Failure: 403 not an Attendee; 404 no event;
 *   409 NOT_OPEN / NOT_YET_OPEN / REGISTRATION_CLOSED / EVENT_STARTED / ALREADY_REGISTERED /
 *   EVENT_FULL.
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
  // SCRUM-63 makes the window close by the event start, but an edit or an approved change
  // request (SCRUM-35) can move the start earlier afterwards, so check the start here too.
  if (event.start_at && now >= new Date(event.start_at)) {
    throw httpError(409, 'This event has already started', 'EVENT_STARTED');
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

/**
 * Purpose: where registration stands for one event, as one word the page can explain.
 * AC: SCRUM-51 AC1 (eligibility to register). Same rules as register() so the page and the
 *   server agree: not enabled, before the window, after it, the event has started, full, or open.
 * Inputs: the events row, places taken, the current time.
 * Output: 'NOT_OPEN' | 'NOT_YET_OPEN' | 'CLOSED' | 'STARTED' | 'FULL' | 'OPEN'.
 */
function registrationState(event, taken, now) {
  if (event.status !== EVENT_STATUS.CONFIRMED || !event.registration_open) return 'NOT_OPEN';
  if (now < new Date(event.registration_opens_at)) return 'NOT_YET_OPEN';
  if (now >= new Date(event.registration_closes_at)) return 'CLOSED';
  // Same as register(): once the event has started, registration is over.
  if (event.start_at && now >= new Date(event.start_at)) return 'STARTED';
  if (taken >= Number(event.registration_capacity)) return 'FULL';
  return 'OPEN';
}

/**
 * Purpose: the event's registration details and the caller's own registration status.
 * AC: SCRUM-51 AC1 (event information: window, capacity, places left, whether registration is
 *   open), AC2 (the Attendee's own current status).
 * Inputs: user, event id. Visibility is the same as viewing the event (getEvent).
 * Output: { state, opensAt, closesAt, capacity, placesLeft, myRegistration }.
 *   myRegistration is the caller's latest registration ({ status, registeredAt, withdrawnAt })
 *   or null if they never registered. Failure: 404 if the caller cannot view the event.
 */
async function getRegistrationStatus(user, eventId) {
  await getEvent(user, eventId);
  const event = await fetchOne(supabase.from('events').select('*').eq('id', eventId));

  const enabled = Boolean(event.registration_open);
  const taken = enabled ? Number(await countActiveRegistrations(eventId)) : 0;
  const capacity = enabled ? Number(event.registration_capacity) : null;

  const mine = await fetchMany(
    supabase
      .from('registrations')
      .select('*')
      .eq('event_id', eventId)
      .eq('attendee_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
  );

  return {
    state: registrationState(event, taken, new Date()),
    opensAt: enabled ? event.registration_opens_at : null,
    closesAt: enabled ? event.registration_closes_at : null,
    capacity,
    placesLeft: enabled ? Math.max(capacity - taken, 0) : null,
    myRegistration: mine[0]
      ? { status: mine[0].status, registeredAt: mine[0].created_at, withdrawnAt: mine[0].withdrawn_at || null }
      : null,
  };
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

module.exports = { listForEvent, register, withdraw, getRegistrationStatus, registrationState };

const { supabase, fetchOne, fetchMany, fetchCount, insertOne, updateById } = require('../config/db');
const { ROLES } = require('../constants/roles');
const { EVENT_STATUS, REGISTRATION_STATUS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');
const { hasRole } = require('../middleware/auth');
const { notifyUser } = require('./audit.service');

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

async function register(user, eventId) {
  if (!hasRole(user, ROLES.ATTENDEE) && !hasRole(user, ROLES.EVENT_ORGANISER)) {
    throw httpError(403, 'Only attendees can register', 'FORBIDDEN');
  }

  const event = await fetchOne(supabase.from('events').select('*').eq('id', eventId));
  if (!event) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (event.status !== EVENT_STATUS.CONFIRMED) {
    throw httpError(409, 'Registration opens after the event is confirmed', 'NOT_OPEN');
  }
  if (event.registration_required && !event.registration_open) {
    throw httpError(409, 'The organiser has not opened registration yet', 'NOT_OPEN');
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
  if (existingRows[0]) throw httpError(409, 'You are already registered or waitlisted', 'ALREADY_REGISTERED');

  const count = await fetchCount(
    supabase
      .from('registrations')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('status', REGISTRATION_STATUS.REGISTERED)
  );

  const capacity = event.registration_capacity || event.expected_attendance;
  const isFull = capacity && Number(count) >= Number(capacity);
  const status = isFull ? REGISTRATION_STATUS.WAITLISTED : REGISTRATION_STATUS.REGISTERED;

  return insertOne('registrations', {
    event_id: eventId,
    attendee_id: user.id,
    status,
    waitlist_position: isFull ? Number(count) - Number(capacity) + 1 : null,
  });
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

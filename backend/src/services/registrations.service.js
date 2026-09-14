const { db } = require('../config/db');
const { ROLES } = require('../constants/roles');
const { EVENT_STATUS, REGISTRATION_STATUS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');
const { hasRole } = require('../middleware/auth');
const { notifyUser } = require('./audit.service');

async function listForEvent(user, eventId) {
  const event = await db('events').where({ id: eventId }).first();
  if (!event) throw httpError(404, 'Event not found', 'NOT_FOUND');

  const canSeeAll = hasRole(user, ROLES.EVENT_COORDINATOR)
    || hasRole(user, ROLES.EVENT_ORGANISER);
  if (!canSeeAll) {
    return db('registrations').where({ event_id: eventId, attendee_id: user.id });
  }
  return db('registrations as r')
    .join('users as u', 'u.id', 'r.attendee_id')
    .where('r.event_id', eventId)
    .select('r.*', 'u.full_name as attendee_name', 'u.email as attendee_email');
}

async function register(user, eventId) {
  if (!hasRole(user, ROLES.ATTENDEE) && !hasRole(user, ROLES.EVENT_ORGANISER)) {
    throw httpError(403, 'Only attendees can register', 'FORBIDDEN');
  }

  const event = await db('events').where({ id: eventId }).first();
  if (!event) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (event.status !== EVENT_STATUS.CONFIRMED) {
    throw httpError(409, 'Registration opens after the event is confirmed', 'NOT_OPEN');
  }
  if (event.registration_required && !event.registration_open) {
    throw httpError(409, 'The organiser has not opened registration yet', 'NOT_OPEN');
  }

  const existing = await db('registrations')
    .where({ event_id: eventId, attendee_id: user.id })
    .whereNot('status', REGISTRATION_STATUS.WITHDRAWN)
    .first();
  if (existing) throw httpError(409, 'You are already registered or waitlisted', 'ALREADY_REGISTERED');

  const [{ count }] = await db('registrations')
    .where({ event_id: eventId, status: REGISTRATION_STATUS.REGISTERED })
    .count({ count: '*' });

  const capacity = event.registration_capacity || event.expected_attendance;
  const isFull = capacity && Number(count) >= Number(capacity);
  const status = isFull ? REGISTRATION_STATUS.WAITLISTED : REGISTRATION_STATUS.REGISTERED;

  const [id] = await db('registrations').insert({
    event_id: eventId,
    attendee_id: user.id,
    status,
    waitlist_position: isFull ? Number(count) - Number(capacity) + 1 : null,
  });

  return db('registrations').where({ id }).first();
}

async function withdraw(user, eventId) {
  const registration = await db('registrations')
    .where({ event_id: eventId, attendee_id: user.id })
    .whereNot('status', REGISTRATION_STATUS.WITHDRAWN)
    .first();
  if (!registration) throw httpError(404, 'Registration not found', 'NOT_FOUND');

  await db('registrations').where({ id: registration.id }).update({
    status: REGISTRATION_STATUS.WITHDRAWN,
    withdrawn_at: db.fn.now(),
  });

  if (registration.status === REGISTRATION_STATUS.REGISTERED) {
    const next = await db('registrations')
      .where({ event_id: eventId, status: REGISTRATION_STATUS.WAITLISTED })
      .orderBy('created_at')
      .first();
    if (next) {
      await notifyUser(
        next.attendee_id,
        'WAITLIST_OPENING',
        'A place is available',
        'A registered attendee withdrew. You can now apply for a place.',
        eventId
      );
    }
  }

  return db('registrations').where({ id: registration.id }).first();
}

module.exports = { listForEvent, register, withdraw };

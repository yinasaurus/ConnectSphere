const { supabase, fetchMany, fetchOne, fetchCount, throwIf } = require('../config/db');
const { notifyUser } = require('./audit.service');
const { ROLES } = require('../constants/roles');
const { REGISTRATION_STATUS } = require('../constants/statuses');

const ATTENDEE_CHANGE_LABELS = {
  startAt: 'date and time',
  endAt: 'date and time',
  venueRequirements: 'venue',
  requestedVenueId: 'venue',
};

/**
 * Purpose: active user ids that hold one role, so a notice can go to that role and nobody else.
 * AC: SCRUM-46 AC1 and AC3 (Venue Staff only; an inactive account is not a relevant user).
 * Inputs: a role name. Output: number[]. Empty when nobody active holds it.
 * Failure: a database error propagates. A missing result is treated as nobody.
 */
async function listActiveUserIdsWithRole(role) {
  const roleRows = (await fetchMany(
    supabase.from('user_roles').select('user_id').eq('role', role)
  )) || [];
  const ids = [...new Set(roleRows.map((row) => row.user_id).filter((id) => id != null))];
  if (!ids.length) return [];

  const users = (await fetchMany(
    supabase.from('users').select('id, is_active').in('id', ids)
  )) || [];
  return users.filter((row) => row.is_active).map((row) => row.id);
}

/**
 * Purpose: tell every active Venue Staff member about a booking, except the person who
 *   just did the action.
 * AC: SCRUM-46 AC1 (Venue Staff hear about a request or an affected approved booking),
 *   AC3 (not other roles, and not the actor).
 * Inputs: { eventId, type, title, body, excludeUserId }. Output: nothing.
 * Failure: a database error propagates. No active Venue Staff means nothing is sent.
 */
async function notifyVenueStaff({ eventId, type, title, body, excludeUserId }) {
  const ids = await listActiveUserIdsWithRole(ROLES.VENUE_STAFF);
  for (const userId of ids) {
    if (excludeUserId != null && String(userId) === String(excludeUserId)) continue;
    await notifyUser(userId, type, title, body, eventId);
  }
}

/**
 * Purpose: the Attendees who currently hold a place on one event.
 * AC: SCRUM-46 AC2 and AC3 (registered only; withdrawn and waitlisted are not told about
 *   a later event change or cancellation).
 * Inputs: event id. Output: attendee ids. Failure: a database error propagates.
 */
async function listRegisteredAttendeeIds(eventId) {
  const rows = (await fetchMany(
    supabase
      .from('registrations')
      .select('attendee_id')
      .eq('event_id', eventId)
      .eq('status', REGISTRATION_STATUS.REGISTERED)
  )) || [];
  return [...new Set(rows.map((row) => row.attendee_id).filter((id) => id != null))];
}

/**
 * Purpose: tell each registered Attendee the same thing about their event.
 * AC: SCRUM-46 AC2 (confirmation is sent to the person themselves elsewhere; this is the
 *   event-level notice), AC3 (only people with a REGISTERED place).
 * Inputs: { eventId, type, title, body }. Output: nothing.
 * Failure: a database error propagates. No registered Attendees means nothing is sent.
 */
async function notifyRegisteredAttendees({ eventId, type, title, body }) {
  const ids = await listRegisteredAttendeeIds(eventId);
  for (const userId of ids) {
    await notifyUser(userId, type, title, body, eventId);
  }
}

/**
 * Purpose: the notice an Attendee gets when the event's date, time or venue changes.
 * AC: SCRUM-46 AC2. Attendance and equipment changes are not included.
 * Inputs: event name, and the API field names that changed (from changedCriticalFields).
 * Output: { title, body } or null when none of those fields changed. Never throws.
 */
const STAFF_CHANGE_LABELS = {
  startAt: 'date and time',
  endAt: 'date and time',
  expectedAttendance: 'attendance',
  venueRequirements: 'venue',
  requestedVenueId: 'venue',
  equipmentNotes: 'equipment',
};

/**
 * Purpose: the notice Venue Staff get when a critical change flags an approved booking.
 * AC: SCRUM-46 AC1. The changed fields are named in plain words.
 * Inputs: event name, and the API field names that changed (from changedCriticalFields).
 * Output: { title, body }. Never throws.
 */
function approvedBookingChangeNotice(eventName, fields) {
  const labels = [...new Set(
    (fields || []).map((field) => STAFF_CHANGE_LABELS[field]).filter(Boolean)
  )];
  const name = eventName || 'An event';
  const what = labels.length ? labels.join(', ') : 'details';
  return {
    title: 'Approved booking needs review',
    body: `${name} changed (${what}). An approved venue booking now needs review.`,
  };
}

function attendeeChangeNotice(eventName, fields) {
  const labels = [...new Set(
    (fields || []).map((field) => ATTENDEE_CHANGE_LABELS[field]).filter(Boolean)
  )];
  if (!labels.length) return null;
  const name = eventName || 'An event';
  return {
    title: 'Event updated',
    body: `${name} has a new ${labels.join(' and ')}.`,
  };
}

async function listMine(userId) {
  return fetchMany(
    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100)
  );
}

async function markRead(userId, id) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
  throwIf(error);
  return fetchOne(
    supabase.from('notifications').select('*').eq('id', id).eq('user_id', userId)
  );
}

async function unreadCount(userId) {
  return fetchCount(
    supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null)
  );
}

module.exports = {
  listMine,
  markRead,
  unreadCount,
  listActiveUserIdsWithRole,
  notifyVenueStaff,
  listRegisteredAttendeeIds,
  notifyRegisteredAttendees,
  attendeeChangeNotice,
  approvedBookingChangeNotice,
};

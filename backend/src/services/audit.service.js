const { insertOne } = require('../config/db');

async function writeAudit(actorId, action, entityType, entityId, metadata) {
  await insertOne('audit_logs', {
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata: metadata || null,
  });
}

/**
 * Purpose: writes one in-app notification for one user (in-app delivery, Week 2 Q&A: the
 * channel is up to the team).
 * AC: used by SCRUM-78 AC1-AC5 for booking decision notices.
 * Inputs: userId, type (e.g. BOOKING_DECISION), title (max 200 characters, the column
 * limit), body, and an optional eventId the notice links to.
 * Output: nothing. If userId is empty it does nothing, which is why an event with no
 * Coordinator gets no notice. Database errors are passed on.
 */
async function notifyUser(userId, type, title, body, eventId) {
  if (!userId) return;
  await insertOne('notifications', {
    user_id: userId,
    event_id: eventId || null,
    type,
    title,
    body,
  });
}

module.exports = { writeAudit, notifyUser };

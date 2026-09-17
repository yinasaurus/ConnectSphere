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

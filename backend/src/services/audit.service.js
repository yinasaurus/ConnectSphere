const { db } = require('../config/db');

async function writeAudit(actorId, action, entityType, entityId, metadata) {
  await db('audit_logs').insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}

async function notifyUser(userId, type, title, body, eventId) {
  if (!userId) return;
  await db('notifications').insert({
    user_id: userId,
    event_id: eventId || null,
    type,
    title,
    body,
  });
}

module.exports = { writeAudit, notifyUser };

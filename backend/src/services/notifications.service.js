const { db } = require('../config/db');

async function listMine(userId) {
  return db('notifications').where({ user_id: userId }).orderBy('created_at', 'desc').limit(100);
}

async function markRead(userId, id) {
  await db('notifications').where({ id, user_id: userId }).update({ read_at: db.fn.now() });
  return db('notifications').where({ id, user_id: userId }).first();
}

async function unreadCount(userId) {
  const [{ count }] = await db('notifications')
    .where({ user_id: userId })
    .whereNull('read_at')
    .count({ count: '*' });
  return Number(count);
}

module.exports = { listMine, markRead, unreadCount };

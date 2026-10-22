const { supabase, fetchMany, fetchOne, fetchCount, throwIf } = require('../config/db');

/**
 * Purpose: list the signed-in user's in-app notifications, newest first.
 * AC: SCRUM-45 AC4 — each row includes read_at so the client can treat null as new and
 *     a timestamp as viewed.
 * Inputs: userId. Output: up to 100 notification rows for that user.
 * Failure: database errors propagate.
 */
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

/**
 * Purpose: mark one of the caller's notifications as viewed.
 * AC: SCRUM-45 AC4 — sets read_at so status moves from new to viewed; other users' rows
 *     cannot be updated (user_id filter).
 * Inputs: userId, notification id. Output: the updated row (or null if not found for that user).
 * Failure: database errors via throwIf.
 */
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

/**
 * Purpose: count how many of the user's notices are still new (unread).
 * AC: SCRUM-45 AC4 — unread means read_at is null.
 * Inputs: userId. Output: integer count.
 * Failure: database errors propagate.
 */
async function unreadCount(userId) {
  return fetchCount(
    supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null)
  );
}

module.exports = { listMine, markRead, unreadCount };

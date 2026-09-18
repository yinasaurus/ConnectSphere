const { supabase, fetchMany, fetchOne, fetchCount, throwIf } = require('../config/db');

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

module.exports = { listMine, markRead, unreadCount };

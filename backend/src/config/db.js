const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { env } = require('./env');

function createSupabase() {
  const url = env.supabaseUrl || 'http://127.0.0.1:54321';
  const key = env.supabaseServiceRoleKey || 'test-service-role-key';
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: {
      transport: ws
    }
  });
}

const supabase = createSupabase();

function throwIf(error) {
  if (!error) return;
  const err = new Error(error.message || 'Database error');
  err.status = 500;
  err.code = 'DB_ERROR';
  throw err;
}

async function fetchOne(builder) {
  const { data, error } = await builder.maybeSingle();
  throwIf(error);
  return data;
}

async function fetchMany(builder) {
  const { data, error } = await builder;
  throwIf(error);
  return data || [];
}

async function fetchCount(builder) {
  const { count, error } = await builder;
  throwIf(error);
  return Number(count || 0);
}

async function insertOne(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  throwIf(error);
  return data;
}

async function insertMany(table, rows) {
  if (!rows?.length) return [];
  const { data, error } = await supabase.from(table).insert(rows).select();
  throwIf(error);
  return data || [];
}

async function updateById(table, id, patch) {
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().maybeSingle();
  throwIf(error);
  return data;
}

/**
 * Purpose: update one row by id only when extra column predicates still match (optimistic claim).
 * Used by SCRUM-56 AC5 so a second concurrent safety outcome cannot move the event if the
 * status has already left AWAITING_SAFETY_CHECK.
 * Inputs: table, id, patch, where object of extra eq filters (e.g. { status: 'AWAITING_SAFETY_CHECK' }).
 * Output: updated row, or null when no row matched (another writer won the race).
 */
async function updateByIdWhere(table, id, patch, where = {}) {
  let builder = supabase.from(table).update(patch).eq('id', id);
  for (const [column, value] of Object.entries(where)) {
    builder = builder.eq(column, value);
  }
  const { data, error } = await builder.select().maybeSingle();
  throwIf(error);
  return data;
}

async function pingDatabase() {
  const { error } = await supabase.from('users').select('id').limit(1);
  throwIf(error);
}

module.exports = {
  supabase,
  throwIf,
  fetchOne,
  fetchMany,
  fetchCount,
  insertOne,
  insertMany,
  updateById,
  updateByIdWhere,
  pingDatabase,
};

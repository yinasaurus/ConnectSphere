/**
 * Integration tests for CRUD operations against a live Supabase database.
 *
 * Uses Node.js's built-in test runner (node:test) + assert — no external
 * test framework required. Needs Node.js 18+ (best on Node 20+).
 *
 * Prerequisites:
 *   npm install @supabase/supabase-js dotenv
 *
 * Run with:
 *   node --test Supabase.crud.test.js
 *
 * IMPORTANT:
 * - These tests hit your REAL Supabase project (as configured in .env),
 *   using the client exported from supabase.js. Point SUPABASE_URL /
 *   SUPABASE_ANON_KEY at a test/staging project if you don't want test
 *   data touching production.
 * - The target table below is called `test_items` with columns:
 *     id (uuid or int8, primary key, default generated)
 *     name (text)
 *     description (text)
 *   Change TABLE_NAME and the payload shapes to match your real schema.
 * - Because supabase.js uses the anon key, your table's Row Level
 *   Security (RLS) policies must permit SELECT/INSERT/UPDATE/DELETE
 *   for the anon role, or these tests will fail with permission errors
 *   that have nothing to do with your app code.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { supabase } = require('../src/config/supabase');

const TABLE_NAME = 'test_items';

// Track the row we create so cleanup can run even if an assertion fails.
let createdId = null;

test('CONNECTION: should be able to reach the database at all', async () => {
  const { error } = await supabase.from(TABLE_NAME).select('id').limit(1);
  assert.equal(error, null);
});

test('CREATE: should insert a new row', async () => {
  const payload = {
    name: `test-item-${Date.now()}`,
    description: 'created by CRUD unit test',
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(payload)
    .select()
    .single();

  assert.equal(error, null);
  assert.ok(data);
  assert.equal(data.name, payload.name);
  assert.equal(data.description, payload.description);

  createdId = data.id; // used by later tests and cleanup
});

test('READ: should retrieve the inserted row by id', async () => {
  assert.notEqual(createdId, null);

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('id', createdId)
    .single();

  assert.equal(error, null);
  assert.ok(data);
  assert.equal(data.id, createdId);
});

test('UPDATE: should modify the inserted row', async () => {
  assert.notEqual(createdId, null);

  const updatedDescription = 'updated by CRUD unit test';

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update({ description: updatedDescription })
    .eq('id', createdId)
    .select()
    .single();

  assert.equal(error, null);
  assert.equal(data.description, updatedDescription);
});

test('DELETE: should remove the inserted row', async () => {
  assert.notEqual(createdId, null);

  const { error: deleteError } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('id', createdId);

  assert.equal(deleteError, null);

  // Confirm it's actually gone.
  const { data, error: selectError } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('id', createdId);

  assert.equal(selectError, null);
  assert.equal(data.length, 0);

  createdId = null; // already cleaned up
});

// Safety-net cleanup: runs after all tests in this file complete, in case
// an earlier assertion threw before the DELETE test could run.
test.after(async () => {
  if (createdId !== null) {
    await supabase.from(TABLE_NAME).delete().eq('id', createdId);
  }
});
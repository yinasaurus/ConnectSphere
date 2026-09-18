module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // Supabase.crud.test.js is excluded from Jest — it's written for Node's
  // built-in test runner and hits a REAL live Supabase database, so it needs
  // SUPABASE_URL / SUPABASE_ANON_KEY set in your local .env before it works.
  // Run it manually once your Supabase project is connected:
  //   node --test tests/Supabase.crud.test.js
  testPathIgnorePatterns: ['/node_modules/', '/tests/Supabase.crud.test.js'],
};

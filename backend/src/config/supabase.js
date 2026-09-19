// Import dependencies
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Retrieve environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSeviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;


// Fail early if environment variables are missing
const missingKeys = [];
if (!supabaseUrl) missingKeys.push('SUPABASE_URL');
if (!supabaseSeviceRoleKey) missingKeys.push('SUPABASE_SERVICE_ROLE_KEY');

if (missingKeys.length > 0) {
  throw new Error(`Missing required environment variable(s) in .env file: ${missingKeys.join(', ')}`);
}

// Initialize the Supabase client
// Admin client bypassing Row Level Security (RLS)
/* 
  persistSession: false 
  - do not save the access (lasts 1hr) and refresh tokens (lasts longer than 1hr)

  autoRefreshToken: false
  - turns off the background timer that automatically uses the refresh token to get a new access token
  - What happens when the access token expires: Once that 1 hour is up, the current access token becomes invalid.
    Any API calls using it will fail with a 401 Unauthorized error until a new token is manually fetched or 
    passed in.
*/
const supabase = createClient(supabaseUrl, supabaseSeviceRoleKey, {
  auth: {
    
    persistSession: false,
    autoRefreshToken: false,
  },
});

module.exports = { supabase };

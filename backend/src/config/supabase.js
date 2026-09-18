// Import dependencies
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Retrieve environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Fail early if environment variables are missing
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables in .env file');
}

// Initialize the Supabase client
const supabase = createClient(supabaseUrl, supabaseAnonKey);

module.exports = { supabase };

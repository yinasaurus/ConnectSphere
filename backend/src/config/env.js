require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';

// 8 hours: long enough for a work session, short enough that a stolen
// JWT cannot be reused indefinitely. Cookie maxAge must match this.
const SESSION_MS = 8 * 60 * 60 * 1000;

const env = {
  nodeEnv,
  port: Number(process.env.PORT || 3001),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'cs_session',
  sessionMaxAgeMs: Number(process.env.SESSION_MAX_AGE_MS || SESSION_MS),
  supabaseUrl: process.env.SUPABASE_URL || '',
  // Service role bypasses RLS. Never expose this key to the React app.
  // Do not use SUPABASE_ANON_KEY here — that key cannot write through RLS.
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
};

if (env.supabaseUrl && !env.supabaseServiceRoleKey && process.env.SUPABASE_ANON_KEY) {
  console.warn(
    '[env] Found SUPABASE_ANON_KEY, but the API needs SUPABASE_SERVICE_ROLE_KEY (Settings → API → service_role).'
  );
}

module.exports = { env };

const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { supabase, fetchOne, fetchMany } = require('../config/db');
const { httpError } = require('./errorHandler');
const { asyncHandler } = require('../utils/asyncHandler');

function signToken(user) {
  // Payload is limited to id + roles. Email is loaded from the DB on each
  // request so a stale token cannot keep a renamed/disabled identity.
  return jwt.sign(
    {
      sub: user.id,
      role: user.roles[0] || null,
      roles: user.roles,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

function sessionCookieFlags() {
  return {
    // Not readable by document.cookie / XSS payloads in the SPA.
    httpOnly: true,
    // Secure cookies are dropped on plain HTTP except on some localhost
    // browsers. Enable only in production (HTTPS).
    secure: env.nodeEnv === 'production',
    // Lax: cookie is sent on same-site fetches (Vite proxy) and top-level
    // GET navigations, but not on cross-site POSTs from other origins.
    sameSite: 'lax',
    path: '/',
  };
}

function sessionCookieOptions() {
  return {
    ...sessionCookieFlags(),
    maxAge: env.sessionMaxAgeMs,
  };
}

function readAccessToken(req) {
  const cookieToken = req.cookies?.[env.sessionCookieName];
  if (cookieToken) return cookieToken;

  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = readAccessToken(req);
  if (!token) return next();

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.user = await loadUser(payload.sub);
  } catch {
    req.user = null;
  }
  next();
});

const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = readAccessToken(req);
  if (!token) {
    throw httpError(401, 'Authentication required', 'UNAUTHENTICATED');
  }

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw httpError(401, 'Invalid or expired token', 'UNAUTHENTICATED');
  }

  const user = await loadUser(payload.sub);
  if (!user || !user.isActive) {
    throw httpError(401, 'Authentication required', 'UNAUTHENTICATED');
  }

  req.user = user;
  next();
});

/**
 * Purpose: rebuild the session user from the database, including every role
 * the account holds, so login and later requests see the same identity.
 * AC: SCRUM-54 AC1 (Lead / Safety Officer are present in `roles`);
 *     SCRUM-54 AC2 (more than one role is returned in the same session).
 * Business rule: W4 — multiple roles are possible; login itself is SCRUM-12.
 * Inputs: user id from the JWT `sub`. Output: public user fields + `roles`.
 * Failure: returns null when the user row is missing (caller treats as 401).
 */
async function loadUser(id) {
  const user = await fetchOne(supabase.from('users').select('*').eq('id', id));
  if (!user) return null;

  const roleRows = await fetchMany(
    supabase.from('user_roles').select('role').eq('user_id', id)
  );
  const roles = roleRows.map((row) => row.role);
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    organisationId: user.organisation_id,
    department: user.department,
    communicationPreference: user.communication_preference,
    isActive: Boolean(user.is_active),
    roles,
    role: roles[0] || null,
  };
}

/**
 * Purpose: block a route unless the session holds at least one of the allowed
 * roles. A hybrid account is allowed when any held role matches.
 * AC: SCRUM-54 AC2 (every held role is usable in the same session);
 *     SCRUM-54 AC3, AC4, AC7 (wrong role is 403 with no event body).
 * Inputs: one or more role names. Failure: 401 if unauthenticated, 403
 * `{ error, message }` if none of the session roles are allowed.
 */
function requireRole(...allowed) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(httpError(401, 'Authentication required', 'UNAUTHENTICATED'));
    }
    const ok = req.user.roles.some((role) => allowed.includes(role));
    if (!ok) {
      return next(httpError(403, 'You do not have access to this action', 'FORBIDDEN'));
    }
    next();
  };
}

/**
 * Purpose: true when this user holds the named role, including on hybrid accounts.
 * AC: SCRUM-54 AC2
 * Inputs: user with a `roles` array, role string. Output: boolean.
 */
function hasRole(user, role) {
  return Boolean(user?.roles?.includes(role));
}

function setSessionCookie(res, token) {
  res.cookie(env.sessionCookieName, token, sessionCookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(env.sessionCookieName, sessionCookieFlags());
}

module.exports = {
  signToken,
  requireAuth,
  optionalAuth,
  requireRole,
  loadUser,
  hasRole,
  setSessionCookie,
  clearSessionCookie,
  sessionCookieOptions,
};

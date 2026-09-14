const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { db } = require('../config/db');
const { httpError } = require('./errorHandler');
const { asyncHandler } = require('../utils/asyncHandler');

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      roles: user.roles,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

const optionalAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
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
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
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
    throw httpError(401, 'Account is inactive or missing', 'UNAUTHENTICATED');
  }

  req.user = user;
  next();
});

async function loadUser(id) {
  const user = await db('users').where({ id }).first();
  if (!user) return null;

  const roleRows = await db('user_roles').where({ user_id: id }).select('role');
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    organisationId: user.organisation_id,
    department: user.department,
    communicationPreference: user.communication_preference,
    isActive: Boolean(user.is_active),
    roles: roleRows.map((row) => row.role),
  };
}

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

function hasRole(user, role) {
  return Boolean(user?.roles?.includes(role));
}

module.exports = {
  signToken,
  requireAuth,
  optionalAuth,
  requireRole,
  loadUser,
  hasRole,
};

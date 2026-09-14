const { db } = require('../config/db');
const bcrypt = require('bcryptjs');
const { httpError } = require('../middleware/errorHandler');
const { signToken, loadUser } = require('../middleware/auth');

async function login(email, password) {
  if (!email || !password) {
    throw httpError(400, 'Email and password are required', 'VALIDATION_ERROR');
  }

  const userRow = await db('users').where({ email: email.trim().toLowerCase() }).first();
  if (!userRow) {
    throw httpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const matches = await bcrypt.compare(password, userRow.password_hash);
  if (!matches) {
    throw httpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  }

  if (!userRow.is_active) {
    throw httpError(403, 'This account is inactive', 'FORBIDDEN');
  }

  const user = await loadUser(userRow.id);
  const token = signToken(user);
  return { token, user };
}

async function updateProfile(userId, payload) {
  const patch = {};
  if (payload.fullName !== undefined) patch.full_name = payload.fullName;
  if (payload.phone !== undefined) patch.phone = payload.phone;
  if (payload.communicationPreference !== undefined) {
    patch.communication_preference = payload.communicationPreference;
  }
  if (payload.department !== undefined) patch.department = payload.department;
  patch.updated_at = db.fn.now();

  await db('users').where({ id: userId }).update(patch);
  return loadUser(userId);
}

module.exports = { login, updateProfile };

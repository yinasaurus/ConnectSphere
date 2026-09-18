const bcrypt = require('bcryptjs');
const { supabase, fetchOne, updateById } = require('../config/db');
const { BCRYPT_ROUNDS } = require('../constants/auth');
const { httpError } = require('../middleware/errorHandler');
const { signToken, loadUser } = require('../middleware/auth');

// Dummy hash so a missing user still runs bcrypt.compare and takes a
// similar amount of time as a real verify (reduces email-enumeration via timing).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-user', BCRYPT_ROUNDS);

function invalidCredentials() {
  return httpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
}

async function login(email, password) {
  const userRow = await fetchOne(
    supabase.from('users').select('*').eq('email', email.trim().toLowerCase())
  );

  const hash = userRow?.password_hash || DUMMY_PASSWORD_HASH;
  const matches = await bcrypt.compare(password, hash);

  if (!userRow || !matches) {
    throw invalidCredentials();
  }

  if (!userRow.is_active) {
    throw invalidCredentials();
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
  patch.updated_at = new Date().toISOString();

  await updateById('users', userId, patch);
  return loadUser(userId);
}

module.exports = { login, updateProfile };

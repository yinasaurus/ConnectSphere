const authService = require('../services/auth.service');
const { asyncHandler } = require('../utils/asyncHandler');
const { setSessionCookie, clearSessionCookie } = require('../middleware/auth');

const login = asyncHandler(async (req, res) => {
  const { user, token } = await authService.login(req.body.email, req.body.password);
  setSessionCookie(res, token);
  // Token is only in the httpOnly cookie — not in JSON — so the SPA
  // cannot persist it in localStorage (where XSS could steal it).
  res.json({ user });
});

const logout = asyncHandler(async (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.id, req.body);
  res.json({ user });
});

module.exports = { login, logout, me, updateMe };

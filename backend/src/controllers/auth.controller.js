const authService = require('../services/auth.service');
const { asyncHandler } = require('../utils/asyncHandler');

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body.email, req.body.password);
  res.json(result);
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.id, req.body);
  res.json({ user });
});

module.exports = { login, me, updateMe };

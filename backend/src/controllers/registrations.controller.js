const registrationsService = require('../services/registrations.service');
const { asyncHandler } = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const registrations = await registrationsService.listForEvent(req.user, req.params.id);
  res.json({ registrations });
});

const register = asyncHandler(async (req, res) => {
  const registration = await registrationsService.register(req.user, req.params.id);
  res.status(201).json({ registration });
});

const withdraw = asyncHandler(async (req, res) => {
  const registration = await registrationsService.withdraw(req.user, req.params.id);
  res.json({ registration });
});

module.exports = { list, register, withdraw };

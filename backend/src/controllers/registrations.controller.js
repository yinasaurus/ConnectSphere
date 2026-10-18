const registrationsService = require('../services/registrations.service');
const registrationSettings = require('../services/registrationSettings.service');
const { asyncHandler } = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const registrations = await registrationsService.listForEvent(req.user, req.params.id);
  res.json({ registrations });
});

// SCRUM-52: an Attendee registers; the response says how many places are left.
const register = asyncHandler(async (req, res) => {
  const { registration, placesLeft } = await registrationsService.register(req.user, req.params.id);
  res.status(201).json({ registration, placesLeft });
});

const withdraw = asyncHandler(async (req, res) => {
  const registration = await registrationsService.withdraw(req.user, req.params.id);
  res.json({ registration });
});

// SCRUM-63: the assigned Coordinator opens registration (window + capacity).
const enable = asyncHandler(async (req, res) => {
  const settings = await registrationSettings.enableRegistration(req.user, req.params.id, req.body);
  res.json({ settings });
});

// SCRUM-63 AC5, AC6: extend the close date or change capacity after registration is enabled.
const changeSettings = asyncHandler(async (req, res) => {
  const settings = await registrationSettings.changeRegistrationSettings(req.user, req.params.id, req.body);
  res.json({ settings });
});

module.exports = { list, register, withdraw, enable, changeSettings };

const venuesService = require('../services/venues.service');
const { asyncHandler } = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const venues = await venuesService.listVenues();
  res.json({ venues });
});

const create = asyncHandler(async (req, res) => {
  const venue = await venuesService.createVenue(req.user, req.body);
  res.status(201).json({ venue });
});

const update = asyncHandler(async (req, res) => {
  const venue = await venuesService.updateVenue(req.user, req.params.id, req.body);
  res.json({ venue });
});

const bookings = asyncHandler(async (req, res) => {
  const rows = await venuesService.listBookings({
    venueId: req.query.venueId,
    status: req.query.status,
  });
  res.json({ bookings: rows });
});

const requestBooking = asyncHandler(async (req, res) => {
  const booking = await venuesService.requestBooking(req.user, req.body);
  res.status(201).json({ booking });
});

const decideBooking = asyncHandler(async (req, res) => {
  const booking = await venuesService.decideBooking(req.user, req.params.id, req.body);
  res.json({ booking });
});

const unavailability = asyncHandler(async (req, res) => {
  const rows = await venuesService.listUnavailability(req.query.venueId);
  res.json({ unavailability: rows });
});

const block = asyncHandler(async (req, res) => {
  const blockRow = await venuesService.blockVenue(req.user, req.body);
  res.status(201).json({ unavailability: blockRow });
});

module.exports = {
  list,
  create,
  update,
  bookings,
  requestBooking,
  decideBooking,
  unavailability,
  block,
};

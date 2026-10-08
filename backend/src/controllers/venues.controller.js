const venuesService = require('../services/venues.service');
const { asyncHandler } = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const venues = await venuesService.listVenues();
  res.json({ venues });
});

const search = asyncHandler(async (req, res) => {
  const venues = await venuesService.searchVenues({
    startAt: req.query.startAt,
    endAt: req.query.endAt,
    capacityMin: req.query.capacityMin,
    location: req.query.location,
    accessibility: req.query.accessibility,
    layout: req.query.layout,
    facilities: req.query.facilities,
  });
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

/**
 * Purpose: POST /api/venues/bookings/:id/decision. Passes the signed-in Venue Staff member,
 * the booking id and the JSON body { approve, reason, alternativeSuggestion } to the service.
 * AC: SCRUM-78 AC1-AC6 (the service saves the decision and notifies the Coordinator).
 * Output: 200 { booking }. Errors from the service (403, 404, 500) go to the error handler.
 */
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
  search,
  create,
  update,
  bookings,
  requestBooking,
  decideBooking,
  unavailability,
  block,
};

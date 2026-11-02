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

// SCRUM-66: GET /api/venues/:id/availability?from=<ISO>&to=<ISO>
const availability = asyncHandler(async (req, res) => {
  const result = await venuesService.getVenueAvailability(req.params.id, {
    from: req.query.from,
    to: req.query.to,
  });
  res.json(result);
});

// SCRUM-67: GET /api/venues/:id/bookings?from=<ISO>&to=<ISO>
const venueBookings = asyncHandler(async (req, res) => {
  const result = await venuesService.listVenueBookingsForPeriod(req.params.id, {
    from: req.query.from,
    to: req.query.to,
  });
  res.json(result);
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

const requestReplacementBooking = asyncHandler(async (req, res) => {
  const booking = await venuesService.requestReplacementBooking(req.user, req.params.id, req.body);
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

/**
 * Purpose: POST /api/venues/holds. Passes the signed-in Venue Staff member and the JSON body
 * { eventId, venueId, expiresAt } to the service.
 * AC: SCRUM-75 AC1-AC5, AC9.
 * Output: 201 { booking } (status TENTATIVE, with hold_expires_at and coordinator_id).
 */
const placeHold = asyncHandler(async (req, res) => {
  const booking = await venuesService.placeHold(req.user, req.body);
  res.status(201).json({ booking });
});

/*
 * Purpose: pass the authenticated Coordinator and booking id to the cancellation service.
 * AC: SCRUM-61 AC1–AC7.
 * Inputs: req.user and req.params.id. Output: 200 { booking }; service errors go to the error handler.
 * Failure: propagates authorization, not-found, and invalid-status errors to the error handler.
 */
const cancelBooking = asyncHandler(async (req, res) => {
  const booking = await venuesService.cancelBooking(req.user, req.params.id);
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

/*
 * Purpose: pass the Venue Staff user and unavailability period id to the affected-bookings
 *   lookup.
 * AC: SCRUM-60 AC8. Inputs: req.user, req.params.id. Output: 200 { bookings }.
 * Failure: propagates 403/404 from the service to the error handler.
 */
const affectedBookings = asyncHandler(async (req, res) => {
  const rows = await venuesService.listBookingsAffectedByUnavailability(req.user, req.params.id);
  res.json({ bookings: rows });
});

module.exports = {
  list,
  search,
  availability,
  venueBookings,
  create,
  update,
  bookings,
  requestBooking,
  requestReplacementBooking,
  decideBooking,
  placeHold,
  cancelBooking,
  unavailability,
  block,
  affectedBookings,
};

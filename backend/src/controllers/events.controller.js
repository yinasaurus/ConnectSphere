const eventsService = require('../services/events.service');
const { asyncHandler } = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const events = await eventsService.listEvents(req.user, {
    status: req.query.status,
    q: req.query.q,
  });
  res.json({ events });
});

/**
 * Purpose: return one event the caller may view (including unassigned Coordinators).
 * AC: SCRUM-54 AC6
 */
const get = asyncHandler(async (req, res) => {
  const event = await eventsService.getEvent(req.user, req.params.id);
  res.json({ event });
});

const venueBookings = asyncHandler(async (req, res) => {
  const bookings = await eventsService.listVenueBookings(req.user, req.params.id);
  res.json({ bookings });
});

const create = asyncHandler(async (req, res) => {
  const event = await eventsService.createEvent(req.user, req.body);
  res.status(201).json({ event });
});

/**
 * Purpose: apply an edit. Unassigned Coordinators are refused by the service (403, unchanged).
 * AC: SCRUM-54 AC5, AC7
 */
const update = asyncHandler(async (req, res) => {
  const event = await eventsService.updateEvent(req.user, req.params.id, req.body);
  res.json({ event });
});

const submit = asyncHandler(async (req, res) => {
  const event = await eventsService.submitEvent(req.user, req.params.id);
  res.json({ event });
});

/**
 * Purpose: approve or reject. Only the assigned Coordinator succeeds; others get 403.
 * AC: SCRUM-54 AC5, AC7
 */
const decide = asyncHandler(async (req, res) => {
  const event = await eventsService.decideEvent(
    req.user,
    req.params.id,
    req.body.decision,
    req.body.reason
  );
  res.json({ event });
});

/**
 * Purpose: confirm or other status moves. Unassigned Coordinators are refused (403, unchanged).
 * AC: SCRUM-54 AC5, AC7
 */
const changeStatus = asyncHandler(async (req, res) => {
  const event = await eventsService.changeStatus(
    req.user,
    req.params.id,
    req.body.status,
    req.body.reason
  );
  res.json({ event });
});

const history = asyncHandler(async (req, res) => {
  const historyRows = await eventsService.listHistory(req.user, req.params.id);
  res.json({ history: historyRows });
});

const requestReassign = asyncHandler(async (req, res) => {
  const result = await eventsService.requestCoordinatorChange(
    req.user,
    req.params.id,
    req.body.coordinatorId
  );
  res.json(result);
});

const acceptReassign = asyncHandler(async (req, res) => {
  const event = await eventsService.acceptCoordinatorChange(req.user, req.params.id);
  res.json({ event });
});

const requestClarification = asyncHandler(async (req, res) => {
  const event = await eventsService.requestClarification(
    req.user,
    req.params.id,
    req.body.remarks
  );
  res.json({ event });
});

const respondClarification = asyncHandler(async (req, res) => {
  const event = await eventsService.respondClarification(
    req.user,
    req.params.id,
    req.body.response,
    req.body.amendments
  );
  res.json({ event });
});

module.exports = {
  list,
  get,
  venueBookings,
  create,
  update,
  submit,
  decide,
  changeStatus,
  history,
  requestReassign,
  acceptReassign,
  requestClarification,
  respondClarification,
};

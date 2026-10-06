const eventsService = require('../services/events.service');
const { asyncHandler } = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const events = await eventsService.listEvents(req.user, {
    status: req.query.status,
    q: req.query.q,
  });
  res.json({ events });
});

const get = asyncHandler(async (req, res) => {
  const event = await eventsService.getEvent(req.user, req.params.id);
  res.json({ event });
});

const venueBookings = asyncHandler(async (req, res) => {
  const bookings = await eventsService.listVenueBookings(req.user, req.params.id);
  res.json({ bookings });
});

/**
 * Purpose: GET /api/events/:id/equipment-requests, the event's equipment requests.
 * AC: SCRUM-39 AC2. Output: 200 { requests }. 403/404 from the service go to the error handler.
 */
const equipmentRequests = asyncHandler(async (req, res) => {
  const requests = await eventsService.listEquipmentRequests(req.user, req.params.id);
  res.json({ requests });
});

const create = asyncHandler(async (req, res) => {
  const event = await eventsService.createEvent(req.user, req.body);
  res.status(201).json({ event });
});

const update = asyncHandler(async (req, res) => {
  const event = await eventsService.updateEvent(req.user, req.params.id, req.body);
  res.json({ event });
});

const submit = asyncHandler(async (req, res) => {
  const event = await eventsService.submitEvent(req.user, req.params.id);
  res.json({ event });
});

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

module.exports = {
  list,
  get,
  venueBookings,
  equipmentRequests,
  create,
  update,
  submit,
  changeStatus,
  history,
  requestReassign,
  acceptReassign,
};

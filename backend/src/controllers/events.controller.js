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

const decide = asyncHandler(async (req, res) => {
  const event = await eventsService.decideEvent(
    req.user,
    req.params.id,
    req.body.decision,
    req.body.reason
  );
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

/**
 * Purpose: return active Coordinators for the Lead's assign dropdown.
 * AC: SCRUM-71 AC1, AC2
 * Inputs: authenticated Lead. Output: { coordinators }. Failure: 403 if not Lead.
 */
const listAssignableCoordinators = asyncHandler(async (req, res) => {
  const coordinators = await eventsService.listAssignableCoordinators(req.user);
  res.json({ coordinators });
});

/**
 * Purpose: assign one primary Coordinator to a Submitted event that has none.
 * AC: SCRUM-71 AC1-AC6
 * Inputs: event id, body.coordinatorId. Output: { event }. Failure: 403/404/409 from the service.
 */
const assignCoordinator = asyncHandler(async (req, res) => {
  const event = await eventsService.assignPrimaryCoordinator(
    req.user,
    req.params.id,
    req.body.coordinatorId
  );
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
  listAssignableCoordinators,
  assignCoordinator,
  requestClarification,
  respondClarification,
};

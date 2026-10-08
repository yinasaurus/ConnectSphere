const eventsService = require('../services/events.service');
const { asyncHandler } = require('../utils/asyncHandler');

/**
 * Purpose: list events the caller may see, including the Lead's unassigned queue when asked.
 * AC: SCRUM-28 AC3, AC4 — `unassigned=true` is Submitted + no Coordinator (drafts excluded).
 * Business rule: W7 #5; the Lead UI for this list is SCRUM-65.
 * Inputs: query.status, query.q, query.unassigned
 * Outputs: `{ events }`
 * Failure: 401 from auth middleware if there is no session
 */
const list = asyncHandler(async (req, res) => {
  const events = await eventsService.listEvents(req.user, {
    status: req.query.status,
    q: req.query.q,
    unassigned: req.query.unassigned === 'true' || req.query.unassigned === '1',
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

/**
 * Purpose: HTTP entry for submitting a complete request into the unassigned queue.
 * AC: SCRUM-28 AC1, AC2
 * Inputs: authenticated user, event id in the path
 * Outputs: `{ event }` with status SUBMITTED and coordinatorId null
 * Failure: service errors (403/400/404/409) are returned as JSON
 */
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

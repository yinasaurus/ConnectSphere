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

/**
 * Purpose: HTTP entry for the Lead's unassigned queue (Submitted, no Coordinator).
 * AC: SCRUM-65 AC1, AC2, AC3, AC4
 * Business rule: W7 #5 — the Lead sees basic event information before assigning (SCRUM-71).
 * Inputs: authenticated Lead (route is also requireRole Lead; SCRUM-54 AC3 owns the access tests).
 * Outputs: `{ events }` with name, organiser, date/time, attendance, venue and equipment needs.
 * Failure: 403 if the caller is not a Lead; 401 with no session.
 */
const listUnassignedQueue = asyncHandler(async (req, res) => {
  const events = await eventsService.listUnassignedQueue(req.user);
  res.json({ events });
});

/**
 * Purpose: GET /api/events/:id, one event's details for the signed-in user.
 * AC: SCRUM-39 AC1 + AC2. SCRUM-65 AC5 — the Lead can open a queued request's full details.
 *     SCRUM-54 AC6 — Coordinators may view events they are not assigned to.
 * Output: 200 { event }; 404 from the service goes to the error handler.
 */
const get = asyncHandler(async (req, res) => {
  const event = await eventsService.getEvent(req.user, req.params.id);
  res.json({ event });
});

/**
 * Purpose: GET /api/events/:id/venue-bookings, the event's venue bookings.
 * AC: SCRUM-39 AC2 (venue). Output: 200 { bookings }; 404 goes to the error handler.
 */
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

/**
 * Purpose: apply an edit. Unassigned Coordinators are refused by the service (403, unchanged).
 * AC: SCRUM-54 AC5, AC7
 */
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

const openForReview = asyncHandler(async (req, res) => {
  const event = await eventsService.openForReview(req.user, req.params.id);
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
  listUnassignedQueue,
  get,
  venueBookings,
  equipmentRequests,
  create,
  update,
  submit,
  openForReview,
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

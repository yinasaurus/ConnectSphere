const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const { validateBody } = require('../middleware/validate');
const { eventDecisionSchema, assignCoordinatorSchema } = require('../validators/events.validators');
const controller = require('../controllers/events.controller');
const registrations = require('../controllers/registrations.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', controller.list);
/**
 * Purpose: Lead-only list of Submitted requests with no Coordinator.
 * AC: SCRUM-65 AC1–AC4. Registered before `/:id` so "unassigned-queue" is not parsed as an id.
 */
router.get(
  '/unassigned-queue',
  requireRole(ROLES.EVENT_COORDINATOR_LEAD),
  controller.listUnassignedQueue
);
router.post('/', requireRole(ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR), controller.create);
// SCRUM-71: Lead-only list of active Coordinators, then assign one to a Submitted event.
router.get(
  '/assignable-coordinators',
  requireRole(ROLES.EVENT_COORDINATOR_LEAD),
  controller.listAssignableCoordinators
);
router.post(
  '/:id/assign-coordinator',
  requireRole(ROLES.EVENT_COORDINATOR_LEAD),
  validateBody(assignCoordinatorSchema),
  controller.assignCoordinator
);
// SCRUM-39 AC1 + AC2: no role gate here because who may see which event (and how much of it)
// is decided per event in the service; outsiders get 404.
router.get('/:id', controller.get);
// SCRUM-39 AC2 (booked venue): same per-event access as GET /:id; Attendees only see
// approved bookings.
router.get('/:id/venue-bookings', controller.venueBookings);
// SCRUM-39 AC2: access is decided per event in the service (same rules as GET /:id).
router.get('/:id/equipment-requests', controller.equipmentRequests);
router.patch('/:id', requireRole(ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR), controller.update);
router.post('/:id/submit', requireRole(ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR), controller.submit);
router.post('/:id/review', requireRole(ROLES.EVENT_COORDINATOR), controller.openForReview);
router.post(
  '/:id/decision',
  requireRole(ROLES.EVENT_COORDINATOR),
  validateBody(eventDecisionSchema),
  controller.decide
);
router.post('/:id/status', requireRole(ROLES.EVENT_COORDINATOR), controller.changeStatus);
router.post('/:id/clarification', requireRole(ROLES.EVENT_COORDINATOR), controller.requestClarification);
router.post('/:id/clarification/respond', controller.respondClarification);
router.get('/:id/history', controller.history);
router.post('/:id/reassign', requireRole(ROLES.EVENT_COORDINATOR), controller.requestReassign);
router.post('/:id/reassign/accept', requireRole(ROLES.EVENT_COORDINATOR), controller.acceptReassign);

router.get('/:id/registrations', registrations.list);
router.post('/:id/registrations', registrations.register);
router.post('/:id/registrations/withdraw', registrations.withdraw);

module.exports = router;

const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const { validateBody } = require('../middleware/validate');
const { eventDecisionSchema, assignCoordinatorSchema } = require('../validators/events.validators');
const controller = require('../controllers/events.controller');
const registrations = require('../controllers/registrations.controller');
const access = require('../controllers/access.controller');

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
/**
 * Purpose: Safety Officer queue of events awaiting a safety check.
 * AC: SCRUM-55 AC1, AC4. Registered before `/:id` so the path is not parsed as an id.
 */
router.get(
  '/safety-queue',
  requireRole(ROLES.SAFETY_OFFICER),
  access.safetyQueue
);
// SCRUM-39 AC1 + AC2: no role gate here because who may see which event (and how much of it)
// is decided per event in the service; outsiders get 404.
router.get('/:id', controller.get);
// AC: SCRUM-54 AC4 / SCRUM-55 AC4 / SCRUM-56 AC9 — only a Safety Officer may open or record.
router.get('/:id/safety-check', requireRole(ROLES.SAFETY_OFFICER), access.openSafetyCheck);
router.post('/:id/safety-check', requireRole(ROLES.SAFETY_OFFICER), access.recordSafetyCheck);
// SCRUM-39 AC2 (booked venue): same per-event access as GET /:id; Attendees only see
// approved bookings.
router.get('/:id/venue-bookings', controller.venueBookings);
// SCRUM-39 AC2: access is decided per event in the service (same rules as GET /:id).
router.get('/:id/equipment-requests', controller.equipmentRequests);
// SCRUM-47: Event Coordinator records equipment request for an event.
router.post(
  '/:id/equipment-requests',
  requireRole(ROLES.EVENT_COORDINATOR),
  controller.createEquipmentRequest
);
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
router.post('/:id/confirm', requireRole(ROLES.EVENT_COORDINATOR), controller.confirm);
router.post('/:id/clarification', requireRole(ROLES.EVENT_COORDINATOR), controller.requestClarification);
router.post('/:id/clarification/respond', controller.respondClarification);
router.get('/:id/history', controller.history);
router.post('/:id/reassign', requireRole(ROLES.EVENT_COORDINATOR), controller.requestReassign);
router.post('/:id/reassign/accept', requireRole(ROLES.EVENT_COORDINATOR), controller.acceptReassign);
// SCRUM-34 / SCRUM-35 / SCRUM-69: organiser change requests; assigned coordinator
// approves (applies valid fields, notifies organiser) or rejects (event unchanged, notifies).
router.get('/:id/change-requests', controller.listChangeRequests);
router.post(
  '/:id/change-requests',
  requireRole(ROLES.EVENT_ORGANISER),
  controller.createChangeRequest
);
router.post(
  '/:id/change-requests/:requestId/decision',
  requireRole(ROLES.EVENT_COORDINATOR),
  controller.decideChangeRequest
);

// SCRUM-63: only Coordinators reach these; the service also checks it is the assigned one (AC7).
router.post('/:id/registration/enable', requireRole(ROLES.EVENT_COORDINATOR), registrations.enable);
router.patch('/:id/registration', requireRole(ROLES.EVENT_COORDINATOR), registrations.changeSettings);
router.get('/:id/registrations', registrations.list);
router.get('/:id/registration-status', registrations.status);
router.post('/:id/registrations', registrations.register);
router.post('/:id/registrations/withdraw', registrations.withdraw);

module.exports = router;

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
router.get('/:id', controller.get);
router.get('/:id/venue-bookings', controller.venueBookings);
router.patch('/:id', requireRole(ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR), controller.update);
router.post('/:id/submit', requireRole(ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR), controller.submit);
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

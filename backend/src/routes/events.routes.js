const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const { validateBody } = require('../middleware/validate');
const { eventDecisionSchema } = require('../validators/events.validators');
const controller = require('../controllers/events.controller');
const registrations = require('../controllers/registrations.controller');
const access = require('../controllers/access.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', controller.list);
router.post('/', requireRole(ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR), controller.create);
// Registered before /:id so "unassigned-queue" is not treated as an event id.
// AC: SCRUM-54 AC3 — only a Lead may open the unassigned queue.
router.get(
  '/unassigned-queue',
  requireRole(ROLES.EVENT_COORDINATOR_LEAD),
  access.unassignedQueue
);
router.get('/:id', controller.get);
// AC: SCRUM-54 AC4 — only a Safety Officer may open or record a safety check.
router.get('/:id/safety-check', requireRole(ROLES.SAFETY_OFFICER), access.openSafetyCheck);
router.post('/:id/safety-check', requireRole(ROLES.SAFETY_OFFICER), access.recordSafetyCheck);
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

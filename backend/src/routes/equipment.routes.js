const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const controller = require('../controllers/equipment.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', controller.list);
router.post('/', requireRole(ROLES.TECHNICAL_SUPPORT), controller.create);
/**
 * Purpose: Tech-only availability check by catalogue item, quantity and window.
 * AC: SCRUM-21 AC1–AC6. Registered before /:id so "availability" is not an id.
 */
router.get('/availability', requireRole(ROLES.TECHNICAL_SUPPORT), controller.availability);
router.patch('/:id', requireRole(ROLES.TECHNICAL_SUPPORT), controller.update);

router.get('/requests', controller.requests);
router.post('/requests', requireRole(ROLES.EVENT_COORDINATOR), controller.createRequest);
/**
 * Purpose: Tech-only availability check for one stored request.
 * AC: SCRUM-21 AC7
 */
router.get(
  '/requests/:id/availability',
  requireRole(ROLES.TECHNICAL_SUPPORT),
  controller.requestAvailability
);
/**
 * Purpose: Tech reserves a pending request for its event, or marks it unavailable.
 * AC: SCRUM-8 AC1–AC3. requireRole is the HTTP half of AC3; the service also checks.
 */
router.post('/requests/:id/decision', requireRole(ROLES.TECHNICAL_SUPPORT), controller.decideRequest);

/**
 * Purpose: Tech reviews and updates request status as arrangements are made.
 * AC: SCRUM-48 AC1–AC4.
 */
router.patch('/requests/:id', requireRole(ROLES.TECHNICAL_SUPPORT), controller.updateRequest);
router.post('/requests/:id/status', requireRole(ROLES.TECHNICAL_SUPPORT), controller.updateRequest);

module.exports = router;

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
router.post('/requests/:id/decision', requireRole(ROLES.TECHNICAL_SUPPORT), controller.decideRequest);

module.exports = router;

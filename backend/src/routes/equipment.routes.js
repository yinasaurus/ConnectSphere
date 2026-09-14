const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const controller = require('../controllers/equipment.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', controller.list);
router.post('/', requireRole(ROLES.TECHNICAL_SUPPORT), controller.create);
router.patch('/:id', requireRole(ROLES.TECHNICAL_SUPPORT), controller.update);

router.get('/requests', controller.requests);
router.post('/requests', requireRole(ROLES.EVENT_COORDINATOR), controller.createRequest);
router.post('/requests/:id/decision', requireRole(ROLES.TECHNICAL_SUPPORT), controller.decideRequest);

module.exports = router;

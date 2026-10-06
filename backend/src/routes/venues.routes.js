const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const controller = require('../controllers/venues.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', controller.list);
router.get('/search', controller.search);
router.post('/', requireRole(ROLES.VENUE_STAFF), controller.create);
router.patch('/:id', requireRole(ROLES.VENUE_STAFF), controller.update);

router.get(
  '/bookings',
  requireRole(ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF),
  controller.bookings
);
router.post('/bookings', requireRole(ROLES.EVENT_COORDINATOR), controller.requestBooking);
// Venue Staff approve or reject a booking request; the assigned Coordinator is notified
// (SCRUM-78). Anyone else gets 403 here, before anything is saved or sent.
router.post('/bookings/:id/decision', requireRole(ROLES.VENUE_STAFF), controller.decideBooking);

router.get('/unavailability', controller.unavailability);
router.post('/unavailability', requireRole(ROLES.VENUE_STAFF), controller.block);

module.exports = router;

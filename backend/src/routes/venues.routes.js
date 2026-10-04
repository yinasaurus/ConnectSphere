const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const controller = require('../controllers/venues.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', controller.list);
router.get('/search', controller.search);
// SCRUM-66 AC6: internal users only; Event Organisers and Attendees get 403.
router.get(
  '/:id/availability',
  requireRole(ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF, ROLES.TECHNICAL_SUPPORT),
  controller.availability
);
// SCRUM-67 AC5: coordinators, venue staff and the coordinator lead only.
router.get(
  '/:id/bookings',
  requireRole(ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF, ROLES.EVENT_COORDINATOR_LEAD),
  controller.venueBookings
);
router.post('/', requireRole(ROLES.VENUE_STAFF), controller.create);
router.patch('/:id', requireRole(ROLES.VENUE_STAFF), controller.update);

router.get(
  '/bookings',
  requireRole(ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF),
  controller.bookings
);
router.post('/bookings', requireRole(ROLES.EVENT_COORDINATOR), controller.requestBooking);
router.post('/bookings/:id/decision', requireRole(ROLES.VENUE_STAFF), controller.decideBooking);

router.get('/unavailability', controller.unavailability);
router.post('/unavailability', requireRole(ROLES.VENUE_STAFF), controller.block);

module.exports = router;

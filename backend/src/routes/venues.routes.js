const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const controller = require('../controllers/venues.controller');
const { validateBody } = require('../middleware/validate');
const { createVenueSchema, updateVenueSchema } = require('../validators/venues.validators');

const router = express.Router();

router.use(requireAuth);

router.get('/', controller.list);

router.post('/', requireRole(ROLES.VENUE_STAFF), validateBody(createVenueSchema), controller.create);
router.patch('/:id', requireRole(ROLES.VENUE_STAFF), validateBody(updateVenueSchema), controller.update);
router.get('/search', controller.search);

router.get(
  '/bookings',
  requireRole(ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF),
  controller.bookings
);
router.post('/bookings', requireRole(ROLES.EVENT_COORDINATOR), controller.requestBooking);
// Venue Staff approve or reject a booking request; the assigned Coordinator is notified
// (SCRUM-78). Anyone else gets 403 here, before anything is saved or sent.
router.post('/bookings/:id/decision', requireRole(ROLES.VENUE_STAFF), controller.decideBooking);

/*
 * Purpose: restrict the booking-cancellation handler to Event Coordinators.
 * AC: SCRUM-61 AC7 — other roles are rejected before the service reads or writes data.
 * Inputs: authenticated session and booking id. Output: delegates authorized requests to the controller.
 * Failure: requireAuth or requireRole returns 401/403 without invoking the controller.
 */
router.post('/bookings/:id/cancel', requireRole(ROLES.EVENT_COORDINATOR), controller.cancelBooking);

/*
 * Purpose: restrict booking rescheduling to authenticated Event Coordinators before controller execution.
 * AC: SCRUM-62 AC7 — users without the Coordinator role are rejected before booking data is accessed.
 * Inputs: authenticated request and booking id. Output: delegates eligible requests to the controller.
 * Failure: requireAuth or requireRole returns 401/403 without invoking the controller.
 */
router.patch('/bookings/:id', requireRole(ROLES.EVENT_COORDINATOR), controller.changeBooking);

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

router.get('/unavailability', controller.unavailability);
router.post('/unavailability', requireRole(ROLES.VENUE_STAFF), controller.block);

module.exports = router;

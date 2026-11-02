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
// SCRUM-68: the service verifies the flagged booking and the assigned Coordinator.
router.post(
  '/bookings/:id/replacement',
  requireRole(ROLES.EVENT_COORDINATOR),
  controller.requestReplacementBooking
);
// Venue Staff approve or reject a booking request; the assigned Coordinator is notified
// (SCRUM-78). Anyone else gets 403 here, before anything is saved or sent.
router.post('/bookings/:id/decision', requireRole(ROLES.VENUE_STAFF), controller.decideBooking);

// SCRUM-75 AC9: only Venue Staff place a hold. Anyone else gets 403 before anything is saved.
router.post('/holds', requireRole(ROLES.VENUE_STAFF), controller.placeHold);

/*
 * Purpose: restrict the booking-cancellation handler to Event Coordinators.
 * AC: SCRUM-61 AC7 — other roles are rejected before the service reads or writes data.
 * Inputs: authenticated session and booking id. Output: delegates authorized requests to the controller.
 * Failure: requireAuth or requireRole returns 401/403 without invoking the controller.
 */
router.post('/bookings/:id/cancel', requireRole(ROLES.EVENT_COORDINATOR), controller.cancelBooking);

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
// SCRUM-60 AC8: the Venue Staff who recorded a period can view the bookings it affects.
router.get(
  '/unavailability/:id/affected-bookings',
  requireRole(ROLES.VENUE_STAFF),
  controller.affectedBookings
);

module.exports = router;

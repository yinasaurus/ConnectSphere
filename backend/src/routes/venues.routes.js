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

router.get('/bookings', controller.bookings);
router.post('/bookings', requireRole(ROLES.EVENT_COORDINATOR), controller.requestBooking);
router.post('/bookings/:id/decision', requireRole(ROLES.VENUE_STAFF), controller.decideBooking);

router.get('/unavailability', controller.unavailability);
router.post('/unavailability', requireRole(ROLES.VENUE_STAFF), controller.block);

module.exports = router;

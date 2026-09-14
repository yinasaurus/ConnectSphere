const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/notifications.controller');

const router = express.Router();

router.use(requireAuth);
router.get('/', controller.list);
router.post('/:id/read', controller.read);

module.exports = router;

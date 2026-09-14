const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/auth.controller');

const router = express.Router();

router.post('/login', controller.login);
router.get('/me', requireAuth, controller.me);
router.patch('/me', requireAuth, controller.updateMe);

module.exports = router;

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { loginSchema } = require('../validators/auth.validators');
const controller = require('../controllers/auth.controller');

const router = express.Router();

router.post('/login', validateBody(loginSchema), controller.login);
router.post('/logout', controller.logout);
router.get('/me', requireAuth, controller.me);
router.patch('/me', requireAuth, controller.updateMe);

module.exports = router;

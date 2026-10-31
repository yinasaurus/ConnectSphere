const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const controller = require('../controllers/access.controller');

const router = express.Router();

/**
 * Purpose: Lead-only overview of the Coordinators and events this Lead allocated.
 * AC: SCRUM-54 AC3 (only a Lead can open it). SCRUM-57 AC1–AC5 (whose events are listed).
 * Mounted at /api so this path is /api/assignments/overview.
 * Auth is on this route only so unmatched /api paths still fall through to 404
 * instead of being intercepted as unauthenticated.
 */
router.get(
  '/assignments/overview',
  requireAuth,
  requireRole(ROLES.EVENT_COORDINATOR_LEAD),
  controller.assignmentOverview
);

module.exports = router;

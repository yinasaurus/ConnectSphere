const accessService = require('../services/access.service');
const { asyncHandler } = require('../utils/asyncHandler');

/**
 * Purpose: HTTP wrapper for the Lead-only unassigned event queue.
 * AC: SCRUM-54 AC3
 * Inputs: authenticated request. Output: `{ events }`. Failure: 403 from the service.
 */
const unassignedQueue = asyncHandler(async (req, res) => {
  const events = await accessService.listUnassignedQueue(req.user);
  res.json({ events });
});

/**
 * Purpose: HTTP wrapper for the Lead-only coordinator assignment overview.
 * AC: SCRUM-54 AC3
 * Inputs: authenticated request. Output: `{ assignments }`. Failure: 403 from the service.
 */
const assignmentOverview = asyncHandler(async (req, res) => {
  const assignments = await accessService.listAssignmentOverview(req.user);
  res.json({ assignments });
});

/**
 * Purpose: HTTP wrapper for opening a safety check.
 * AC: SCRUM-54 AC4
 * Inputs: authenticated request, event id. Output: `{ safetyCheck }`.
 * Failure: 403/404 from the service; the 403 body has no event resource.
 */
const openSafetyCheck = asyncHandler(async (req, res) => {
  const safetyCheck = await accessService.openSafetyCheck(req.user, req.params.id);
  res.json({ safetyCheck });
});

/**
 * Purpose: HTTP wrapper for recording a safety-check outcome.
 * AC: SCRUM-54 AC4
 * Inputs: authenticated request, event id, `{ outcome }`.
 * Output: `{ safetyCheck }`. Failure: 400/403/404 from the service.
 */
const recordSafetyCheck = asyncHandler(async (req, res) => {
  const safetyCheck = await accessService.recordSafetyCheck(
    req.user,
    req.params.id,
    req.body?.outcome
  );
  res.json({ safetyCheck });
});

module.exports = {
  unassignedQueue,
  assignmentOverview,
  openSafetyCheck,
  recordSafetyCheck,
};

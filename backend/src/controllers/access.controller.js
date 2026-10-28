const accessService = require('../services/access.service');
const { asyncHandler } = require('../utils/asyncHandler');

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
 * Purpose: HTTP wrapper for the Safety Officer awaiting-safety queue.
 * AC: SCRUM-55 AC1, AC4
 * Inputs: authenticated Safety Officer. Output: `{ events }`.
 * Failure: 403 if not a Safety Officer.
 */
const safetyQueue = asyncHandler(async (req, res) => {
  const events = await accessService.listSafetyQueue(req.user);
  res.json({ events });
});

/**
 * Purpose: HTTP wrapper for opening a safety check with review details.
 * AC: SCRUM-55 AC2, AC4
 * Inputs: authenticated request, event id. Output: `{ safetyCheck }`.
 * Failure: 403/404/409 from the service; the 403 body has no event resource.
 */
const openSafetyCheck = asyncHandler(async (req, res) => {
  const safetyCheck = await accessService.openSafetyCheck(req.user, req.params.id);
  res.json({ safetyCheck });
});

/**
 * Purpose: HTTP wrapper for recording approve / reject / request changes.
 * AC: SCRUM-56 AC1–AC7, AC9
 * Inputs: authenticated request, event id, `{ outcome, reason?, affectedArrangements? }`.
 * Output: `{ safetyCheck }`. Failure: 400/403/404/409 from the service.
 */
const recordSafetyCheck = asyncHandler(async (req, res) => {
  const safetyCheck = await accessService.recordSafetyCheck(
    req.user,
    req.params.id,
    req.body || {}
  );
  res.json({ safetyCheck });
});

module.exports = {
  assignmentOverview,
  safetyQueue,
  openSafetyCheck,
  recordSafetyCheck,
};

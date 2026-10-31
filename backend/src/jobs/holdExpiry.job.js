const { expireHolds } = require('../services/venues.service');

// How often holds are checked. A hold can stay Held for up to this long after its expiry,
// but every read path already treats it as expired from the exact expiry time (SCRUM-76 AC5).
const DEFAULT_INTERVAL_MS = 60 * 1000;

/**
 * Purpose: run expireHolds on a timer so holds expire with no user action.
 * AC: SCRUM-76 AC1 (automatic), AC7 (each run is safe to repeat).
 * Inputs: { intervalMs, run } — run defaults to expireHolds; tests pass their own.
 * Output: a stop() function that clears the timer.
 * Failure: an error in one run is logged and the next run still happens.
 */
function startHoldExpiryJob({ intervalMs = DEFAULT_INTERVAL_MS, run = expireHolds } = {}) {
  async function tick() {
    try {
      const expired = await run(new Date());
      if (expired.length) {
        console.log(`Expired ${expired.length} venue hold(s): ${expired.map((row) => row.id).join(', ')}`);
      }
    } catch (error) {
      console.error('Hold expiry run failed', error);
    }
  }

  // Run once at start-up so holds that expired while the server was down are released.
  tick();
  const timer = setInterval(tick, intervalMs);
  // Don't keep the process alive just for this timer.
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { startHoldExpiryJob, DEFAULT_INTERVAL_MS };

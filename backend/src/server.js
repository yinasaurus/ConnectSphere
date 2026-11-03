const { createApp } = require('./app');
const { env } = require('./config/env');
const { startHoldExpiryJob } = require('./jobs/holdExpiry.job');
const { processDueHoldNotifications } = require('./services/venues.service');

const app = createApp();
let holdNotificationTimer;

const server = app.listen(env.port, () => {
  console.log(`ConnectSphere API listening on http://localhost:${env.port}`);
  const pollHoldNotifications = () => {
    processDueHoldNotifications().catch((error) => {
      console.error('[hold-notifications] Failed to process due hold notifications', error);
    });
  };
  pollHoldNotifications();
  holdNotificationTimer = setInterval(pollHoldNotifications, env.holdNotificationPollMs);
});

// SCRUM-76: expire venue holds automatically. Started here, not in app.js, so tests that
// build the app don't start a timer.
const stopHoldExpiryJob = startHoldExpiryJob();

function shutdown() {
  if (holdNotificationTimer) clearInterval(holdNotificationTimer);
  stopHoldExpiryJob();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

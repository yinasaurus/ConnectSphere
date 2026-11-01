const { createApp } = require('./app');
const { env } = require('./config/env');
const { processDueHoldNotifications } = require('./services/venues.service');

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`ConnectSphere API listening on http://localhost:${env.port}`);
  const pollHoldNotifications = () => {
    processDueHoldNotifications().catch((error) => {
      console.error('[hold-notifications] Failed to process due hold notifications', error);
    });
  };
  pollHoldNotifications();
  server.holdNotificationTimer = setInterval(pollHoldNotifications, env.holdNotificationPollMs);
});

function shutdown() {
  if (server.holdNotificationTimer) clearInterval(server.holdNotificationTimer);
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

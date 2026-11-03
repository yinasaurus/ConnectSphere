const { createApp } = require('./app');
const { env } = require('./config/env');
const { startHoldExpiryJob } = require('./jobs/holdExpiry.job');

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`ConnectSphere API listening on http://localhost:${env.port}`);
});

// SCRUM-76: expire venue holds automatically. Started here, not in app.js, so tests that
// build the app don't start a timer.
const stopHoldExpiryJob = startHoldExpiryJob();

function shutdown() {
  stopHoldExpiryJob();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

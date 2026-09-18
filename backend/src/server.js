const { createApp } = require('./app');
const { env } = require('./config/env');

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`ConnectSphere API listening on http://localhost:${env.port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

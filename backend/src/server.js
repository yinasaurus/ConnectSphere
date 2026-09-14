const { createApp } = require('./app');
const { env } = require('./config/env');
const { db } = require('./config/db');

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`ConnectSphere API listening on http://localhost:${env.port}`);
});

async function shutdown() {
  server.close(async () => {
    await db.destroy();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

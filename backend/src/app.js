const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { env } = require('./config/env');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const eventsRoutes = require('./routes/events.routes');
const venuesRoutes = require('./routes/venues.routes');
const equipmentRoutes = require('./routes/equipment.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const miscRoutes = require('./routes/misc.routes');

function createApp() {
  const app = express();

  app.use(helmet());
  // Reflect a single origin (not *) so credentialed cookies are allowed.
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.use('/api', miscRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/venues', venuesRoutes);
  app.use('/api/equipment', equipmentRoutes);
  app.use('/api/notifications', notificationsRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

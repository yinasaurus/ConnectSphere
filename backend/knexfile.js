require('dotenv').config();

const connection = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'connectsphere',
  timezone: 'Z',
};

const knexConfig = {
  client: 'mysql2',
  connection,
  pool: { min: 0, max: 10 },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: './seeds',
  },
};

module.exports = {
  development: knexConfig,
  test: {
    ...knexConfig,
    connection: {
      ...connection,
      database: process.env.DB_NAME_TEST || process.env.DB_NAME || 'connectsphere',
    },
  },
  production: knexConfig,
};

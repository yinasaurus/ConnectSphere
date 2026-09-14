const knex = require('knex');
const knexfile = require('../../knexfile');
const { env } = require('./env');

const db = knex(knexfile[env.nodeEnv] || knexfile.development);

module.exports = { db };

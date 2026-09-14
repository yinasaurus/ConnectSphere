const express = require('express');
const { db } = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const { httpError } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'connectsphere-api' });
});

router.get('/health/db', asyncHandler(async (_req, res) => {
  await db.raw('select 1 as ok');
  res.json({ status: 'ok', database: 'up' });
}));

router.get('/users', requireAuth, requireRole(
  ROLES.EVENT_COORDINATOR,
  ROLES.VENUE_STAFF,
  ROLES.TECHNICAL_SUPPORT
), asyncHandler(async (req, res) => {
  const role = req.query.role;
  const query = db('users as u')
    .join('user_roles as ur', 'ur.user_id', 'u.id')
    .where('u.is_active', 1)
    .select('u.id', 'u.full_name as fullName', 'u.email', 'ur.role')
    .orderBy('u.full_name');
  if (role) query.where('ur.role', role);
  res.json({ users: await query });
}));

router.get('/comments/:eventId', requireAuth, asyncHandler(async (req, res) => {
  const comments = await db('event_comments as c')
    .join('users as u', 'u.id', 'c.author_id')
    .where('c.event_id', req.params.eventId)
    .orderBy('c.created_at')
    .select('c.*', 'u.full_name as author_name');
  res.json({ comments });
}));

router.post('/comments/:eventId', requireAuth, asyncHandler(async (req, res) => {
  if (!req.body.body) throw httpError(400, 'Comment body is required', 'VALIDATION_ERROR');
  const [id] = await db('event_comments').insert({
    event_id: req.params.eventId,
    author_id: req.user.id,
    body: req.body.body,
  });
  const comment = await db('event_comments').where({ id }).first();
  res.status(201).json({ comment });
}));

module.exports = router;

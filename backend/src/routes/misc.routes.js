const express = require('express');
const { supabase, fetchMany, insertOne, pingDatabase } = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const { httpError } = require('../middleware/errorHandler');
const { assertPlanningAccess } = require('../services/events.service');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'connectsphere-api' });
});

router.get('/health/db', asyncHandler(async (_req, res) => {
  await pingDatabase();
  res.json({ status: 'ok', database: 'up' });
}));

router.get('/users', requireAuth, requireRole(
  ROLES.EVENT_COORDINATOR,
  ROLES.VENUE_STAFF,
  ROLES.TECHNICAL_SUPPORT
), asyncHandler(async (req, res) => {
  let query = supabase
    .from('user_roles')
    .select('role, users!inner ( id, full_name, email, is_active )')
    .eq('users.is_active', true);
  if (req.query.role) query = query.eq('role', req.query.role);
  const rows = await fetchMany(query);
  const users = rows
    .map((row) => ({
      id: row.users.id,
      fullName: row.users.full_name,
      email: row.users.email,
      role: row.role,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  res.json({ users });
}));

router.get('/comments/:eventId', requireAuth, asyncHandler(async (req, res) => {
  await assertPlanningAccess(req.user, req.params.eventId);
  const comments = await fetchMany(
    supabase
      .from('event_comments')
      .select('*, author:users!author_id ( full_name )')
      .eq('event_id', req.params.eventId)
      .order('created_at')
  );
  res.json({
    comments: comments.map((row) => ({
      ...row,
      author_name: row.author?.full_name,
    })),
  });
}));

router.post('/comments/:eventId', requireAuth, asyncHandler(async (req, res) => {
  await assertPlanningAccess(req.user, req.params.eventId);
  if (!req.body.body) throw httpError(400, 'Comment body is required', 'VALIDATION_ERROR');
  const comment = await insertOne('event_comments', {
    event_id: req.params.eventId,
    author_id: req.user.id,
    body: req.body.body,
  });
  res.status(201).json({ comment });
}));

module.exports = router;

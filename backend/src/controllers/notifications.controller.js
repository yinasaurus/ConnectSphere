const notificationsService = require('../services/notifications.service');
const { asyncHandler } = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const notifications = await notificationsService.listMine(req.user.id);
  const unread = await notificationsService.unreadCount(req.user.id);
  res.json({ notifications, unread });
});

const read = asyncHandler(async (req, res) => {
  const notification = await notificationsService.markRead(req.user.id, req.params.id);
  res.json({ notification });
});

module.exports = { list, read };

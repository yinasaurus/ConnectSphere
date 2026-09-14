const equipmentService = require('../services/equipment.service');
const { asyncHandler } = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const equipment = await equipmentService.listEquipment();
  res.json({ equipment });
});

const create = asyncHandler(async (req, res) => {
  const item = await equipmentService.upsertEquipment(req.user, req.body);
  res.status(201).json({ equipment: item });
});

const update = asyncHandler(async (req, res) => {
  const item = await equipmentService.upsertEquipment(req.user, req.body, req.params.id);
  res.json({ equipment: item });
});

const requests = asyncHandler(async (req, res) => {
  const rows = await equipmentService.listRequests(req.query.eventId);
  res.json({ requests: rows });
});

const createRequest = asyncHandler(async (req, res) => {
  const request = await equipmentService.createRequest(req.user, req.body);
  res.status(201).json({ request });
});

const decideRequest = asyncHandler(async (req, res) => {
  const request = await equipmentService.decideRequest(req.user, req.params.id, req.body);
  res.json({ request });
});

module.exports = { list, create, update, requests, createRequest, decideRequest };

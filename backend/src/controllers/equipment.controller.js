const equipmentService = require('../services/equipment.service');
const { asyncHandler } = require('../utils/asyncHandler');

/**
 * Purpose: GET /api/equipment — list the lightweight catalogue.
 * AC: SCRUM-21 uses these rows as the pool (type, quantity, status).
 */
const list = asyncHandler(async (req, res) => {
  const equipment = await equipmentService.listEquipment();
  res.json({ equipment });
});

/**
 * Purpose: POST /api/equipment — Technical Support creates a catalogue item.
 * Business rule: W4 — Tech maintains the catalogue.
 */
const create = asyncHandler(async (req, res) => {
  const item = await equipmentService.upsertEquipment(req.user, req.body);
  res.status(201).json({ equipment: item });
});

/**
 * Purpose: PATCH /api/equipment/:id — Technical Support updates a catalogue item.
 * Business rule: W4.
 */
const update = asyncHandler(async (req, res) => {
  const item = await equipmentService.upsertEquipment(req.user, req.body, req.params.id);
  res.json({ equipment: item });
});

/**
 * Purpose: GET /api/equipment/requests — list reservation requests Tech arranges from.
 * AC: SCRUM-21 AC7
 */
const requests = asyncHandler(async (req, res) => {
  const rows = await equipmentService.listRequests(req.query.eventId);
  res.json({ requests: rows });
});

/**
 * Purpose: POST /api/equipment/requests — Coordinator records equipment needed.
 * Business rule: briefing Equipment Request Management.
 */
const createRequest = asyncHandler(async (req, res) => {
  const request = await equipmentService.createRequest(req.user, req.body);
  res.status(201).json({ request });
});

/**
 * Purpose: POST /api/equipment/requests/:id/decision — reserve or mark unavailable.
 * Business rule: briefing Equipment Reservation. SCRUM-21 does not change this decision.
 */
const decideRequest = asyncHandler(async (req, res) => {
  const request = await equipmentService.decideRequest(req.user, req.params.id, req.body);
  res.json({ request });
});

/**
 * Purpose: GET /api/equipment/availability — ad-hoc check for an item, qty and window.
 * AC: SCRUM-21 AC1–AC6
 * Inputs: query.equipmentId, query.quantity, query.from, query.to
 * Output: 200 availability payload. 403/400/404 from the service.
 */
const availability = asyncHandler(async (req, res) => {
  const result = await equipmentService.checkEquipmentAvailability(req.user, {
    equipmentId: req.query.equipmentId,
    quantity: req.query.quantity,
    from: req.query.from,
    to: req.query.to,
  });
  res.json(result);
});

/**
 * Purpose: GET /api/equipment/requests/:id/availability — check a stored request.
 * AC: SCRUM-21 AC7
 * Inputs: request id. Output: 200 availability payload including requestId.
 */
const requestAvailability = asyncHandler(async (req, res) => {
  const result = await equipmentService.checkRequestAvailability(req.user, req.params.id);
  res.json(result);
});

module.exports = {
  list,
  create,
  update,
  requests,
  createRequest,
  decideRequest,
  availability,
  requestAvailability,
};

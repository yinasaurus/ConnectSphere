const { db } = require('../config/db');
const { ROLES } = require('../constants/roles');
const { EQUIPMENT_STATUS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');
const { hasRole } = require('../middleware/auth');
const { writeAudit, notifyUser } = require('./audit.service');

async function listEquipment() {
  return db('equipment').orderBy('name');
}

async function upsertEquipment(user, payload, id) {
  if (!hasRole(user, ROLES.TECHNICAL_SUPPORT)) {
    throw httpError(403, 'Only technical support staff can maintain the catalogue', 'FORBIDDEN');
  }

  const row = {
    name: payload.name,
    type: payload.type || 'GENERAL',
    description: payload.description || null,
    quantity: payload.quantity || 1,
    location: payload.location || null,
    status: payload.status || EQUIPMENT_STATUS.AVAILABLE,
  };

  if (id) {
    await db('equipment').where({ id }).update({ ...row, updated_at: db.fn.now() });
    return db('equipment').where({ id }).first();
  }

  const [createdId] = await db('equipment').insert(row);
  await writeAudit(user.id, 'EQUIPMENT_CREATED', 'equipment', createdId, row);
  return db('equipment').where({ id: createdId }).first();
}

async function listRequests(eventId) {
  return db('equipment_requests as r')
    .leftJoin('equipment as eq', 'eq.id', 'r.equipment_id')
    .modify((query) => {
      if (eventId) query.where('r.event_id', eventId);
    })
    .select('r.*', 'eq.name as equipment_name', 'eq.status as equipment_status')
    .orderBy('r.id', 'desc');
}

async function createRequest(user, payload) {
  if (!hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'Only coordinators can request equipment', 'FORBIDDEN');
  }
  const [id] = await db('equipment_requests').insert({
    event_id: payload.eventId,
    equipment_id: payload.equipmentId || null,
    quantity: payload.quantity || 1,
    notes: payload.notes || null,
    status: 'PENDING',
    requested_by: user.id,
  });
  return db('equipment_requests').where({ id }).first();
}

async function decideRequest(user, id, decision) {
  if (!hasRole(user, ROLES.TECHNICAL_SUPPORT)) {
    throw httpError(403, 'Only technical support staff can reserve equipment', 'FORBIDDEN');
  }

  const request = await db('equipment_requests').where({ id }).first();
  if (!request) throw httpError(404, 'Equipment request not found', 'NOT_FOUND');

  const status = decision.approve ? 'RESERVED' : 'UNAVAILABLE';
  await db('equipment_requests').where({ id }).update({
    status,
    decided_by: user.id,
    decision_reason: decision.reason || null,
    decided_at: db.fn.now(),
  });

  if (decision.approve && request.equipment_id) {
    await db('equipment_reservations').insert({
      event_id: request.event_id,
      equipment_id: request.equipment_id,
      quantity: request.quantity,
      status: 'RESERVED',
    });
  }

  const event = await db('events').where({ id: request.event_id }).first();
  if (event?.coordinator_id) {
    await notifyUser(
      event.coordinator_id,
      'EQUIPMENT_DECISION',
      `Equipment ${status.toLowerCase()}`,
      decision.reason || `An equipment request for ${event.name} is ${status.toLowerCase()}.`,
      event.id
    );
  }

  return db('equipment_requests').where({ id }).first();
}

module.exports = {
  listEquipment,
  upsertEquipment,
  listRequests,
  createRequest,
  decideRequest,
};

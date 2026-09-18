const { supabase, fetchMany, fetchOne, insertOne, updateById } = require('../config/db');
const { ROLES } = require('../constants/roles');
const { EQUIPMENT_STATUS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');
const { hasRole } = require('../middleware/auth');
const { writeAudit, notifyUser } = require('./audit.service');

async function listEquipment() {
  return fetchMany(supabase.from('equipment').select('*').order('name'));
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
    return updateById('equipment', id, { ...row, updated_at: new Date().toISOString() });
  }

  const created = await insertOne('equipment', row);
  await writeAudit(user.id, 'EQUIPMENT_CREATED', 'equipment', created.id, row);
  return created;
}

async function listRequests(eventId) {
  let query = supabase
    .from('equipment_requests')
    .select('*, equipment ( name, status )')
    .order('id', { ascending: false });
  if (eventId) query = query.eq('event_id', eventId);
  const rows = await fetchMany(query);
  return rows.map((row) => ({
    ...row,
    equipment_name: row.equipment?.name,
    equipment_status: row.equipment?.status,
  }));
}

async function createRequest(user, payload) {
  if (!hasRole(user, ROLES.EVENT_COORDINATOR)) {
    throw httpError(403, 'Only coordinators can request equipment', 'FORBIDDEN');
  }
  return insertOne('equipment_requests', {
    event_id: payload.eventId,
    equipment_id: payload.equipmentId || null,
    quantity: payload.quantity || 1,
    notes: payload.notes || null,
    status: 'PENDING',
    requested_by: user.id,
  });
}

async function decideRequest(user, id, decision) {
  if (!hasRole(user, ROLES.TECHNICAL_SUPPORT)) {
    throw httpError(403, 'Only technical support staff can reserve equipment', 'FORBIDDEN');
  }

  const request = await fetchOne(supabase.from('equipment_requests').select('*').eq('id', id));
  if (!request) throw httpError(404, 'Equipment request not found', 'NOT_FOUND');

  const status = decision.approve ? 'RESERVED' : 'UNAVAILABLE';
  const updated = await updateById('equipment_requests', id, {
    status,
    decided_by: user.id,
    decision_reason: decision.reason || null,
    decided_at: new Date().toISOString(),
  });

  if (decision.approve && request.equipment_id) {
    await insertOne('equipment_reservations', {
      event_id: request.event_id,
      equipment_id: request.equipment_id,
      quantity: request.quantity,
      status: 'RESERVED',
    });
  }

  const event = await fetchOne(supabase.from('events').select('*').eq('id', request.event_id));
  if (event?.coordinator_id) {
    await notifyUser(
      event.coordinator_id,
      'EQUIPMENT_DECISION',
      `Equipment ${status.toLowerCase()}`,
      decision.reason || `An equipment request for ${event.name} is ${status.toLowerCase()}.`,
      event.id
    );
  }

  return updated;
}

module.exports = {
  listEquipment,
  upsertEquipment,
  listRequests,
  createRequest,
  decideRequest,
};

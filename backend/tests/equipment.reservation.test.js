/**
 * SCRUM-8: Technical Support reserves available equipment for a specific event.
 *
 *   AC1  Tech can reserve for an event; that writes a reservation row (available qty falls).
 *   AC2  Before confirm, available = operational inventory minus overlapping RESERVED qty;
 *        refuse if the request is larger than that.
 *   AC3  Unauthorised users cannot create or modify reservations.
 */
const request = require('supertest');
const { ROLES } = require('../src/constants/roles');

let mockRoles = [];

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  updateById: jest.fn(),
}));

jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    requireAuth: (req, _res, next) => {
      req.user = { id: 40, isActive: true, roles: mockRoles, role: mockRoles[0] || null };
      next();
    },
  };
});

const { supabase, fetchOne, fetchMany, insertOne, updateById } = require('../src/config/db');
const equipmentService = require('../src/services/equipment.service');
const { createApp } = require('../src/app');

const TECH = { id: 40, roles: [ROLES.TECHNICAL_SUPPORT] };
const COORDINATOR = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const VENUE = { id: 6, roles: [ROLES.VENUE_STAFF] };
const ORGANISER = { id: 1, roles: [ROLES.EVENT_ORGANISER] };
const WINDOW = { from: '2026-11-12T09:00:00.000Z', to: '2026-11-12T17:00:00.000Z' };
const PENDING = {
  id: 20,
  event_id: 8,
  equipment_id: 1,
  quantity: 2,
  status: 'PENDING',
};
const EVENT = {
  id: 8,
  name: 'Acme Forum',
  status: 'PLANNING',
  start_at: WINDOW.from,
  end_at: WINDOW.to,
  coordinator_id: 2,
};
const MIC = {
  id: 1,
  name: 'Wireless handheld mic',
  type: 'AUDIO',
  quantity: 8,
  status: 'AVAILABLE',
};

function overlappingReservation(overrides = {}) {
  return {
    id: 10,
    event_id: 3,
    quantity: 5,
    status: 'RESERVED',
    events: {
      id: 3,
      name: 'Other event',
      status: 'PLANNING',
      start_at: '2026-11-12T10:00:00.000Z',
      end_at: '2026-11-12T16:00:00.000Z',
    },
    ...overrides,
  };
}

function mockChain() {
  supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRoles = [ROLES.TECHNICAL_SUPPORT];
  mockChain();
  updateById.mockImplementation(async (_table, id, patch) => ({ id, ...patch }));
  insertOne.mockImplementation(async (_table, row) => ({ id: 99, ...row }));
});

describe('SCRUM-8 decideRequest (service)', () => {
  /*
   * AC: SCRUM-8 AC1
   * Scenario: Tech reserves two mics for an event when eight are free and none are committed.
   * Setup: PENDING request qty 2, AVAILABLE catalogue 8, no overlapping reservations.
   * Expected: request becomes RESERVED; a reservation row is written for that event, item and qty.
   *          Catalogue quantity is not written down — available falls because of the new row.
   * Type: normal
   */
  it('AC1: Tech can reserve kit for the request event and a reservation row is written', async () => {
    fetchOne
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce(EVENT)
      .mockResolvedValueOnce(MIC);
    fetchMany.mockResolvedValue([]);

    const result = await equipmentService.decideRequest(TECH, 20, { approve: true });

    expect(result.status).toBe('RESERVED');
    expect(updateById).toHaveBeenCalledWith(
      'equipment_requests',
      20,
      expect.objectContaining({ status: 'RESERVED', decided_by: 40 })
    );
    expect(insertOne).toHaveBeenCalledWith(
      'equipment_reservations',
      expect.objectContaining({
        event_id: 8,
        equipment_id: 1,
        quantity: 2,
        status: 'RESERVED',
      })
    );
    expect(updateById.mock.calls.some(([table]) => table === 'equipment')).toBe(false);
  });

  /*
   * AC: SCRUM-8 AC2
   * Scenario: Seven of eight mics are already reserved on an overlapping event; two are requested.
   * Setup: RESERVED qty 7 on another PLANNING event in the same window. Catalogue still 8 AVAILABLE.
   * Expected: 409 INSUFFICIENT_EQUIPMENT. Request and reservations are unchanged.
   * Type: error
   */
  it('AC2: refuses reserve when leftover operational stock is below the request', async () => {
    fetchOne
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce(EVENT)
      .mockResolvedValueOnce(MIC);
    fetchMany.mockResolvedValue([overlappingReservation({ quantity: 7 })]);

    await expect(equipmentService.decideRequest(TECH, 20, { approve: true }))
      .rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_EQUIPMENT' });
    expect(updateById).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-8 AC2
   * Scenario: Requested quantity equals exactly the free operational quantity.
   * Setup: 6 reserved of 8 AVAILABLE; request 2.
   * Expected: reserve succeeds (boundary of AC2).
   * Type: boundary
   */
  it('AC2: reserving exactly the remaining operational quantity is allowed', async () => {
    fetchOne
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce(EVENT)
      .mockResolvedValueOnce(MIC);
    fetchMany.mockResolvedValue([overlappingReservation({ quantity: 6 })]);

    const result = await equipmentService.decideRequest(TECH, 20, { approve: true });
    expect(result.status).toBe('RESERVED');
    expect(insertOne).toHaveBeenCalledWith(
      'equipment_reservations',
      expect.objectContaining({ event_id: 8, quantity: 2 })
    );
  });

  /*
   * AC: SCRUM-8 AC2
   * Scenario: Another reservation ends exactly when this event starts.
   * Setup: Other event ends 09:00; this event starts 09:00. Catalogue 8 AVAILABLE.
   * Expected: not overlapping — reserve succeeds.
   * Type: boundary
   */
  it('AC2: a touching reservation does not block this event', async () => {
    fetchOne
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce(EVENT)
      .mockResolvedValueOnce(MIC);
    fetchMany.mockResolvedValue([
      overlappingReservation({
        events: {
          id: 5,
          name: 'Earlier slot',
          status: 'PLANNING',
          start_at: '2026-11-12T07:00:00.000Z',
          end_at: '2026-11-12T09:00:00.000Z',
        },
      }),
    ]);

    const result = await equipmentService.decideRequest(TECH, 20, { approve: true });
    expect(result.status).toBe('RESERVED');
  });

  /*
   * AC: SCRUM-8 AC2
   * Scenario: Another event reserved all eight mics but that event is cancelled.
   * Setup: RESERVED qty 8 on a CANCELLED event that overlaps this window.
   * Expected: not committed — reserve succeeds (same formula as SCRUM-21).
   * Type: boundary
   */
  it('AC2: a cancelled event reservation does not block this reserve', async () => {
    fetchOne
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce(EVENT)
      .mockResolvedValueOnce(MIC);
    fetchMany.mockResolvedValue([
      overlappingReservation({
        quantity: 8,
        events: { ...overlappingReservation().events, status: 'CANCELLED' },
      }),
    ]);

    const result = await equipmentService.decideRequest(TECH, 20, { approve: true });
    expect(result.status).toBe('RESERVED');
    expect(insertOne).toHaveBeenCalledWith(
      'equipment_reservations',
      expect.objectContaining({ event_id: 8, quantity: 2 })
    );
  });

  /*
   * AC: SCRUM-8 AC2
   * Scenario: The catalogue item is in maintenance, so operational inventory is zero.
   * Setup: status MAINTENANCE, quantity 8, no reservations.
   * Expected: 409. Maintenance stock is not in the operational pool.
   * Type: error
   */
  it('AC2: refuses reserve when the catalogue item is not operational', async () => {
    fetchOne
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce(EVENT)
      .mockResolvedValueOnce({ ...MIC, status: 'MAINTENANCE' });
    fetchMany.mockResolvedValue([]);

    await expect(equipmentService.decideRequest(TECH, 20, { approve: true }))
      .rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_EQUIPMENT' });
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-8 AC2
   * Scenario: Tech marks the request unavailable instead of reserving.
   * Setup: PENDING request; stock would also be short (7 reserved).
   * Expected: request becomes UNAVAILABLE; no reservation row (AC2 is only for confirm).
   * Type: normal
   */
  it('AC2: marking Unavailable is not a reservation and is not blocked by short stock', async () => {
    fetchOne
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce(EVENT);
    fetchMany.mockResolvedValue([overlappingReservation({ quantity: 7 })]);

    const result = await equipmentService.decideRequest(TECH, 20, {
      approve: false,
      reason: 'Insufficient stock',
    });
    expect(result.status).toBe('UNAVAILABLE');
    expect(insertOne.mock.calls.some(([table]) => table === 'equipment_reservations')).toBe(false);
  });

  /*
   * AC: SCRUM-8 AC1, AC2
   * Scenario: The request names no catalogue item, so nothing can be reserved.
   * Setup: equipment_id null, otherwise valid PENDING request.
   * Expected: 400. No reservation.
   * Type: error
   */
  it('AC1/AC2: refuses reserve when the request has no catalogue item', async () => {
    fetchOne
      .mockResolvedValueOnce({ ...PENDING, equipment_id: null })
      .mockResolvedValueOnce(EVENT);

    await expect(equipmentService.decideRequest(TECH, 20, { approve: true }))
      .rejects.toMatchObject({ status: 400 });
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-8 AC2
   * Scenario: The event has no start/end, so overlap cannot be calculated.
   * Setup: Valid PENDING request; event times null.
   * Expected: 400. AC2 cannot be satisfied without a window.
   * Type: error
   */
  it('AC2: refuses reserve when the event has no date and time', async () => {
    fetchOne
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce({ ...EVENT, start_at: null, end_at: null });

    await expect(equipmentService.decideRequest(TECH, 20, { approve: true }))
      .rejects.toMatchObject({ status: 400 });
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-8 AC1
   * Scenario: Tech clicks Reserve again on a request that is already reserved.
   * Setup: request status RESERVED.
   * Expected: 409 ALREADY_DECIDED. No second reservation row (would over-commit).
   * Type: conflict
   */
  it('AC1: refuses a second reserve on an already decided request', async () => {
    fetchOne.mockResolvedValue({ ...PENDING, status: 'RESERVED' });

    await expect(equipmentService.decideRequest(TECH, 20, { approve: true }))
      .rejects.toMatchObject({ status: 409, code: 'ALREADY_DECIDED' });
    expect(insertOne).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-8 AC1
   * Scenario: Unknown request id.
   * Setup: fetchOne null.
   * Expected: 404.
   * Type: error
   */
  it('AC1: returns 404 when the request is missing', async () => {
    fetchOne.mockResolvedValue(null);
    await expect(equipmentService.decideRequest(TECH, 99, { approve: true }))
      .rejects.toMatchObject({ status: 404 });
  });

  /*
   * AC: SCRUM-8 AC3
   * Scenario: A Coordinator (or Venue / Organiser) tries to reserve.
   * Setup: non-Tech user, valid request id.
   * Expected: 403 before the request row is loaded. That is create and modify.
   * Type: error
   */
  it('AC3: refuses create or modify to anyone who is not Technical Support', async () => {
    await expect(equipmentService.decideRequest(COORDINATOR, 20, { approve: true }))
      .rejects.toMatchObject({ status: 403 });
    await expect(equipmentService.decideRequest(VENUE, 20, { approve: true }))
      .rejects.toMatchObject({ status: 403 });
    await expect(equipmentService.decideRequest(ORGANISER, 20, { approve: false }))
      .rejects.toMatchObject({ status: 403 });
    expect(fetchOne).not.toHaveBeenCalled();
  });
});

describe('SCRUM-8 reservation HTTP', () => {
  const app = createApp();

  /*
   * AC: SCRUM-8 AC1
   * Scenario: Tech POSTs approve on a pending request that can be fulfilled.
   * Setup: Tech session; available catalogue; no overlapping reservations.
   * Expected: 200 and request status RESERVED.
   * Type: normal
   */
  it('AC1: Tech receives 200 when the reservation is confirmed', async () => {
    fetchOne
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce(EVENT)
      .mockResolvedValueOnce(MIC);
    fetchMany.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/equipment/requests/20/decision')
      .send({ approve: true });
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('RESERVED');
  });

  /*
   * AC: SCRUM-8 AC2
   * Scenario: Tech POSTs approve when leftover stock is 1 and the request is 2.
   * Setup: overlapping RESERVED qty 7.
   * Expected: 409 INSUFFICIENT_EQUIPMENT. Body is not a reserved request.
   * Type: error
   */
  it('AC2: Tech receives 409 when the requested quantity exceeds available', async () => {
    fetchOne
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce(EVENT)
      .mockResolvedValueOnce(MIC);
    fetchMany.mockResolvedValue([overlappingReservation({ quantity: 7 })]);

    const res = await request(app)
      .post('/api/equipment/requests/20/decision')
      .send({ approve: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_EQUIPMENT');
    expect(res.body.request).toBeUndefined();
  });

  /*
   * AC: SCRUM-8 AC3
   * Scenario: A Coordinator POSTs the decision route.
   * Setup: Coordinator session.
   * Expected: 403. No reservation is created.
   * Type: error
   */
  it('AC3: Coordinators receive 403 on the decision route', async () => {
    mockRoles = [ROLES.EVENT_COORDINATOR];
    const res = await request(app)
      .post('/api/equipment/requests/20/decision')
      .send({ approve: true });
    expect(res.status).toBe(403);
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-8 AC1, AC2
   * Scenario: Tech POSTs approve on a request with no catalogue item.
   * Setup: equipment_id null.
   * Expected: 400. No reservation body.
   * Type: error
   */
  it('AC1/AC2: missing catalogue item returns 400', async () => {
    fetchOne
      .mockResolvedValueOnce({ ...PENDING, equipment_id: null })
      .mockResolvedValueOnce(EVENT);
    const res = await request(app)
      .post('/api/equipment/requests/20/decision')
      .send({ approve: true });
    expect(res.status).toBe(400);
    expect(res.body.request).toBeUndefined();
  });

  /*
   * AC: SCRUM-8 AC2
   * Scenario: Tech POSTs approve when the event has no date/time.
   * Setup: event start/end null.
   * Expected: 400.
   * Type: error
   */
  it('AC2: missing event times return 400', async () => {
    fetchOne
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce({ ...EVENT, start_at: null, end_at: null });
    const res = await request(app)
      .post('/api/equipment/requests/20/decision')
      .send({ approve: true });
    expect(res.status).toBe(400);
  });

  /*
   * AC: SCRUM-8 AC1
   * Scenario: Tech POSTs approve for an id that is not a request.
   * Setup: fetchOne null.
   * Expected: 404.
   * Type: error
   */
  it('AC1: unknown request returns 404', async () => {
    fetchOne.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/equipment/requests/99/decision')
      .send({ approve: true });
    expect(res.status).toBe(404);
  });

  /*
   * AC: SCRUM-8 AC1
   * Scenario: Tech POSTs approve on a request that is already reserved.
   * Setup: request status RESERVED.
   * Expected: 409 ALREADY_DECIDED.
   * Type: conflict
   */
  it('AC1: already decided request returns 409', async () => {
    fetchOne.mockResolvedValue({ ...PENDING, status: 'RESERVED' });
    const res = await request(app)
      .post('/api/equipment/requests/20/decision')
      .send({ approve: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_DECIDED');
  });
});

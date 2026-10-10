/**
 * SCRUM-21: Equipment availability checking for Technical Support.
 *
 *   AC1  Check uses catalogue item (type), quantity, date and time.
 *   AC2  Only currently available catalogue stock is in the pool.
 *   AC3  Reserved qty on overlapping active events is committed and excluded.
 *   AC4  Compare free qty to the requested qty.
 *   AC5  Indicate when enough suitable kit is free.
 *   AC6  Indicate when it is insufficient or the item is unavailable.
 *   AC7  Tech can run the same check from an existing request.
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

const { supabase, fetchOne, fetchMany } = require('../src/config/db');
const equipmentService = require('../src/services/equipment.service');
const { createApp } = require('../src/app');

const TECH = { id: 40, roles: [ROLES.TECHNICAL_SUPPORT] };
const COORDINATOR = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const WINDOW = { from: '2026-11-12T09:00:00.000Z', to: '2026-11-12T17:00:00.000Z' };
const MIC = {
  id: 1,
  name: 'Wireless handheld mic',
  type: 'AUDIO',
  quantity: 8,
  status: 'AVAILABLE',
};

function reservation(overrides = {}) {
  return {
    id: 10,
    event_id: 3,
    quantity: 5,
    status: 'RESERVED',
    events: {
      id: 3,
      name: 'Acme Forum',
      status: 'PLANNING',
      start_at: '2026-11-12T10:00:00.000Z',
      end_at: '2026-11-12T16:00:00.000Z',
    },
    ...overrides,
  };
}

function mockQuery() {
  supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
  });
}

async function check(query = {}) {
  return equipmentService.checkEquipmentAvailability(TECH, {
    equipmentId: 1,
    quantity: 2,
    ...WINDOW,
    ...query,
  });
}

let chain;
beforeEach(() => {
  jest.clearAllMocks();
  mockRoles = [ROLES.TECHNICAL_SUPPORT];
  chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
  };
  supabase.from.mockReturnValue(chain);
});

describe('SCRUM-21 checkEquipmentAvailability (service)', () => {
  /*
   * AC: SCRUM-21 AC1, AC2, AC4, AC5
   * Scenario: Tech checks two mics for a day when the catalogue has eight available and none reserved.
   * Setup: AVAILABLE AUDIO item qty 8; no reservations. Window is the event day.
   * Expected: sufficient, indication SUFFICIENT, availableQuantity 8, type AUDIO on the result.
   * Type: normal
   */
  it('AC1/AC5: enough unused available stock is sufficient and names the type', async () => {
    fetchOne.mockResolvedValue(MIC);
    fetchMany.mockResolvedValue([]);
    const result = await check();
    expect(result.sufficient).toBe(true);
    expect(result.indication).toBe('SUFFICIENT');
    expect(result.availableQuantity).toBe(8);
    expect(result.requestedQuantity).toBe(2);
    expect(result.equipment.type).toBe('AUDIO');
    expect(result.from).toBe(WINDOW.from);
    expect(result.to).toBe(WINDOW.to);
  });

  /*
   * AC: SCRUM-21 AC3, AC4, AC5
   * Scenario: Five of eight mics are reserved for another overlapping event; two are requested.
   * Setup: One RESERVED row qty 5 on a PLANNING event that overlaps the window.
   * Expected: committed 5, available 3, still sufficient for 2.
   * Type: normal
   */
  it('AC3/AC5: overlapping reservations are excluded and leftover stock can still be enough', async () => {
    fetchOne.mockResolvedValue(MIC);
    fetchMany.mockResolvedValue([reservation()]);
    const result = await check();
    expect(result.committedQuantity).toBe(5);
    expect(result.availableQuantity).toBe(3);
    expect(result.sufficient).toBe(true);
    expect(result.committed[0]).toMatchObject({ eventId: 3, eventName: 'Acme Forum', quantity: 5 });
  });

  /*
   * AC: SCRUM-21 AC3
   * Scenario: A rejected event still has a leftover reservation row.
   * Setup: RESERVED qty 8 but event status REJECTED.
   * Expected: not committed — rejected events do not hold kit.
   * Type: boundary
   */
  it('AC3: rejected events do not keep equipment committed', async () => {
    fetchOne.mockResolvedValue(MIC);
    fetchMany.mockResolvedValue([
      reservation({ events: { ...reservation().events, status: 'REJECTED' } }),
    ]);
    const result = await check();
    expect(result.committedQuantity).toBe(0);
    expect(result.availableQuantity).toBe(8);
  });

  /*
   * AC: SCRUM-21 AC4, AC6
   * Scenario: Overlapping reservations exceed the catalogue quantity.
   * Setup: RESERVED qty 10 on an 8-item AVAILABLE catalogue.
   * Expected: available 0 (never negative), insufficient.
   * Type: boundary
   */
  it('AC4: committed quantity above catalogue stock still reports zero free', async () => {
    fetchOne.mockResolvedValue(MIC);
    fetchMany.mockResolvedValue([reservation({ quantity: 10 })]);
    const result = await check();
    expect(result.availableQuantity).toBe(0);
    expect(result.sufficient).toBe(false);
  });

  /*
   * AC: SCRUM-21 AC3, AC4, AC6
   * Scenario: Seven mics are already reserved in the same window; two are requested.
   * Setup: RESERVED qty 7 overlapping. Catalogue still 8 AVAILABLE.
   * Expected: available 1, insufficient.
   * Type: boundary
   */
  it('AC4/AC6: leftover stock below the requested quantity is insufficient', async () => {
    fetchOne.mockResolvedValue(MIC);
    fetchMany.mockResolvedValue([reservation({ quantity: 7 })]);
    const result = await check();
    expect(result.availableQuantity).toBe(1);
    expect(result.sufficient).toBe(false);
    expect(result.indication).toBe('INSUFFICIENT');
  });

  /*
   * AC: SCRUM-21 AC4, AC5
   * Scenario: Requested quantity equals exactly the free quantity.
   * Setup: 6 reserved of 8; request 2.
   * Expected: available 2, sufficient (boundary of AC4).
   * Type: boundary
   */
  it('AC4: requesting exactly the remaining quantity is sufficient', async () => {
    fetchOne.mockResolvedValue(MIC);
    fetchMany.mockResolvedValue([reservation({ quantity: 6 })]);
    const result = await check();
    expect(result.availableQuantity).toBe(2);
    expect(result.sufficient).toBe(true);
  });

  /*
   * AC: SCRUM-21 AC2, AC6
   * Scenario: The catalogue item is in maintenance, so none of it is currently available.
   * Setup: status MAINTENANCE, quantity 8, no reservations.
   * Expected: available 0, indication UNAVAILABLE, not sufficient.
   * Type: error
   */
  it('AC2/AC6: maintenance stock is not treated as available', async () => {
    fetchOne.mockResolvedValue({ ...MIC, status: 'MAINTENANCE' });
    fetchMany.mockResolvedValue([]);
    const result = await check();
    expect(result.availableQuantity).toBe(0);
    expect(result.sufficient).toBe(false);
    expect(result.indication).toBe('UNAVAILABLE');
  });

  /*
   * AC: SCRUM-21 AC2, AC6
   * Scenario: The catalogue item is damaged, so none of it is currently available.
   * Setup: status DAMAGED, quantity 8, no reservations.
   * Expected: available 0, indication UNAVAILABLE, not sufficient.
   * Type: error
   */
  it('AC2/AC6: damaged stock is not treated as available', async () => {
    fetchOne.mockResolvedValue({ ...MIC, status: 'DAMAGED' });
    fetchMany.mockResolvedValue([]);
    const result = await check();
    expect(result.availableQuantity).toBe(0);
    expect(result.sufficient).toBe(false);
    expect(result.indication).toBe('UNAVAILABLE');
  });

  /*
   * AC: SCRUM-21 AC2, AC6
   * Scenario: The catalogue row itself is marked RESERVED (not in the available pool).
   * Setup: status RESERVED, quantity 8, no reservation rows.
   * Expected: available 0, indication UNAVAILABLE — only AVAILABLE catalogue stock is in the pool.
   * Type: error
   */
  it('AC2/AC6: catalogue status RESERVED is not treated as available', async () => {
    fetchOne.mockResolvedValue({ ...MIC, status: 'RESERVED' });
    fetchMany.mockResolvedValue([]);
    const result = await check();
    expect(result.availableQuantity).toBe(0);
    expect(result.sufficient).toBe(false);
    expect(result.indication).toBe('UNAVAILABLE');
  });

  /*
   * AC: SCRUM-21 AC3
   * Scenario: A reservation exists for a cancelled event that used to overlap.
   * Setup: RESERVED qty 8 but event status CANCELLED.
   * Expected: committed 0 — cancelled events must not keep holding kit.
   * Type: boundary
   */
  it('AC3: cancelled events do not keep equipment committed', async () => {
    fetchOne.mockResolvedValue(MIC);
    fetchMany.mockResolvedValue([
      reservation({ events: { ...reservation().events, status: 'CANCELLED' } }),
    ]);
    const result = await check();
    expect(result.committedQuantity).toBe(0);
    expect(result.availableQuantity).toBe(8);
    expect(result.sufficient).toBe(true);
  });

  /*
   * AC: SCRUM-21 AC3
   * Scenario: A reservation overlaps in item but not in time.
   * Setup: Other event 09:00–10:00 the day before the requested 09:00–17:00 window on 12 Nov.
   * Expected: not committed; full stock remains available.
   * Type: boundary
   */
  it('AC3: a reservation that does not overlap the requested time stays available', async () => {
    fetchOne.mockResolvedValue(MIC);
    fetchMany.mockResolvedValue([
      reservation({
        events: {
          id: 4,
          name: 'Morning briefing',
          status: 'CONFIRMED',
          start_at: '2026-11-11T09:00:00.000Z',
          end_at: '2026-11-11T10:00:00.000Z',
        },
      }),
    ]);
    const result = await check();
    expect(result.committedQuantity).toBe(0);
    expect(result.availableQuantity).toBe(8);
  });

  /*
   * AC: SCRUM-21 AC3
   * Scenario: The other event ends exactly when this window starts.
   * Setup: Other event ends 09:00; requested window starts 09:00.
   * Expected: not incompatible — touching ends do not overlap.
   * Type: boundary
   */
  it('AC3: touching windows are not treated as incompatible', async () => {
    fetchOne.mockResolvedValue(MIC);
    fetchMany.mockResolvedValue([
      reservation({
        events: {
          id: 5,
          name: 'Earlier slot',
          status: 'PLANNING',
          start_at: '2026-11-12T07:00:00.000Z',
          end_at: '2026-11-12T09:00:00.000Z',
        },
      }),
    ]);
    const result = await check();
    expect(result.committedQuantity).toBe(0);
  });

  /*
   * AC: SCRUM-21 AC3
   * Scenario: This event already has a reservation (updating an arrangement).
   * Setup: excludeEventId 3; the only reservation belongs to event 3.
   * Expected: own reservation is not counted as “another” event.
   * Type: boundary
   */
  it('AC3: a reservation on the same event is not treated as another commitment', async () => {
    fetchOne.mockResolvedValue(MIC);
    fetchMany.mockResolvedValue([reservation()]);
    const result = await check({ excludeEventId: 3 });
    expect(result.committedQuantity).toBe(0);
    expect(result.availableQuantity).toBe(8);
  });

  /*
   * AC: SCRUM-21 AC3
   * Scenario: A reservation has no event times, so overlap cannot be proven.
   * Setup: events.start_at and end_at missing.
   * Expected: not committed (cannot mark incompatible without a window).
   * Type: boundary
   */
  it('AC3: a reservation without event times is not treated as committed', async () => {
    fetchOne.mockResolvedValue(MIC);
    fetchMany.mockResolvedValue([
      reservation({ events: { id: 9, name: 'No times', status: 'PLANNING', start_at: null, end_at: null } }),
    ]);
    const result = await check();
    expect(result.committedQuantity).toBe(0);
  });

  /*
   * AC: SCRUM-21 AC1
   * Scenario: Tech is the only role that may run the check.
   * Setup: Coordinator user, valid query.
   * Expected: 403; catalogue is not read.
   * Type: error
   */
  it('AC1: refuses the check to a Coordinator', async () => {
    await expect(
      equipmentService.checkEquipmentAvailability(COORDINATOR, { equipmentId: 1, quantity: 2, ...WINDOW })
    ).rejects.toMatchObject({ status: 403 });
    expect(fetchOne).not.toHaveBeenCalled();
  });

  /*
   * AC: SCRUM-21 AC1
   * Scenario: Required inputs are missing or illegal.
   * Setup: each call omits or breaks one AC1 field (equipmentId, quantity, from/to).
   * Expected: 400 for each.
   * Type: error
   */
  it('AC1: refuses a check that is missing equipmentId, quantity, or a valid window', async () => {
    await expect(equipmentService.checkEquipmentAvailability(TECH, { quantity: 2, ...WINDOW }))
      .rejects.toMatchObject({ status: 400 });
    await expect(equipmentService.checkEquipmentAvailability(TECH, { equipmentId: 1, quantity: 0, ...WINDOW }))
      .rejects.toMatchObject({ status: 400 });
    await expect(equipmentService.checkEquipmentAvailability(TECH, { equipmentId: 1, quantity: 2 }))
      .rejects.toMatchObject({ status: 400 });
    await expect(equipmentService.checkEquipmentAvailability(TECH, {
      equipmentId: 1, quantity: 2, from: 'not-a-date', to: WINDOW.to,
    })).rejects.toMatchObject({ status: 400 });
    await expect(equipmentService.checkEquipmentAvailability(TECH, {
      equipmentId: 1, quantity: 2, from: WINDOW.to, to: WINDOW.from,
    })).rejects.toMatchObject({ status: 400 });
  });

  /*
   * AC: SCRUM-21 AC1
   * Scenario: Catalogue id does not exist.
   * Setup: fetchOne returns null.
   * Expected: 404.
   * Type: error
   */
  it('AC1: returns 404 when the catalogue item is missing', async () => {
    fetchOne.mockResolvedValue(null);
    await expect(check()).rejects.toMatchObject({ status: 404 });
  });
});

describe('SCRUM-21 checkRequestAvailability (service)', () => {
  /*
   * AC: SCRUM-21 AC1, AC7
   * Scenario: Tech opens a pending request and checks it using the event's date/time and qty.
   * Setup: Request qty 2 for item 1; event 12 Nov 09:00–17:00; no other reservations.
   * Expected: same sufficient result, with requestId and eventId attached.
   * Type: normal
   */
  it('AC7: checks a request using its quantity and the event date/time', async () => {
    fetchOne
      .mockResolvedValueOnce({ id: 20, event_id: 8, equipment_id: 1, quantity: 2 })
      .mockResolvedValueOnce({ id: 8, start_at: WINDOW.from, end_at: WINDOW.to, status: 'PLANNING' })
      .mockResolvedValueOnce(MIC);
    fetchMany.mockResolvedValue([]);
    const result = await equipmentService.checkRequestAvailability(TECH, 20);
    expect(result.requestId).toBe(20);
    expect(result.eventId).toBe(8);
    expect(result.sufficient).toBe(true);
    expect(result.requestedQuantity).toBe(2);
  });

  /*
   * AC: SCRUM-21 AC7
   * Scenario: Request names no catalogue item, so suitability cannot be checked.
   * Setup: equipment_id null.
   * Expected: 400.
   * Type: error
   */
  it('AC7: refuses a request that has no catalogue item', async () => {
    fetchOne.mockResolvedValue({ id: 21, event_id: 8, equipment_id: null, quantity: 2 });
    await expect(equipmentService.checkRequestAvailability(TECH, 21))
      .rejects.toMatchObject({ status: 400 });
  });

  /*
   * AC: SCRUM-21 AC1, AC7
   * Scenario: The event has no start/end, so there is no required date/time.
   * Setup: Valid request; event times null.
   * Expected: 400.
   * Type: error
   */
  it('AC1/AC7: refuses a request whose event has no date and time', async () => {
    fetchOne
      .mockResolvedValueOnce({ id: 22, event_id: 8, equipment_id: 1, quantity: 2 })
      .mockResolvedValueOnce({ id: 8, start_at: null, end_at: null, status: 'PLANNING' });
    await expect(equipmentService.checkRequestAvailability(TECH, 22))
      .rejects.toMatchObject({ status: 400 });
  });

  /*
   * AC: SCRUM-21 AC7
   * Scenario: Unknown request id.
   * Setup: fetchOne null.
   * Expected: 404.
   * Type: error
   */
  it('AC7: returns 404 when the request is missing', async () => {
    fetchOne.mockResolvedValue(null);
    await expect(equipmentService.checkRequestAvailability(TECH, 99))
      .rejects.toMatchObject({ status: 404 });
  });

  /*
   * AC: SCRUM-21 AC7
   * Scenario: A Coordinator asks for a request-level check.
   * Setup: Coordinator user; request id 20.
   * Expected: 403 before the request row is loaded.
   * Type: error
   */
  it('AC7: refuses the request-level check to a Coordinator', async () => {
    await expect(equipmentService.checkRequestAvailability(COORDINATOR, 20))
      .rejects.toMatchObject({ status: 403 });
    expect(fetchOne).not.toHaveBeenCalled();
  });
});

describe('SCRUM-21 availability HTTP', () => {
  const app = createApp();

  /*
   * AC: SCRUM-21 AC5, AC7
   * Scenario: Tech GETs availability for a request over HTTP.
   * Setup: Tech session; request + event + available catalogue; no reservations.
   * Expected: 200 with sufficient true.
   * Type: normal
   */
  it('AC7: Tech receives 200 and a sufficient indication for a request', async () => {
    mockQuery();
    fetchOne
      .mockResolvedValueOnce({ id: 20, event_id: 8, equipment_id: 1, quantity: 2 })
      .mockResolvedValueOnce({ id: 8, start_at: WINDOW.from, end_at: WINDOW.to, status: 'PLANNING' })
      .mockResolvedValueOnce(MIC);
    fetchMany.mockResolvedValue([]);
    const res = await request(app).get('/api/equipment/requests/20/availability');
    expect(res.status).toBe(200);
    expect(res.body.sufficient).toBe(true);
    expect(res.body.indication).toBe('SUFFICIENT');
  });

  /*
   * AC: SCRUM-21 AC1
   * Scenario: Tech GETs an ad-hoc check with item, quantity and window.
   * Setup: Query string; available catalogue; no reservations.
   * Expected: 200 sufficient.
   * Type: normal
   */
  it('AC1: Tech can check availability with type, quantity, date and time', async () => {
    mockQuery();
    fetchOne.mockResolvedValue(MIC);
    fetchMany.mockResolvedValue([]);
    const res = await request(app).get('/api/equipment/availability')
      .query({ equipmentId: 1, quantity: 2, from: WINDOW.from, to: WINDOW.to });
    expect(res.status).toBe(200);
    expect(res.body.sufficient).toBe(true);
    expect(res.body.equipment.type).toBe('AUDIO');
  });

  /*
   * AC: SCRUM-21 AC1
   * Scenario: A Coordinator calls the availability route.
   * Setup: Coordinator session.
   * Expected: 403, no sufficient flag leaked as a success body.
   * Type: error
   */
  it('AC1: Coordinators receive 403 on the availability routes', async () => {
    mockRoles = [ROLES.EVENT_COORDINATOR];
    const adHoc = await request(app).get('/api/equipment/availability')
      .query({ equipmentId: 1, quantity: 2, from: WINDOW.from, to: WINDOW.to });
    expect(adHoc.status).toBe(403);
    const byRequest = await request(app).get('/api/equipment/requests/20/availability');
    expect(byRequest.status).toBe(403);
  });

  /*
   * AC: SCRUM-21 AC1
   * Scenario: Tech calls the ad-hoc route without equipmentId.
   * Setup: quantity and window only.
   * Expected: 400.
   * Type: error
   */
  it('AC1: missing query fields return 400', async () => {
    mockQuery();
    const res = await request(app).get('/api/equipment/availability')
      .query({ quantity: 2, from: WINDOW.from, to: WINDOW.to });
    expect(res.status).toBe(400);
  });

  /*
   * AC: SCRUM-21 AC1
   * Scenario: Tech checks an id that is not in the catalogue.
   * Setup: fetchOne returns null.
   * Expected: 404.
   * Type: error
   */
  it('AC1: unknown catalogue item returns 404', async () => {
    mockQuery();
    fetchOne.mockResolvedValue(null);
    const res = await request(app).get('/api/equipment/availability')
      .query({ equipmentId: 99, quantity: 2, from: WINDOW.from, to: WINDOW.to });
    expect(res.status).toBe(404);
  });
});

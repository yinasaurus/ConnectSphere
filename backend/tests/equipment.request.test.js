/**
 * SCRUM-47: Create Equipment Request
 *
 * As an Event Coordinator, I want to record the equipment required for my event
 * so that Technical Support Staff know what equipment needs to be prepared.
 *
 * Acceptance Criteria:
 *   AC1: Event Coordinator can create an equipment request for an event.
 *   AC2: Request records equipment type and quantity required.
 *   AC3: Request records technical requirements or specifications.
 *   AC4: Request is associated with the relevant event, date, and time.
 */

const request = require('supertest');
const { ROLES } = require('../src/constants/roles');
const { EVENT_STATUS } = require('../src/constants/statuses');

let mockRoles = [ROLES.EVENT_COORDINATOR];

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
      req.user = { id: 2, isActive: true, roles: mockRoles, role: mockRoles[0] || null };
      next();
    },
  };
});

const { supabase, fetchOne, fetchMany, insertOne } = require('../src/config/db');
const { createApp } = require('../src/app');

const EVENT_WINDOW = {
  start_at: '2026-11-12T09:00:00.000Z',
  end_at: '2026-11-12T17:00:00.000Z',
};

const SAMPLE_EVENT = {
  id: 8,
  name: 'Acme Leadership Summit',
  status: EVENT_STATUS.PLANNING,
  ...EVENT_WINDOW,
  coordinator_id: 2,
};

const SAMPLE_MIC = {
  id: 1,
  name: 'Wireless handheld mic',
  type: 'AUDIO',
  description: 'Shure handheld microphone',
  quantity: 8,
  status: 'AVAILABLE',
};

function mockChain() {
  supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  });
}

describe('SCRUM-47 Create Equipment Request', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    mockRoles = [ROLES.EVENT_COORDINATOR];
    mockChain();
    insertOne.mockImplementation(async (_table, row) => ({ id: 50, ...row }));
  });

  /*
   * AC: AC1 (Coordinator permission)
   * Scenario: Event Coordinator creates an equipment request for an event.
   * Expected: 201 Created with PENDING status, associated with event and user.
   */
  it('AC1: allows Event Coordinator to create an equipment request', async () => {
    fetchOne
      .mockResolvedValueOnce(SAMPLE_EVENT) // find event
      .mockResolvedValueOnce(SAMPLE_MIC); // find equipment

    const res = await request(app)
      .post('/api/equipment/requests')
      .send({
        eventId: 8,
        equipmentId: 1,
        quantity: 2,
        technicalRequirements: '2 UHF channels, cardioid capsules, extra battery pack',
      });

    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({
      id: 50,
      event_id: 8,
      equipment_id: 1,
      equipment_type: 'AUDIO',
      quantity: 2,
      technical_requirements: '2 UHF channels, cardioid capsules, extra battery pack',
      status: 'PENDING',
      requested_by: 2,
    });
    expect(insertOne).toHaveBeenCalledWith(
      'equipment_requests',
      expect.objectContaining({
        event_id: 8,
        equipment_id: 1,
        equipment_type: 'AUDIO',
        quantity: 2,
        status: 'PENDING',
        requested_by: 2,
      })
    );
  });

  /*
   * AC: AC1 (Role boundary)
   * Scenario: Non-coordinators attempt to create an equipment request.
   * Expected: 403 Forbidden.
   */
  it.each([
    ['Event Organiser', [ROLES.EVENT_ORGANISER]],
    ['Venue Staff', [ROLES.VENUE_STAFF]],
    ['Technical Support', [ROLES.TECHNICAL_SUPPORT]],
    ['Safety Officer', [ROLES.SAFETY_OFFICER]],
    ['Attendee', [ROLES.ATTENDEE]],
  ])('AC1: refuses %s from creating an equipment request (403)', async (_name, roles) => {
    mockRoles = roles;
    const res = await request(app)
      .post('/api/equipment/requests')
      .send({
        eventId: 8,
        equipmentType: 'AUDIO',
        quantity: 1,
      });

    expect(res.status).toBe(403);
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC: AC1 (Event validation)
   * Scenario: Coordinator requests equipment for missing event or cancelled event.
   * Expected: 404 for missing event, 400 for cancelled/rejected event.
   */
  it('AC1: refuses request when eventId is missing or event does not exist (400/404)', async () => {
    const resMissing = await request(app)
      .post('/api/equipment/requests')
      .send({ equipmentType: 'AUDIO', quantity: 1 });
    expect(resMissing.status).toBe(400);

    fetchOne.mockResolvedValueOnce(null);
    const resNotFound = await request(app)
      .post('/api/equipment/requests')
      .send({ eventId: 999, equipmentType: 'AUDIO', quantity: 1 });
    expect(resNotFound.status).toBe(404);
  });

  it('AC1: refuses request for cancelled or rejected event (400)', async () => {
    fetchOne.mockResolvedValueOnce({ ...SAMPLE_EVENT, status: EVENT_STATUS.CANCELLED });
    const res = await request(app)
      .post('/api/equipment/requests')
      .send({ eventId: 8, equipmentType: 'AUDIO', quantity: 1 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cancelled or rejected/i);
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC: AC2 (Equipment type and quantity required)
   * Scenario: Request records equipment type and quantity required.
   * Expected: Equipment type and quantity are properly validated and recorded.
   */
  it('AC2: records equipment type directly when no catalogue item is specified', async () => {
    fetchOne.mockResolvedValueOnce(SAMPLE_EVENT);

    const res = await request(app)
      .post('/api/equipment/requests')
      .send({
        eventId: 8,
        equipmentType: 'PROJECTION',
        quantity: 3,
        technicalRequirements: 'High lumen laser projector for wide screen',
      });

    expect(res.status).toBe(201);
    expect(res.body.request.equipment_type).toBe('PROJECTION');
    expect(res.body.request.equipment_id).toBeNull();
    expect(res.body.request.quantity).toBe(3);
  });

  it('AC2: derives equipment type from catalogue item if not explicitly passed', async () => {
    fetchOne
      .mockResolvedValueOnce(SAMPLE_EVENT)
      .mockResolvedValueOnce(SAMPLE_MIC);

    const res = await request(app)
      .post('/api/equipment/requests')
      .send({
        eventId: 8,
        equipmentId: 1,
        quantity: 4,
      });

    expect(res.status).toBe(201);
    expect(res.body.request.equipment_type).toBe('AUDIO');
    expect(res.body.request.quantity).toBe(4);
  });

  it('AC2: rejects invalid quantity (< 1 or non-integer)', async () => {
    fetchOne.mockResolvedValue(SAMPLE_EVENT);

    const resZero = await request(app)
      .post('/api/equipment/requests')
      .send({ eventId: 8, equipmentType: 'AUDIO', quantity: 0 });
    expect(resZero.status).toBe(400);

    const resNegative = await request(app)
      .post('/api/equipment/requests')
      .send({ eventId: 8, equipmentType: 'AUDIO', quantity: -2 });
    expect(resNegative.status).toBe(400);

    const resString = await request(app)
      .post('/api/equipment/requests')
      .send({ eventId: 8, equipmentType: 'AUDIO', quantity: 'abc' });
    expect(resString.status).toBe(400);
  });

  it('AC2: rejects when neither equipmentType nor equipmentId is provided', async () => {
    fetchOne.mockResolvedValueOnce(SAMPLE_EVENT);

    const res = await request(app)
      .post('/api/equipment/requests')
      .send({ eventId: 8, quantity: 2 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/equipment type or catalogue item/i);
  });

  it('AC2: rejects when equipmentId does not exist in catalogue (404)', async () => {
    fetchOne
      .mockResolvedValueOnce(SAMPLE_EVENT)
      .mockResolvedValueOnce(null); // equipment not found

    const res = await request(app)
      .post('/api/equipment/requests')
      .send({ eventId: 8, equipmentId: 999, quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/equipment not found/i);
  });

  /*
   * AC2: quantity must not exceed the catalogue item's total stock.
   * Scenario: SAMPLE_MIC has quantity 8; coordinator requests 10.
   * Expected: 400 with a message referencing the item name and stock.
   */
  it('AC2: rejects quantity that exceeds the catalogue stock of the selected item', async () => {
    fetchOne
      .mockResolvedValueOnce(SAMPLE_EVENT)
      .mockResolvedValueOnce(SAMPLE_MIC); // stock = 8

    const res = await request(app)
      .post('/api/equipment/requests')
      .send({ eventId: 8, equipmentId: 1, quantity: 10 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exceeds the catalogue stock for Wireless handheld mic/i);
  });

  /*
   * AC: AC3 (Technical requirements or specifications)
   * Scenario: Coordinator specifies technical requirements and specifications.
   * Expected: Recorded accurately in technical_requirements and notes.
   */
  it('AC3: records technical requirements / specifications', async () => {
    fetchOne.mockResolvedValueOnce(SAMPLE_EVENT);

    const specs = 'Requires 2x XLR outputs, balanced feed to PA, 48V phantom power';
    const res = await request(app)
      .post('/api/equipment/requests')
      .send({
        eventId: 8,
        equipmentType: 'AUDIO',
        quantity: 1,
        technicalRequirements: specs,
      });

    expect(res.status).toBe(201);
    expect(res.body.request.technical_requirements).toBe(specs);
    expect(insertOne).toHaveBeenCalledWith(
      'equipment_requests',
      expect.objectContaining({
        technical_requirements: specs,
        notes: specs,
      })
    );
  });

  it('AC3: accepts specifications or notes alias for technical requirements', async () => {
    fetchOne.mockResolvedValueOnce(SAMPLE_EVENT);

    const specs = 'HDMI 2.1 cable, 4K 60Hz compatible, minimum 10m length';
    const res = await request(app)
      .post('/api/equipment/requests')
      .send({
        eventId: 8,
        equipmentType: 'VIDEO',
        quantity: 2,
        specifications: specs,
      });

    expect(res.status).toBe(201);
    expect(res.body.request.technical_requirements).toBe(specs);
  });

  /*
   * AC: AC4 (Associated with relevant event, date, and time)
   * Scenario: Equipment request records and associates with the event date/time.
   * Expected: Defaults to event start_at and end_at if not custom-specified,
   *           or accepts explicit window and validates start before end.
   */
  it('AC4: associates request with the event start_at and end_at by default', async () => {
    fetchOne.mockResolvedValueOnce(SAMPLE_EVENT);

    const res = await request(app)
      .post('/api/equipment/requests')
      .send({
        eventId: 8,
        equipmentType: 'LIGHTING',
        quantity: 2,
      });

    expect(res.status).toBe(201);
    expect(res.body.request.event_id).toBe(8);
    expect(res.body.request.start_at).toBe(EVENT_WINDOW.start_at);
    expect(res.body.request.end_at).toBe(EVENT_WINDOW.end_at);
  });

  /*
   * AC4: custom timing window must sit inside the event window.
   * Scenario: Coordinator supplies a window fully inside the event (09:00–17:00 UTC).
   * Expected: 201 with the requested times stored.
   */
  it('AC4: supports custom equipment start and end timing within the event window', async () => {
    fetchOne.mockResolvedValueOnce(SAMPLE_EVENT);

    const customWindow = {
      startAt: '2026-11-12T10:00:00.000Z', // inside event: 10:00 – 12:00 UTC
      endAt: '2026-11-12T12:00:00.000Z',
    };

    const res = await request(app)
      .post('/api/equipment/requests')
      .send({
        eventId: 8,
        equipmentType: 'AUDIO',
        quantity: 1,
        ...customWindow,
      });

    expect(res.status).toBe(201);
    expect(res.body.request.start_at).toBe(customWindow.startAt);
    expect(res.body.request.end_at).toBe(customWindow.endAt);
  });

  /*
   * AC4: timing window must not start before the event starts.
   * Scenario: startAt is 08:00 UTC, before event start (09:00 UTC).
   * Expected: 400 VALIDATION_ERROR.
   */
  it('AC4: rejects startAt before the event start', async () => {
    fetchOne.mockResolvedValueOnce(SAMPLE_EVENT);

    const res = await request(app)
      .post('/api/equipment/requests')
      .send({
        eventId: 8,
        equipmentType: 'AUDIO',
        quantity: 1,
        startAt: '2026-11-12T08:00:00.000Z', // before event start 09:00 UTC
        endAt: '2026-11-12T12:00:00.000Z',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Required from cannot be before the event starts/i);
  });

  /*
   * AC4: timing window must not end after the event ends.
   * Scenario: endAt is 18:00 UTC, after event end (17:00 UTC).
   * Expected: 400 VALIDATION_ERROR.
   */
  it('AC4: rejects endAt after the event end', async () => {
    fetchOne.mockResolvedValueOnce(SAMPLE_EVENT);

    const res = await request(app)
      .post('/api/equipment/requests')
      .send({
        eventId: 8,
        equipmentType: 'AUDIO',
        quantity: 1,
        startAt: '2026-11-12T10:00:00.000Z',
        endAt: '2026-11-12T18:00:00.000Z', // after event end 17:00 UTC
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Required until cannot be after the event ends/i);
  });

  it('AC4: rejects invalid custom window where start is not before end', async () => {
    fetchOne.mockResolvedValueOnce(SAMPLE_EVENT);

    const res = await request(app)
      .post('/api/equipment/requests')
      .send({
        eventId: 8,
        equipmentType: 'AUDIO',
        quantity: 1,
        startAt: '2026-11-12T18:00:00.000Z',
        endAt: '2026-11-12T08:00:00.000Z',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/from must be before to/i);
  });

  /*
   * Scope: Event-scoped endpoint POST /api/events/:id/equipment-requests
   */
  it('allows creating equipment request via POST /api/events/:id/equipment-requests', async () => {
    fetchOne
      .mockResolvedValueOnce(SAMPLE_EVENT)
      .mockResolvedValueOnce(SAMPLE_MIC);

    const res = await request(app)
      .post('/api/events/8/equipment-requests')
      .send({
        equipmentId: 1,
        quantity: 2,
        technicalRequirements: 'Stage left and stage right placement',
      });

    expect(res.status).toBe(201);
    expect(res.body.request.event_id).toBe(8);
    expect(res.body.request.equipment_id).toBe(1);
  });

  /*
   * Scope: GET /api/equipment/requests returns metadata for Technical Support Staff
   */
  it('GET /api/equipment/requests returns equipment type, technical specs, and event window', async () => {
    fetchMany.mockResolvedValueOnce([
      {
        id: 50,
        event_id: 8,
        equipment_id: 1,
        equipment_type: 'AUDIO',
        quantity: 2,
        technical_requirements: 'Need 2 wireless UHF mics',
        start_at: EVENT_WINDOW.start_at,
        end_at: EVENT_WINDOW.end_at,
        status: 'PENDING',
        equipment: { name: 'Wireless handheld mic', status: 'AVAILABLE', type: 'AUDIO' },
        events: { id: 8, name: 'Acme Leadership Summit', start_at: EVENT_WINDOW.start_at, end_at: EVENT_WINDOW.end_at },
      },
    ]);

    const res = await request(app).get('/api/equipment/requests');
    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    const item = res.body.requests[0];
    expect(item.equipment_name).toBe('Wireless handheld mic');
    expect(item.equipment_type).toBe('AUDIO');
    expect(item.quantity).toBe(2);
    expect(item.technical_requirements).toBe('Need 2 wireless UHF mics');
    expect(item.event_name).toBe('Acme Leadership Summit');
    expect(item.start_at).toBe(EVENT_WINDOW.start_at);
    expect(item.end_at).toBe(EVENT_WINDOW.end_at);
  });
});

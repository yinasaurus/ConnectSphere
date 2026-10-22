/**
 * SCRUM-48: Manage Equipment Request
 *
 * AC 1: Technical Support Staff can view equipment requests for relevant events.
 * AC 2: Technical Support Staff can view equipment requirements and specifications.
 * AC 3: Technical Support Staff can update the request status as arrangements are made.
 * AC 4: Event Coordinator can view the updated equipment request status.
 */
const request = require('supertest');
const { ROLES } = require('../src/constants/roles');

let mockRoles = [];
let mockUserId = 40;

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
      req.user = { id: mockUserId, isActive: true, roles: mockRoles, role: mockRoles[0] || null };
      next();
    },
  };
});

const { supabase, fetchOne, fetchMany, insertOne, updateById } = require('../src/config/db');
const { createApp } = require('../src/app');

const app = createApp();

const TECH_USER_ID = 40;
const COORD_USER_ID = 2;

const SAMPLE_EVENT = {
  id: 8,
  name: 'Acme Annual Summit',
  status: 'PLANNING',
  start_at: '2026-11-15T09:00:00.000Z',
  end_at: '2026-11-15T18:00:00.000Z',
  coordinator_id: COORD_USER_ID,
  organisation_id: 1,
};

const SAMPLE_REQUEST = {
  id: 25,
  event_id: 8,
  equipment_id: 3,
  equipment_type: 'AUDIO',
  technical_requirements: 'Dual wireless mics, UHF frequency band, rechargeable batteries',
  notes: 'Dual wireless mics, UHF frequency band, rechargeable batteries',
  quantity: 2,
  status: 'PENDING',
  decision_reason: null,
  requested_by: COORD_USER_ID,
  events: {
    id: 8,
    name: 'Acme Annual Summit',
    start_at: '2026-11-15T09:00:00.000Z',
    end_at: '2026-11-15T18:00:00.000Z',
  },
  equipment: {
    name: 'Wireless UHF Microphone',
    status: 'AVAILABLE',
    type: 'AUDIO',
  },
};

function setupSupabaseChain() {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockReturnThis(),
  };
  supabase.from.mockReturnValue(chain);
  return chain;
}

describe('SCRUM-48 Manage Equipment Request (Backend)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoles = [ROLES.TECHNICAL_SUPPORT];
    mockUserId = TECH_USER_ID;
    setupSupabaseChain();
  });

  describe('AC 1 & AC 2: Technical Support Staff view equipment requests and specifications', () => {
    it('returns equipment requests with event details and technical specifications', async () => {
      fetchMany.mockResolvedValueOnce([SAMPLE_REQUEST]);

      const res = await request(app).get('/api/equipment/requests');

      expect(res.status).toBe(200);
      expect(res.body.requests).toHaveLength(1);
      const reqItem = res.body.requests[0];
      expect(reqItem.id).toBe(25);
      expect(reqItem.event_id).toBe(8);
      expect(reqItem.event_name).toBe('Acme Annual Summit');
      expect(reqItem.equipment_name).toBe('Wireless UHF Microphone');
      expect(reqItem.equipment_type).toBe('AUDIO');
      expect(reqItem.technical_requirements).toBe(
        'Dual wireless mics, UHF frequency band, rechargeable batteries'
      );
      expect(reqItem.quantity).toBe(2);
      expect(reqItem.status).toBe('PENDING');
    });

    it('filters equipment requests by eventId when provided', async () => {
      const chain = setupSupabaseChain();
      fetchMany.mockResolvedValueOnce([SAMPLE_REQUEST]);

      const res = await request(app).get('/api/equipment/requests?eventId=8');

      expect(res.status).toBe(200);
      expect(chain.eq).toHaveBeenCalledWith('event_id', '8');
      expect(res.body.requests).toHaveLength(1);
    });
  });

  describe('AC 3: Technical Support Staff updates request status as arrangements are made', () => {
    it('updates request status to PREPARING with arrangement notes', async () => {
      fetchOne
        .mockResolvedValueOnce(SAMPLE_REQUEST) // fetch request
        .mockResolvedValueOnce(SAMPLE_EVENT); // fetch event for notification
      updateById.mockResolvedValueOnce({
        ...SAMPLE_REQUEST,
        status: 'PREPARING',
        decision_reason: 'Testing UHF frequencies and charging mic packs',
      });
      insertOne.mockResolvedValue({}); // audit or notification insert

      const res = await request(app)
        .patch('/api/equipment/requests/25')
        .send({
          status: 'PREPARING',
          notes: 'Testing UHF frequencies and charging mic packs',
        });

      expect(res.status).toBe(200);
      expect(res.body.request.status).toBe('PREPARING');
      expect(updateById).toHaveBeenCalledWith(
        'equipment_requests',
        '25',
        expect.objectContaining({
          status: 'PREPARING',
          decision_reason: 'Testing UHF frequencies and charging mic packs',
          decided_by: TECH_USER_ID,
        })
      );
    });

    it('updates request status to RESERVED and creates an equipment reservation record', async () => {
      fetchOne
        .mockResolvedValueOnce(SAMPLE_REQUEST)
        .mockResolvedValueOnce(SAMPLE_EVENT);
      fetchMany.mockResolvedValueOnce([]); // no existing reservation
      updateById.mockResolvedValueOnce({
        ...SAMPLE_REQUEST,
        status: 'RESERVED',
        decision_reason: 'Mics reserved in Audio Locker B',
      });
      insertOne.mockResolvedValue({});

      const res = await request(app)
        .patch('/api/equipment/requests/25')
        .send({
          status: 'RESERVED',
          reason: 'Mics reserved in Audio Locker B',
        });

      expect(res.status).toBe(200);
      expect(res.body.request.status).toBe('RESERVED');
      expect(insertOne).toHaveBeenCalledWith(
        'equipment_reservations',
        expect.objectContaining({
          event_id: 8,
          equipment_id: 3,
          quantity: 2,
          status: 'RESERVED',
        })
      );
    });

    it('supports updating status to READY when arrangements are prepped', async () => {
      fetchOne
        .mockResolvedValueOnce({ ...SAMPLE_REQUEST, status: 'RESERVED' })
        .mockResolvedValueOnce(SAMPLE_EVENT);
      updateById.mockResolvedValueOnce({
        ...SAMPLE_REQUEST,
        status: 'READY',
        decision_reason: 'Packed and labelled for technician handover',
      });
      insertOne.mockResolvedValue({});

      const res = await request(app)
        .patch('/api/equipment/requests/25')
        .send({
          status: 'READY',
          notes: 'Packed and labelled for technician handover',
        });

      expect(res.status).toBe(200);
      expect(res.body.request.status).toBe('READY');
    });

    it('supports updating status to UNAVAILABLE when equipment cannot be provided', async () => {
      fetchOne
        .mockResolvedValueOnce(SAMPLE_REQUEST)
        .mockResolvedValueOnce(SAMPLE_EVENT);
      updateById.mockResolvedValueOnce({
        ...SAMPLE_REQUEST,
        status: 'UNAVAILABLE',
        decision_reason: 'Audio equipment damaged during prior event',
      });
      insertOne.mockResolvedValue({});

      const res = await request(app)
        .post('/api/equipment/requests/25/status')
        .send({
          status: 'UNAVAILABLE',
          reason: 'Audio equipment damaged during prior event',
        });

      expect(res.status).toBe(200);
      expect(res.body.request.status).toBe('UNAVAILABLE');
    });

    it('rejects update with 403 when called by a non-technical staff member', async () => {
      mockRoles = [ROLES.EVENT_COORDINATOR];
      mockUserId = COORD_USER_ID;

      const res = await request(app)
        .patch('/api/equipment/requests/25')
        .send({ status: 'PREPARING' });

      expect(res.status).toBe(403);
    });

    it('rejects update with 400 when an invalid status is provided', async () => {
      fetchOne.mockResolvedValueOnce(SAMPLE_REQUEST);

      const res = await request(app)
        .patch('/api/equipment/requests/25')
        .send({ status: 'NON_EXISTENT_STATUS' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid status/i);
    });

    it('returns 404 when updating a non-existent equipment request', async () => {
      fetchOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .patch('/api/equipment/requests/999')
        .send({ status: 'PREPARING' });

      expect(res.status).toBe(404);
    });
  });

  describe('AC 4: Event Coordinator can view updated equipment request status', () => {
    it('exposes updated status and technical specifications to Event Coordinator', async () => {
      mockRoles = [ROLES.EVENT_COORDINATOR];
      mockUserId = COORD_USER_ID;

      // getEvent call
      fetchOne.mockResolvedValueOnce({
        ...SAMPLE_EVENT,
        coordinator_id: COORD_USER_ID,
      });
      // latestSafetyCheckForEvent call
      fetchMany.mockResolvedValueOnce([]);

      // listEquipmentRequests call
      fetchMany.mockResolvedValueOnce([
        {
          id: 25,
          event_id: 8,
          equipment_id: 3,
          quantity: 2,
          status: 'READY',
          needs_review: false,
          equipment_type: 'AUDIO',
          technical_requirements: 'Dual wireless mics, UHF frequency band',
          notes: 'Dual wireless mics, UHF frequency band',
          decision_reason: 'Equipment packed and ready in Room 101',
          equipment: { name: 'Wireless UHF Microphone' },
        },
      ]);

      const res = await request(app).get('/api/events/8/equipment-requests');

      expect(res.status).toBe(200);
      expect(res.body.requests).toHaveLength(1);
      const row = res.body.requests[0];
      expect(row.status).toBe('READY');
      expect(row.technical_requirements).toBe('Dual wireless mics, UHF frequency band');
      expect(row.decision_reason).toBe('Equipment packed and ready in Room 101');
    });
  });
});

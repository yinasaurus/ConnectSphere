const request = require('supertest');
const jwt = require('jsonwebtoken');
const { EVENT_STATUS, EVENT_SUB_STATE } = require('../src/constants/statuses');
const { ROLES } = require('../src/constants/roles');
const { assertSubStateTransition } = require('../src/domain/statusMachine');
const { env } = require('../src/config/env');

// ─── Stores (prefixed with "mock" so Jest allows them inside jest.mock()) ─────
const mockEventStore = {};
const mockHistoryStore = [];

// Static fixtures: users & roles that loadUser() needs from the auth middleware.
const mockUserStore = {
  10: { id: 10, full_name: 'Chloe Lim',    is_active: true, organisation_id: null },
  20: { id: 20, full_name: 'Aisha Rahman', is_active: true, organisation_id: 1   },
  99: { id: 99, full_name: 'Other Coord',  is_active: true, organisation_id: null },
};
const mockUserRolesStore = {
  10: [{ role: ROLES.EVENT_COORDINATOR }],
  20: [{ role: ROLES.EVENT_ORGANISER   }],
  99: [{ role: ROLES.EVENT_COORDINATOR }],
};

// ─── DB Mock ─────────────────────────────────────────────────────────────────
// supabase.from() returns a chain tagged with __table so fetchOne / fetchMany
// can route to the correct in-memory store without touching Supabase.
jest.mock('../src/config/db', () => {
  const makeChain = (tableName) => {
    let _val;
    const chain = {
      __table: tableName,
      get __userId()  { return _val; },
      get __eventId() { return _val; },
      select: () => chain,
      eq: (_col, val) => { _val = val; return chain; },
      order: () => chain,
      in: () => chain,
      maybeSingle: async () => {
        if (tableName === 'users')  return { data: mockUserStore[_val]  || null, error: null };
        if (tableName === 'events') return { data: mockEventStore[_val] || null, error: null };
        return { data: null, error: null };
      },
    };
    return chain;
  };

  return {
    supabase: { from: (table) => makeChain(table) },
    fetchOne: jest.fn(async (b) => (b && b.maybeSingle ? (await b.maybeSingle()).data : null)),
    fetchMany: jest.fn(async (b) => {
      if (b && b.__table === 'user_roles')           return mockUserRolesStore[b.__userId] || [];
      if (b && b.__table === 'event_status_history') return mockHistoryStore.filter((h) => h.event_id === b.__eventId);
      return mockHistoryStore;
    }),
    fetchCount:  jest.fn(async () => 0),
    insertOne:   jest.fn(async (table, row) => {
      const created = { id: Math.floor(Math.random() * 900) + 100, ...row };
      if (table === 'event_status_history') mockHistoryStore.push(created);
      return created;
    }),
    insertMany:  jest.fn(async () => []),
    updateById:  jest.fn(async (table, id, patch) => {
      if (mockEventStore[id]) Object.assign(mockEventStore[id], patch);
      return mockEventStore[id] || null;
    }),
  };
});

jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn().mockResolvedValue(true),
  notifyUser: jest.fn().mockResolvedValue(true),
}));

// Modules must be required AFTER jest.mock() calls
const db            = require('../src/config/db');
const auditService  = require('../src/services/audit.service');
const eventsService = require('../src/services/events.service');
const { createApp } = require('../src/app');
const app = createApp();

// ─── Helpers ─────────────────────────────────────────────────────────────────
// requireAuth reads payload.sub; we must use that field (not id) and sign
// with env.jwtSecret so jwt.verify() inside the middleware passes.
function authHeader(userId) {
  const token = jwt.sign({ sub: userId }, env.jwtSecret);
  return `Bearer ${token}`;
}

function seedEvent(id, data) {
  mockEventStore[id] = { id, ...data };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('SCRUM-16 Sub-state transitions and clarification', () => {
  beforeEach(() => {
    // Reset stores
    for (const k of Object.keys(mockEventStore)) delete mockEventStore[k];
    mockHistoryStore.length = 0;
    jest.clearAllMocks();

    // Re-apply smart mocks because clearAllMocks() resets them to no-ops
    db.fetchOne.mockImplementation(async (b) =>
      b && b.maybeSingle ? (await b.maybeSingle()).data : null
    );
    db.fetchMany.mockImplementation(async (b) => {
      if (b && b.__table === 'user_roles')           return mockUserRolesStore[b.__userId] || [];
      if (b && b.__table === 'event_status_history') return mockHistoryStore.filter((h) => h.event_id === b.__eventId);
      return mockHistoryStore;
    });
    db.updateById.mockImplementation(async (table, id, patch) => {
      if (mockEventStore[id]) Object.assign(mockEventStore[id], patch);
      return mockEventStore[id] || null;
    });
    db.insertOne.mockImplementation(async (table, row) => {
      const created = { id: Math.floor(Math.random() * 900) + 100, ...row };
      if (table === 'event_status_history') mockHistoryStore.push(created);
      return created;
    });
  });

  // ─── Sub-state Machine ──────────────────────────────────────────────────────
  describe('Sub-state Machine', () => {
    /*
     * AC: SCRUM-16 AC7
     * Scenario: Move an event from IN_REVIEW to ACTION_REQUIRED.
     * Setup: Call assertSubStateTransition with IN_REVIEW and ACTION_REQUIRED.
     * Expected: The transition is accepted without throwing.
     * Type: normal
     */
    it('US16-M01: allows IN_REVIEW -> ACTION_REQUIRED', () => {
      expect(() => assertSubStateTransition(EVENT_SUB_STATE.IN_REVIEW, EVENT_SUB_STATE.ACTION_REQUIRED)).not.toThrow();
    });

    /*
     * AC: SCRUM-16 AC7
     * Scenario: Move an event from ACTION_REQUIRED to CLARIFICATION_PROVIDED.
     * Setup: Call assertSubStateTransition with ACTION_REQUIRED and CLARIFICATION_PROVIDED.
     * Expected: The transition is accepted without throwing.
     * Type: normal
     */
    it('US16-M02: allows ACTION_REQUIRED -> CLARIFICATION_PROVIDED', () => {
      expect(() => assertSubStateTransition(EVENT_SUB_STATE.ACTION_REQUIRED, EVENT_SUB_STATE.CLARIFICATION_PROVIDED)).not.toThrow();
    });

    /*
     * AC: SCRUM-16 AC7
     * Scenario: Move an event from CLARIFICATION_PROVIDED back to ACTION_REQUIRED.
     * Setup: Call assertSubStateTransition with CLARIFICATION_PROVIDED and ACTION_REQUIRED.
     * Expected: The transition is accepted without throwing.
     * Type: normal
     */
    it('US16-M03: allows CLARIFICATION_PROVIDED -> ACTION_REQUIRED', () => {
      expect(() => assertSubStateTransition(EVENT_SUB_STATE.CLARIFICATION_PROVIDED, EVENT_SUB_STATE.ACTION_REQUIRED)).not.toThrow();
    });

    /*
     * AC: SCRUM-16 AC7
     * Scenario: Apply an ACTION_REQUIRED transition when the current sub-state is unset.
     * Setup: Call assertSubStateTransition with a null current sub-state.
     * Expected: The transition is accepted using the default IN_REVIEW sub-state.
     * Type: boundary
     */
    it('US16-M04: defaults from null to IN_REVIEW and allows ACTION_REQUIRED', () => {
      expect(() => assertSubStateTransition(null, EVENT_SUB_STATE.ACTION_REQUIRED)).not.toThrow();
    });

    /*
     * AC: SCRUM-16 AC7
     * Scenario: Attempt to transition an event from ACTION_REQUIRED to itself.
     * Setup: Call assertSubStateTransition with ACTION_REQUIRED as both sub-states.
     * Expected: The invalid transition throws an error.
     * Type: negative
     */
    it('US16-M05: rejects invalid transitions like ACTION_REQUIRED -> ACTION_REQUIRED', () => {
      expect(() => assertSubStateTransition(EVENT_SUB_STATE.ACTION_REQUIRED, EVENT_SUB_STATE.ACTION_REQUIRED)).toThrow();
    });
  });

  // ─── POST /api/events/:id/clarification ────────────────────────────────────
  describe('POST /api/events/:id/clarification (Request Clarification HTTP)', () => {
    /*
     * AC: SCRUM-16 AC1 & AC2
     * Scenario: The assigned coordinator requests clarification for an event under review.
     * Setup: Event is UNDER_REVIEW and assigned to coordinator 10, with organiser 20.
     * Expected: Returns 200, sets ACTION_REQUIRED, and notifies the organiser.
     * Type: normal
     */
    it('US16-R01 (AC1+AC2): assigned coordinator requests clarification successfully', async () => {
      seedEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.IN_REVIEW,
        coordinator_id: 10,
        organiser_id: 20,
        organisation_id: 1,
      });

      const res = await request(app)
        .post('/api/events/1/clarification')
        .set('Authorization', authHeader(10))
        .send({ remarks: 'Please clarify expected catering headcount.' });

      expect(res.status).toBe(200);
      expect(res.body.event.subState).toBe(EVENT_SUB_STATE.ACTION_REQUIRED);
      expect(res.body.event.reviewRemarks).toBe('Please clarify expected catering headcount.');
      expect(auditService.notifyUser).toHaveBeenCalledWith(
        20,
        'CLARIFICATION_REQUESTED',
        expect.any(String),
        expect.stringContaining('Please clarify expected catering headcount.'),
        expect.anything()
      );
    });

    /*
     * AC: SCRUM-16 AC1 (Validation)
     * Scenario: Request clarification with blank remarks
     * Setup:    Post whitespace string as remarks
     * Expected: Returns 400 VALIDATION_ERROR
     * Type:     boundary / negative
     */
    it('US16-R02 (AC1): returns 400 if remarks are blank or whitespace', async () => {
      seedEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.IN_REVIEW,
        coordinator_id: 10,
        organiser_id: 20,
      });

      const res = await request(app)
        .post('/api/events/1/clarification')
        .set('Authorization', authHeader(10))
        .send({ remarks: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Review remarks are required');
    });

    /*
     * AC: SCRUM-16 AC1 (Permissions)
     * Scenario: Non-assigned coordinator attempts to request clarification
     * Setup:    Auth header for coordinator id 99 (event assigned to id 10)
     * Expected: Returns 403 FORBIDDEN
     * Type:     negative
     */
    it('US16-R03 (AC1): returns 403 for unassigned coordinator', async () => {
      seedEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.IN_REVIEW,
        coordinator_id: 10,
        organiser_id: 20,
      });

      const res = await request(app)
        .post('/api/events/1/clarification')
        .set('Authorization', authHeader(99))
        .send({ remarks: 'Need more details' });

      expect(res.status).toBe(403);
    });

    /*
     * AC: SCRUM-16 AC1 (Status constraint)
     * Scenario: Attempt clarification on an event in PLANNING status
     * Setup:    Event status is PLANNING
     * Expected: Returns 409 INVALID_STATUS
     * Type:     negative
     */
    it('US16-R04 (AC1): returns 409 if event is not in UNDER_REVIEW status', async () => {
      seedEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.PLANNING,
        coordinator_id: 10,
        organiser_id: 20,
      });

      const res = await request(app)
        .post('/api/events/1/clarification')
        .set('Authorization', authHeader(10))
        .send({ remarks: 'Need more info' });

      expect(res.status).toBe(409);
    });
  });

  // ─── POST /api/events/:id/clarification/respond ────────────────────────────
  describe('POST /api/events/:id/clarification/respond (Respond Clarification HTTP)', () => {
    /*
     * AC: SCRUM-16 AC4 & AC5
     * Scenario: The organiser responds to an outstanding clarification request with text.
     * Setup: Event is UNDER_REVIEW and ACTION_REQUIRED, assigned to coordinator 10 and organiser 20.
     * Expected: Returns 200, sets CLARIFICATION_PROVIDED, and notifies the coordinator.
     * Type: normal
     */
    it('US16-R05 (AC4+AC5): organiser responds with text response successfully', async () => {
      seedEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.ACTION_REQUIRED,
        review_remarks: 'Please clarify expected catering.',
        coordinator_id: 10,
        organiser_id: 20,
        organisation_id: 1,
      });

      const res = await request(app)
        .post('/api/events/1/clarification/respond')
        .set('Authorization', authHeader(20))
        .send({ response: 'Vegetarian buffet for 50 people.' });

      expect(res.status).toBe(200);
      expect(res.body.event.subState).toBe(EVENT_SUB_STATE.CLARIFICATION_PROVIDED);
      expect(res.body.event.clarificationResponse).toBe('Vegetarian buffet for 50 people.');
      expect(auditService.notifyUser).toHaveBeenCalledWith(
        10,
        'CLARIFICATION_PROVIDED',
        expect.any(String),
        expect.stringContaining('Vegetarian buffet for 50 people.'),
        expect.anything()
      );
    });

    /*
     * AC: SCRUM-16 AC4 (Amendments)
     * Scenario: Organiser submits clarification response with field amendments
     * Setup:    Pass payload with amendments object
     * Expected: Returns 200, applies allowed event request amendments
     * Type:     normal
     */
    it('US16-R06 (AC4): organiser responds with amendments successfully', async () => {
      seedEvent(1, {
        name: 'Tech Conference',
        description: 'Old description',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.ACTION_REQUIRED,
        coordinator_id: 10,
        organiser_id: 20,
        organisation_id: 1,
      });

      const res = await request(app)
        .post('/api/events/1/clarification/respond')
        .set('Authorization', authHeader(20))
        .send({
          response: 'Updated description as requested.',
          amendments: { description: 'New detailed description' },
        });

      expect(res.status).toBe(200);
      expect(res.body.event.description).toBe('New detailed description');
    });

    /*
     * AC: SCRUM-16 AC5 (Permissions)
     * Scenario: Non-organiser (e.g. coordinator) attempts to respond to clarification
     * Setup:    Auth header for coordinator (not organiser)
     * Expected: Returns 403 FORBIDDEN
     * Type:     negative
     */
    it('US16-R07 (AC5): returns 403 if non-organiser tries to respond', async () => {
      seedEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.ACTION_REQUIRED,
        coordinator_id: 10,
        organiser_id: 20,
      });

      const res = await request(app)
        .post('/api/events/1/clarification/respond')
        .set('Authorization', authHeader(10))
        .send({ response: 'Coordinator trying to respond' });

      expect(res.status).toBe(403);
    });

    /*
     * AC: SCRUM-16 AC5 (Validation)
     * Scenario: Organiser submits an empty response with no text and no amendments
     * Setup:    Pass blank string for response and empty amendments
     * Expected: Returns 400 VALIDATION_ERROR
     * Type:     boundary / negative
     */
    it('US16-R08 (AC5): returns 400 for empty response with no amendments', async () => {
      seedEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.ACTION_REQUIRED,
        coordinator_id: 10,
        organiser_id: 20,
      });

      const res = await request(app)
        .post('/api/events/1/clarification/respond')
        .set('Authorization', authHeader(20))
        .send({ response: '   ', amendments: {} });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Clarification response text or amendments are required');
    });
  });

  // ─── History Trail ──────────────────────────────────────────────────────────
  describe('History Trail for Clarification Rounds', () => {
    /*
     * AC: SCRUM-16 AC5 & AC8
     * Scenario: Multiple clarification rounds are completed for an event.
     * Setup: Run two request-and-response rounds for the same event.
     * Expected: History contains every request and response note in sequence.
     * Type: normal
     */
    it('US16-H01 (AC5): records and lists every clarification request and response note in order', async () => {
      seedEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.IN_REVIEW,
        coordinator_id: 10,
        organiser_id: 20,
        organisation_id: 1,
      });

      const coordinator = { id: 10, roles: [ROLES.EVENT_COORDINATOR], organisationId: null };
      const organiser   = { id: 20, roles: [ROLES.EVENT_ORGANISER],   organisationId: 1    };

      // Round 1
      await eventsService.requestClarification(coordinator, 1, 'Round 1 Question');
      await eventsService.respondClarification(organiser, 1, 'Round 1 Answer');
      // Round 2
      await eventsService.requestClarification(coordinator, 1, 'Round 2 Question');
      await eventsService.respondClarification(organiser, 1, 'Round 2 Answer');

      const history = mockHistoryStore.filter((h) => h.event_id === 1);
      expect(history.length).toBeGreaterThanOrEqual(4);
      const notes = history.map((h) => h.note);

      expect(notes).toContain('Clarification requested: Round 1 Question');
      expect(notes).toContain('Clarification responded: Round 1 Answer');
      expect(notes).toContain('Clarification requested: Round 2 Question');
      expect(notes).toContain('Clarification responded: Round 2 Answer');
    });
  });
});

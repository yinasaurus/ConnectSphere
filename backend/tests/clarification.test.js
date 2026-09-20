const { EVENT_STATUS, EVENT_SUB_STATE } = require('../src/constants/statuses');
const { ROLES } = require('../src/constants/roles');
const { assertSubStateTransition } = require('../src/domain/statusMachine');

// Mock db and services
jest.mock('../src/config/db', () => {
  let eventStore = {};

  return {
    supabase: {
      from: () => ({
        select: () => ({
          eq: (col, val) => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [] }),
            }),
            order: () => Promise.resolve({ data: [] }),
            maybeSingle: async () => ({ data: eventStore[val] || null, error: null }),
          }),
          order: () => Promise.resolve({ data: Object.values(eventStore) }),
        }),
      }),
    },
    fetchOne: async (builder) => {
      const res = await builder.maybeSingle();
      return res.data;
    },
    fetchMany: async () => [],
    fetchCount: async () => 0,
    insertOne: async (table, row) => ({ id: 99, ...row }),
    insertMany: async () => [],
    updateById: async (table, id, patch) => {
      if (eventStore[id]) {
        eventStore[id] = { ...eventStore[id], ...patch };
      }
      return eventStore[id];
    },
    __setEvent: (id, data) => {
      eventStore[id] = { id, ...data };
    },
    __getEvent: (id) => eventStore[id],
    __clear: () => { eventStore = {}; },
  };
});

const db = require('../src/config/db');
const eventsService = require('../src/services/events.service');

describe('SCUM-16 Sub-state transitions and clarification', () => {
  const coordinatorUser = {
    id: 10,
    roles: [ROLES.EVENT_COORDINATOR],
    fullName: 'Chloe Lim',
    organisationId: null,
  };

  const otherCoordinator = {
    id: 99,
    roles: [ROLES.EVENT_COORDINATOR],
    fullName: 'Other Coordinator',
    organisationId: null,
  };

  const organiserUser = {
    id: 20,
    roles: [ROLES.EVENT_ORGANISER],
    fullName: 'Aisha Rahman',
    organisationId: 1,
  };

  beforeEach(() => {
    db.__clear();
  });

  describe('Sub-state Machine', () => {
    it('allows IN_REVIEW -> ACTION_REQUIRED', () => {
      expect(() => assertSubStateTransition(EVENT_SUB_STATE.IN_REVIEW, EVENT_SUB_STATE.ACTION_REQUIRED)).not.toThrow();
    });

    it('allows ACTION_REQUIRED -> CLARIFICATION_PROVIDED', () => {
      expect(() => assertSubStateTransition(EVENT_SUB_STATE.ACTION_REQUIRED, EVENT_SUB_STATE.CLARIFICATION_PROVIDED)).not.toThrow();
    });

    it('allows CLARIFICATION_PROVIDED -> ACTION_REQUIRED', () => {
      expect(() => assertSubStateTransition(EVENT_SUB_STATE.CLARIFICATION_PROVIDED, EVENT_SUB_STATE.ACTION_REQUIRED)).not.toThrow();
    });

    it('defaults from null to IN_REVIEW and allows ACTION_REQUIRED', () => {
      expect(() => assertSubStateTransition(null, EVENT_SUB_STATE.ACTION_REQUIRED)).not.toThrow();
    });

    it('rejects invalid transitions like ACTION_REQUIRED -> ACTION_REQUIRED', () => {
      expect(() => assertSubStateTransition(EVENT_SUB_STATE.ACTION_REQUIRED, EVENT_SUB_STATE.ACTION_REQUIRED)).toThrow();
    });
  });

  describe('requestClarification service', () => {
    it('allows assigned coordinator to request clarification and transitions to ACTION_REQUIRED', async () => {
      db.__setEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.IN_REVIEW,
        coordinator_id: 10,
        organiser_id: 20,
        organisation_id: 1,
      });

      const updated = await eventsService.requestClarification(
        coordinatorUser,
        1,
        'Please clarify expected catering and audiovisual requirements.'
      );

      expect(updated.subState).toBe(EVENT_SUB_STATE.ACTION_REQUIRED);
      expect(updated.reviewRemarks).toBe('Please clarify expected catering and audiovisual requirements.');
      expect(db.__getEvent(1).sub_state).toBe(EVENT_SUB_STATE.ACTION_REQUIRED);
      expect(db.__getEvent(1).review_remarks).toBe('Please clarify expected catering and audiovisual requirements.');
    });

    it('rejects if remarks are blank or whitespace', async () => {
      db.__setEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.IN_REVIEW,
        coordinator_id: 10,
        organiser_id: 20,
      });

      await expect(
        eventsService.requestClarification(coordinatorUser, 1, '   ')
      ).rejects.toThrow('Review remarks are required to request clarification');
    });

    it('rejects if event is not in UNDER_REVIEW status', async () => {
      db.__setEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.PLANNING,
        coordinator_id: 10,
        organiser_id: 20,
      });

      await expect(
        eventsService.requestClarification(coordinatorUser, 1, 'Need more info')
      ).rejects.toThrow('Clarification can only be requested while the event is under review');
    });

    it('rejects non-assigned coordinator', async () => {
      db.__setEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.UNDER_REVIEW,
        coordinator_id: 10,
        organiser_id: 20,
      });

      await expect(
        eventsService.requestClarification(otherCoordinator, 1, 'Need more info')
      ).rejects.toThrow('Only the assigned coordinator can update this event');
    });
  });

  describe('respondClarification service', () => {
    it('allows organiser to respond and transitions sub-state to CLARIFICATION_PROVIDED', async () => {
      db.__setEvent(1, {
        name: 'Tech Conference',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.ACTION_REQUIRED,
        review_remarks: 'Please clarify expected catering.',
        coordinator_id: 10,
        organiser_id: 20,
        organisation_id: 1,
      });

      const updated = await eventsService.respondClarification(
        organiserUser,
        1,
        'Catering will be vegetarian buffet for 50 people.'
      );

      expect(updated.subState).toBe(EVENT_SUB_STATE.CLARIFICATION_PROVIDED);
      expect(updated.clarificationResponse).toBe('Catering will be vegetarian buffet for 50 people.');
      expect(db.__getEvent(1).sub_state).toBe(EVENT_SUB_STATE.CLARIFICATION_PROVIDED);
    });

    it('allows organiser to edit event fields when sub_state is ACTION_REQUIRED', async () => {
      db.__setEvent(1, {
        name: 'Tech Conference',
        description: 'Original description',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.ACTION_REQUIRED,
        coordinator_id: 10,
        organiser_id: 20,
        organisation_id: 1,
      });

      const updated = await eventsService.updateEvent(organiserUser, 1, {
        description: 'Updated with AV and catering details',
      });

      expect(updated.description).toBe('Updated with AV and catering details');
    });

    it('locks organiser from editing when status is UNDER_REVIEW but sub_state is NOT ACTION_REQUIRED', async () => {
      db.__setEvent(1, {
        name: 'Tech Conference',
        description: 'Original description',
        status: EVENT_STATUS.UNDER_REVIEW,
        sub_state: EVENT_SUB_STATE.IN_REVIEW,
        coordinator_id: 10,
        organiser_id: 20,
        organisation_id: 1,
      });

      await expect(
        eventsService.updateEvent(organiserUser, 1, { description: 'Unauthorized edit' })
      ).rejects.toThrow('After submission, organisers request changes through the assigned coordinator');
    });
  });
});

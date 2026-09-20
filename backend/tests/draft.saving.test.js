const { EVENT_STATUS } = require('../src/constants/statuses');
const { ROLES } = require('../src/constants/roles');

jest.mock('../src/config/db', () => {
  let store = {};
  let currentId = 100;

  return {
    supabase: {
      from: () => ({
        select: () => ({
          eq: (col, val) => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [] }),
            }),
            order: () => Promise.resolve({ data: [] }),
            maybeSingle: async () => ({ data: store[val] || null, error: null }),
          }),
          order: () => Promise.resolve({ data: Object.values(store) }),
        }),
      }),
    },
    fetchOne: async (builder) => {
      const res = await builder.maybeSingle();
      return res.data;
    },
    fetchMany: async () => Object.values(store),
    fetchCount: async () => 0,
    insertOne: async (table, row) => {
      currentId += 1;
      const record = { id: currentId, ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      store[currentId] = record;
      return record;
    },
    insertMany: async () => [],
    updateById: async (table, id, patch) => {
      if (store[id]) {
        store[id] = { ...store[id], ...patch, updated_at: new Date().toISOString() };
      }
      return store[id];
    },
    __clear: () => { store = {}; },
    __store: () => store,
  };
});

const db = require('../src/config/db');
const eventsService = require('../src/services/events.service');

describe('TC-DRAFT-04: Draft Saving & Resuming', () => {
  const organiserUser = {
    id: 1,
    fullName: 'Aisha Rahman',
    roles: [ROLES.EVENT_ORGANISER],
    organisationId: 10,
  };

  beforeEach(() => {
    db.__clear();
  });

  it('persists partial details as a draft record without triggering compulsory submission validation errors', async () => {
    // Partial details: only name and purpose entered, all other compulsory fields empty/null
    const partialPayload = {
      name: 'Partial Hackathon Draft',
      purpose: 'Initial brainstorm session',
      category: 'WORKSHOP',
      // compulsory fields omitted intentionally
      description: null,
      startAt: null,
      endAt: null,
      expectedAttendance: null,
      venueRequirements: null,
      accessibilityNeeds: null,
    };

    // Save as draft should succeed and NOT throw any validation errors
    const draft = await eventsService.createEvent(organiserUser, partialPayload);

    expect(draft).toBeDefined();
    expect(draft.id).toBeDefined();
    expect(draft.name).toBe('Partial Hackathon Draft');
    expect(draft.purpose).toBe('Initial brainstorm session');
    expect(draft.status).toBe(EVENT_STATUS.DRAFT);
    expect(draft.description).toBeNull();
    expect(draft.startAt).toBeNull();
  });

  it('allows the organizer to resume editing a draft later and update partial details without validation errors', async () => {
    // Initial draft save
    const initialDraft = await eventsService.createEvent(organiserUser, {
      name: 'Annual Gala 2026',
      purpose: 'Fundraising',
    });

    // Resume editing: Fetch draft
    const loadedDraft = await eventsService.getEvent(organiserUser, initialDraft.id);
    expect(loadedDraft.status).toBe(EVENT_STATUS.DRAFT);
    expect(loadedDraft.name).toBe('Annual Gala 2026');

    // Organizer updates more partial details (adds expected attendance and description, still missing dates and venue)
    const updatedDraft = await eventsService.updateEvent(organiserUser, initialDraft.id, {
      description: 'Annual charity dinner for alumni.',
      expectedAttendance: 120,
    });

    expect(updatedDraft.description).toBe('Annual charity dinner for alumni.');
    expect(updatedDraft.expectedAttendance).toBe(120);
    expect(updatedDraft.status).toBe(EVENT_STATUS.DRAFT);
  });

  it('enforces compulsory field validation only when submitting for review, not while saving as draft', async () => {
    // Draft with missing fields
    const draft = await eventsService.createEvent(organiserUser, {
      name: 'Incomplete Event',
    });

    // Attempting submitEvent should enforce submission validation
    await expect(eventsService.submitEvent(organiserUser, draft.id)).rejects.toThrow(
      /Complete required fields before submitting/
    );

    // But updating as draft remains permissible
    await expect(
      eventsService.updateEvent(organiserUser, draft.id, { purpose: 'Added purpose' })
    ).resolves.toBeDefined();
  });
});

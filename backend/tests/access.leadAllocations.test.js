/**
 * SCRUM-57: a Lead sees the Coordinators they assigned and the events those
 * Coordinators hold. Another Lead's allocation, an unassigned event, and a
 * finished or unsent event stay off this overview.
 *
 * Who allocated the event is the newest COORDINATOR_ASSIGNED or
 * COORDINATOR_REASSIGNED audit. Assign and reassign already write those rows.
 * Opening the overview reads them. It does not change the unassigned queue.
 */
jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  updateById: jest.fn(),
  insertOne: jest.fn(),
}));

const db = require('../src/config/db');
const access = require('../src/services/access.service');
const { ROLES } = require('../src/constants/roles');

const lead = { id: 11, roles: [ROLES.EVENT_COORDINATOR_LEAD] };
const otherLead = { id: 12, roles: [ROLES.EVENT_COORDINATOR_LEAD] };

function chain() {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  };
}

function eventRow(overrides) {
  return {
    id: 3,
    name: 'Workshop',
    status: 'PLANNING',
    coordinator_id: 2,
    coordinator: { full_name: 'Chloe Lim' },
    ...overrides,
  };
}

function allocation(overrides) {
  return {
    id: 1,
    entity_id: 3,
    actor_id: 11,
    action: 'COORDINATOR_ASSIGNED',
    created_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.supabase.from.mockReturnValue(chain());
});

function openOverview(events, audits) {
  db.fetchMany.mockResolvedValueOnce(events).mockResolvedValueOnce(audits);
  return access.listAssignmentOverview(lead);
}

describe('SCRUM-57 this Lead\'s assignment overview', () => {
  /*
   * AC: SCRUM-57 AC1
   * Scenario: This Lead allocated two events to Chloe and one to Daniel.
   * Setup: Lead 11 is the newest allocator on events 3, 4, and 5. Chloe holds 3 and 4.
   *   Daniel holds 5. The rows are returned out of name order so the grouping is visible.
   * Expected: Chloe's two events are listed with her, then Daniel's event with him.
   * Type: normal
   */
  it('US57-B01: lists the Coordinators this Lead assigned, with their events', async () => {
    const assignments = await openOverview(
      [
        eventRow({ id: 5, name: 'Forum', coordinator_id: 4, coordinator: { full_name: 'Daniel Ong' } }),
        eventRow({ id: 4, name: 'Briefing' }),
        eventRow({ id: 3, name: 'Workshop' }),
      ],
      [
        allocation({ id: 1, entity_id: 3 }),
        allocation({ id: 2, entity_id: 4, created_at: '2026-10-02T00:00:00.000Z' }),
        allocation({ id: 3, entity_id: 5, created_at: '2026-10-03T00:00:00.000Z' }),
      ]
    );

    expect(assignments).toEqual([
      {
        eventId: 4, eventName: 'Briefing', status: 'PLANNING',
        coordinatorId: 2, coordinatorName: 'Chloe Lim',
      },
      {
        eventId: 3, eventName: 'Workshop', status: 'PLANNING',
        coordinatorId: 2, coordinatorName: 'Chloe Lim',
      },
      {
        eventId: 5, eventName: 'Forum', status: 'PLANNING',
        coordinatorId: 4, coordinatorName: 'Daniel Ong',
      },
    ]);
  });

  /*
   * AC: SCRUM-57 AC2
   * Scenario: Another Lead made the current allocation on an event this Lead used to hold.
   * Setup: Lead 11 assigned event 3 to Chloe. Later Lead 12 reassigned it to Daniel.
   *   The event row now names Daniel. Lead 12's audit is the newer one.
   * Expected: Lead 11's overview does not include event 3.
   *   Lead 12's overview includes event 3, held by Daniel.
   * Type: conflict
   */
  it('US57-B02: an event assigned by another Lead is left out', async () => {
    const heldByDaniel = [eventRow({ coordinator_id: 4, coordinator: { full_name: 'Daniel Ong' } })];
    const audits = [
      allocation({ id: 1, created_at: '2026-10-01T00:00:00.000Z' }),
      allocation({
        id: 2, actor_id: 12, action: 'COORDINATOR_REASSIGNED',
        created_at: '2026-10-02T00:00:00.000Z',
      }),
    ];
    db.fetchMany
      .mockResolvedValueOnce(heldByDaniel)
      .mockResolvedValueOnce(audits)
      .mockResolvedValueOnce(heldByDaniel)
      .mockResolvedValueOnce(audits);

    const assignments = await access.listAssignmentOverview(lead);
    const forOtherLead = await access.listAssignmentOverview(otherLead);

    expect(assignments).toEqual([]);
    expect(forOtherLead).toEqual([
      {
        eventId: 3, eventName: 'Workshop', status: 'PLANNING',
        coordinatorId: 4, coordinatorName: 'Daniel Ong',
      },
    ]);
  });

  /*
   * AC: SCRUM-57 AC3
   * Scenario: An event still has no Coordinator.
   * Setup: Event 9 is Submitted with coordinator_id null, which is the SCRUM-65 queue.
   *   Event 3 is a real allocation by this Lead and is the contrast.
   * Expected: Event 9 is not in the overview. Event 3 is.
   * Type: boundary
   */
  it('US57-B03: an unassigned event is not in this overview', async () => {
    const assignments = await openOverview(
      [
        eventRow({ id: 9, name: 'Waiting', status: 'SUBMITTED', coordinator_id: null, coordinator: null }),
        eventRow(),
      ],
      [allocation()]
    );

    expect(assignments.map((row) => row.eventId)).toEqual([3]);
  });

  /*
   * AC: SCRUM-57 AC4
   * Scenario: This Lead assigned Chloe, then reassigned the same event to Daniel.
   * Setup: The event row now holds Daniel. The older audit is the assignment to Chloe.
   *   The newer audit is this Lead's reassignment. Opening the overview reads that
   *   current row. It does not keep the old Coordinator.
   * Expected: One row, coordinator Daniel (id 4). Chloe is not listed for this event.
   * Type: normal
   */
  it('US57-B04: after this Lead reassigns, the next open shows the new Coordinator', async () => {
    const assignments = await openOverview(
      [eventRow({ coordinator_id: 4, coordinator: { full_name: 'Daniel Ong' } })],
      [
        allocation({ id: 1, action: 'COORDINATOR_ASSIGNED', created_at: '2026-10-01T00:00:00.000Z' }),
        allocation({
          id: 2, action: 'COORDINATOR_REASSIGNED', created_at: '2026-10-04T00:00:00.000Z',
        }),
      ]
    );

    expect(assignments).toEqual([
      {
        eventId: 3, eventName: 'Workshop', status: 'PLANNING',
        coordinatorId: 4, coordinatorName: 'Daniel Ong',
      },
    ]);
  });

  /*
   * AC: SCRUM-57 AC5
   * Scenario: This Lead allocated an event that has since finished, been cancelled,
   *   been rejected, or is still a draft.
   * Setup: Each status is one event whose newest allocation audit is by Lead 11.
   *   A Planning event is included in the same read so a live allocation still shows.
   * Expected: The four closed or unsent events are absent. The Planning event remains.
   * Type: boundary
   */
  it.each(['COMPLETED', 'CANCELLED', 'REJECTED', 'DRAFT'])(
    'US57-B05: a %s event does not appear',
    async (status) => {
      const assignments = await openOverview(
        [
          eventRow({ id: 8, name: 'Closed', status }),
          eventRow({ id: 3, name: 'Workshop', status: 'PLANNING' }),
        ],
        [
          allocation({ entity_id: 8 }),
          allocation({ id: 2, entity_id: 3 }),
        ]
      );

      expect(assignments.map((row) => row.eventId)).toEqual([3]);
    }
  );

  /*
   * AC: SCRUM-57 AC4
   * Scenario: Both allocation audits have no created_at, so the higher id is the current one.
   * Setup: writeAudit does not set created_at. Both rows here leave it empty, and the
   *   reassignment has the higher id. A row read back from audit_logs has created_at from
   *   the database default; this case is the tie-break when the times are missing.
   *   The event now holds Daniel.
   * Expected: The overview shows Daniel, the Coordinator after the reassignment.
   * Type: boundary
   */
  it('US57-B06: the newer reassignment wins when the audit time is still the database default', async () => {
    const assignments = await openOverview(
      [eventRow({ coordinator_id: 4, coordinator: { full_name: 'Daniel Ong' } })],
      [
        allocation({ id: 1, action: 'COORDINATOR_ASSIGNED', created_at: null }),
        allocation({ id: 2, action: 'COORDINATOR_REASSIGNED', created_at: null }),
      ]
    );

    expect(assignments[0].coordinatorId).toBe(4);
    expect(assignments[0].coordinatorName).toBe('Daniel Ong');
  });

  /*
   * AC: SCRUM-57 AC2, AC4
   * Scenario: After this Lead assigned the event, a later audit records something else.
   * Setup: Lead 11's COORDINATOR_ASSIGNED row is older. A newer row by Lead 12 has
   *   action STATUS_CHANGED. The event still holds Chloe. The overview loads every
   *   event audit, so this row is present and must be ignored.
   * Expected: The event stays on Lead 11's overview, held by Chloe.
   * Type: boundary
   */
  it('US57-B07: a later audit that is not an allocation leaves this Lead\'s assignment in place', async () => {
    const assignments = await openOverview(
      [eventRow()],
      [
        allocation({ id: 1, created_at: '2026-10-01T00:00:00.000Z' }),
        allocation({
          id: 2, actor_id: 12, action: 'STATUS_CHANGED',
          created_at: '2026-10-05T00:00:00.000Z',
        }),
      ]
    );

    expect(assignments).toEqual([
      {
        eventId: 3, eventName: 'Workshop', status: 'PLANNING',
        coordinatorId: 2, coordinatorName: 'Chloe Lim',
      },
    ]);
  });
});

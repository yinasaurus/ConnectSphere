/**
 * SCRUM-32: the confirmed reassignment reaches audit_logs.
 * writeAudit is the real helper. Only the database is mocked, so this file
 * checks the insert instead of a mock of writeAudit.
 */
jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  updateById: jest.fn(),
  insertOne: jest.fn(),
}));

const db = require('../src/config/db');
const service = require('../src/services/events.service');
const { ROLES } = require('../src/constants/roles');

const lead = { id: 11, roles: [ROLES.EVENT_COORDINATOR_LEAD] };

let event;

beforeEach(() => {
  jest.clearAllMocks();
  event = {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    status: 'UNDER_REVIEW',
    name: 'Leadership Forum',
    purpose: 'Plan',
    description: 'A forum',
    coordinator: { full_name: 'Chloe Lim' },
  };
  db.supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  });
  db.updateById.mockImplementation(async (_table, _id, patch) => {
    Object.assign(event, patch);
    return event;
  });
  db.insertOne.mockResolvedValue(undefined);
  db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }]);
});

describe('SCRUM-32 audit row insert', () => {
  /*
   * AC: SCRUM-32 AC1, AC2
   * Scenario: A Lead replaces the Coordinator, and the audit helper is the real one.
   * Setup: Event 3 is held by Coordinator 2. Lead 11 chooses active Coordinator 4.
   *   The database mock records insertOne. Notices also insert rows; this test looks
   *   only at the audit_logs insert.
   * Expected: One audit_logs row. Who is 11. The old Coordinator is 2 and the new one
   *   is 4. created_at is absent, so when stays the column default now().
   * Type: normal
   */
  it('inserts an audit_logs row for a confirmed Lead reassignment and leaves when to the database', async () => {
    db.fetchOne
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ id: 4, full_name: 'Daniel Ong', is_active: true })
      .mockResolvedValue(event);

    await service.reassignEventCoordinator(lead, 3, 4);

    const auditInserts = db.insertOne.mock.calls.filter(([table]) => table === 'audit_logs');
    expect(auditInserts).toHaveLength(1);
    // AC1 and AC2: this is the row writeAudit inserts. No created_at means when is the column default.
    expect(auditInserts[0][1]).toEqual({
      actor_id: 11,
      action: 'COORDINATOR_REASSIGNED',
      entity_type: 'event',
      entity_id: 3,
      metadata: {
        fromCoordinatorId: 2,
        toCoordinatorId: 4,
      },
    });
    expect(auditInserts[0][1].created_at).toBeUndefined();
  });
});

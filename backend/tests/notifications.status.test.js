/**
 * SCRUM-45 AC4: notification status is recorded as new (read_at null) or viewed (read_at set).
 */
jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  fetchCount: jest.fn(),
  throwIf: jest.fn((err) => {
    if (err) throw err;
  }),
}));

const db = require('../src/config/db');
const notifications = require('../src/services/notifications.service');

let builder;

beforeEach(() => {
  jest.clearAllMocks();
  builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
  };
  db.supabase.from.mockReturnValue(builder);
});

describe('SCRUM-45 notification new / viewed status (AC4)', () => {
  /*
   * AC:       SCRUM-45 AC4
   * Scenario: User lists their notices; unread rows have read_at null (new).
   * Setup:    One new and one viewed row returned from the DB.
   * Expected: listMine returns both; caller can tell new vs viewed from read_at.
   * Type:     normal
   */
  it('US45-N01: listMine returns rows with read_at null (new) or set (viewed)', async () => {
    const rows = [
      { id: 1, user_id: 1, title: 'New', read_at: null },
      { id: 2, user_id: 1, title: 'Old', read_at: '2026-10-01T00:00:00.000Z' },
    ];
    db.fetchMany.mockResolvedValueOnce(rows);

    const result = await notifications.listMine(1);

    expect(result).toEqual(rows);
    expect(result[0].read_at).toBeNull();
    expect(result[1].read_at).toBeTruthy();
  });

  /*
   * AC:       SCRUM-45 AC4
   * Scenario: User marks one of their notices as viewed.
   * Setup:    markRead for user 1, notification 5; update scoped by user_id.
   * Expected: update sets read_at; fetch returns the viewed row.
   * Type:     normal
   */
  it('US45-N02: markRead sets read_at so the notice becomes viewed', async () => {
    builder.update.mockReturnValue(builder);
    // supabase chain ends by returning { error: null } from the last eq — simulate via thenable
    builder.eq.mockImplementation(() => builder);
    // The update chain is awaited as a thenable in supabase client; our mock uses throwIf on { error }
    // notifications.service awaits supabase.from().update().eq().eq() which returns a promise-like.
    // Make the chain thenable:
    builder.then = (resolve) => resolve({ error: null });
    db.fetchOne.mockResolvedValueOnce({
      id: 5,
      user_id: 1,
      read_at: '2026-10-20T12:00:00.000Z',
    });

    const result = await notifications.markRead(1, 5);

    expect(db.supabase.from).toHaveBeenCalledWith('notifications');
    expect(builder.update).toHaveBeenCalledWith({ read_at: expect.any(String) });
    expect(builder.eq).toHaveBeenCalledWith('id', 5);
    expect(builder.eq).toHaveBeenCalledWith('user_id', 1);
    expect(result.read_at).toBeTruthy();
  });

  /*
   * AC:       SCRUM-45 AC4
   * Scenario: Unread badge counts only notices still new.
   * Setup:    fetchCount returns 3 for read_at IS null.
   * Expected: unreadCount is 3; query filters read_at null.
   * Type:     boundary
   */
  it('US45-N03: unreadCount only includes notices with read_at null', async () => {
    db.fetchCount.mockResolvedValueOnce(3);

    await expect(notifications.unreadCount(1)).resolves.toBe(3);
    expect(builder.is).toHaveBeenCalledWith('read_at', null);
  });
});

/**
 * SCRUM-45 AC3, AC4: a notification is new (read_at null) or viewed (read_at set), and a
 * person only ever sees or changes their own.
 *
 * The Notifications page showing new vs viewed is SCRUM-44 (Notifications.test.jsx).
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

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
const { createApp } = require('../src/app');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

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
   * Expected: listMine returns both; the caller can tell new from viewed by read_at.
   * Type:     normal
   */
  // SCRUM-45-TC11
  it('SCRUM-45 AC4: listMine returns rows with read_at null (new) or set (viewed)', async () => {
    const rows = [
      { id: 1, user_id: 1, title: 'New', read_at: null },
      { id: 2, user_id: 1, title: 'Old', read_at: '2026-10-01T00:00:00.000Z' },
    ];
    db.fetchMany.mockResolvedValueOnce(rows);

    const result = await notifications.listMine(1);

    // Scoped to this user so another person's notices cannot appear as "new" or "viewed" here.
    expect(db.supabase.from).toHaveBeenCalledWith('notifications');
    expect(builder.eq).toHaveBeenCalledWith('user_id', 1);
    expect(result).toEqual(rows);
    expect(result[0].read_at).toBeNull();
    expect(result[1].read_at).toBeTruthy();
  });

  /*
   * AC:       SCRUM-45 AC4
   * Scenario: User marks one of their notices as viewed.
   * Setup:    markRead for user 1, notification 5; update scoped by user_id.
   * Expected: update sets read_at; the fetch returns the viewed row.
   * Type:     normal
   */
  // SCRUM-45-TC12
  it('SCRUM-45 AC4: markRead sets read_at so the notice becomes viewed', async () => {
    builder.update.mockReturnValue(builder);
    builder.eq.mockImplementation(() => builder);
    // The update chain is awaited like a supabase promise: it resolves to { error: null }.
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
   * Setup:    fetchCount returns 3 for read_at IS NULL.
   * Expected: unreadCount is 3; the query filters read_at null.
   * Type:     boundary
   */
  // SCRUM-45-TC13
  it('SCRUM-45 AC4: unreadCount only includes notices with read_at null', async () => {
    db.fetchCount.mockResolvedValueOnce(3);

    await expect(notifications.unreadCount(1)).resolves.toBe(3);
    expect(builder.is).toHaveBeenCalledWith('read_at', null);
  });

  /*
   * AC:       SCRUM-45 AC3, AC4
   * Scenario: User 2 tries to mark user 1's notification 5 as viewed.
   * Setup:    The update is limited to user 2's rows, so notification 5 is not found for them.
   * Expected: markRead returns null. The update and the lookup are both filtered by user 2,
   *           never by user 1.
   * Type:     error
   */
  // SCRUM-45-TC14
  it("SCRUM-45 AC3: markRead cannot touch another person's notification", async () => {
    builder.update.mockReturnValue(builder);
    builder.eq.mockImplementation(() => builder);
    builder.then = (resolve) => resolve({ error: null });
    db.fetchOne.mockResolvedValueOnce(null);

    const result = await notifications.markRead(2, 5);

    expect(result).toBeNull();
    expect(builder.eq).toHaveBeenCalledWith('id', 5);
    expect(builder.eq).toHaveBeenCalledWith('user_id', 2);
    expect(builder.eq).not.toHaveBeenCalledWith('user_id', 1);
  });
});

describe('SCRUM-45 notification HTTP routes (AC4)', () => {
  const app = createApp();
  const token = jwt.sign({ sub: 1 }, env.jwtSecret);
  const cookie = `${env.sessionCookieName}=${token}`;

  /*
   * AC:       SCRUM-45 AC4
   * Scenario: The signed-in Organiser opens their notices through the real route.
   * Setup:    Cookie for Organiser 1; one new and one viewed notice; two still unread per count.
   * Expected: 200; the body holds both notices (read_at null and set) and unread 2.
   * Type:     normal
   */
  // SCRUM-45-TC15
  it('SCRUM-45 AC4: GET /api/notifications returns the caller notices and the unread count', async () => {
    const rows = [
      { id: 1, user_id: 1, title: 'New', read_at: null },
      { id: 2, user_id: 1, title: 'Old', read_at: '2026-10-01T00:00:00.000Z' },
    ];
    db.fetchOne.mockResolvedValueOnce({ id: 1, is_active: true });
    db.fetchMany
      .mockResolvedValueOnce([{ role: ROLES.EVENT_ORGANISER }])
      .mockResolvedValueOnce(rows);
    db.fetchCount.mockResolvedValueOnce(2);

    const res = await request(app).get('/api/notifications').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.notifications).toEqual(rows);
    expect(res.body.unread).toBe(2);
    expect(builder.eq).toHaveBeenCalledWith('user_id', 1);
  });

  /*
   * AC:       SCRUM-45 AC4
   * Scenario: The signed-in Organiser marks notification 5 as viewed through the real route.
   * Setup:    Cookie for Organiser 1; the stored row now has a read_at.
   * Expected: 200; the notification in the body has read_at set. The update is limited to
   *           notification 5 and user 1.
   * Type:     normal
   */
  // SCRUM-45-TC16
  it('SCRUM-45 AC4: POST /api/notifications/:id/read marks the caller notice as viewed', async () => {
    builder.update.mockReturnValue(builder);
    builder.eq.mockImplementation(() => builder);
    builder.then = (resolve) => resolve({ error: null });
    db.fetchOne
      .mockResolvedValueOnce({ id: 1, is_active: true })
      .mockResolvedValueOnce({ id: 5, user_id: 1, read_at: '2026-10-20T12:00:00.000Z' });
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_ORGANISER }]);

    const res = await request(app).post('/api/notifications/5/read').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.notification.read_at).toBeTruthy();
    expect(builder.eq).toHaveBeenCalledWith('id', '5');
    expect(builder.eq).toHaveBeenCalledWith('user_id', 1);
  });
});

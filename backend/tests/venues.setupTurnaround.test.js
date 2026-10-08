/**
 * SCRUM-59: Venue Staff set and edit a venue's setup time and turnaround time.
 *   AC1  Venue Staff can set a setup time and a turnaround time, in minutes, for a venue.
 *   AC2  Venue Staff can change either value later.
 *   AC3  After saving, reopening the venue shows the saved values.
 *   AC4  A negative or non-numeric value is rejected and the saved value is unchanged.
 *   AC5  Anyone who isn't Venue Staff is rejected and the values are unchanged.
 *
 * This is a verification card: the fields were built in SCUM-7. Every request goes
 * through the real app (session cookie, role check, body validation, venues service);
 * only the database is replaced by in-memory tables, so each test can check what was
 * actually saved. "Turnaround" is stored and sent as teardown_minutes / teardownMinutes.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  updateById: jest.fn(),
  throwIf: jest.fn((error) => {
    if (error) throw error;
  }),
}));

jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn(),
  notifyUser: jest.fn(),
}));

const db = require('../src/config/db');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');
const { createApp } = require('../src/app');

const USERS = {
  venueStaff: { id: 1, role: ROLES.VENUE_STAFF },
  coordinator: { id: 2, role: ROLES.EVENT_COORDINATOR },
  organiser: { id: 3, role: ROLES.EVENT_ORGANISER },
  attendee: { id: 4, role: ROLES.ATTENDEE },
  technicalSupport: { id: 5, role: ROLES.TECHNICAL_SUPPORT },
};

let tables;

// In-memory stand-in for the tables the venue routes and the login check read and write.
function useInMemoryTables() {
  let nextId = 100;
  const rowsFor = (query) => tables[query.table].filter((row) => (
    query.filters.every(([column, value]) => String(row[column]) === String(value))
  ));

  db.supabase.from.mockImplementation((table) => {
    const query = { table, filters: [] };
    query.select = () => query;
    query.order = () => query;
    query.eq = (column, value) => {
      query.filters.push([column, value]);
      return query;
    };
    return query;
  });
  db.fetchMany.mockImplementation(async (query) => rowsFor(query));
  db.fetchOne.mockImplementation(async (query) => rowsFor(query)[0] || null);
  db.insertOne.mockImplementation(async (table, row) => {
    const created = { id: nextId++, is_active: true, ...row };
    tables[table].push(created);
    return created;
  });
  db.insertMany.mockImplementation(async (table, rows) => {
    const created = rows.map((row) => ({ id: nextId++, ...row }));
    tables[table].push(...created);
    return created;
  });
  db.updateById.mockImplementation(async (table, id, patch) => {
    const row = tables[table].find((item) => Number(item.id) === Number(id));
    Object.assign(row, patch);
    return row;
  });
}

function cookieFor(user) {
  const token = jwt.sign({ sub: user.id, roles: [user.role] }, env.jwtSecret);
  return `${env.sessionCookieName}=${token}`;
}

function savedHall() {
  return tables.venues.find((venue) => venue.id === 1);
}

describe('SCRUM-59 venue setup and turnaround times', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    tables = {
      users: Object.values(USERS).map((user) => ({ id: user.id, email: `${user.id}@test`, is_active: true })),
      user_roles: Object.values(USERS).map((user) => ({ user_id: user.id, role: user.role })),
      venues: [{
        id: 1,
        name: 'Helix Hall',
        location: 'Level 2',
        capacity: 180,
        setup_minutes: 30,
        teardown_minutes: 45,
        is_active: true,
      }],
      venue_layouts: [],
    };
    useInMemoryTables();
  });

  /*
   * AC:       SCRUM-59 AC1
   * Scenario: Venue Staff set both times on an existing venue from the Update venue form.
   * Setup:    Helix Hall is saved with 30 min setup and 45 min turnaround; the PATCH sends
   *           15 and 20, the body the Update venue form sends.
   * Expected: 200, and both values are stored in minutes on the venue record.
   * Type:     normal
   */
  it('lets Venue Staff set the setup and turnaround minutes of a venue', async () => {
    const res = await request(app).patch('/api/venues/1')
      .set('Cookie', cookieFor(USERS.venueStaff))
      .send({ setupMinutes: 15, teardownMinutes: 20 });

    expect(res.status).toBe(200);
    expect(savedHall()).toMatchObject({ setup_minutes: 15, teardown_minutes: 20 });
  });

  /*
   * AC:       SCRUM-59 AC1
   * Scenario: Venue Staff create a venue through the API with its setup and turnaround times.
   * Setup:    POST /api/venues with 10 min setup and 25 min turnaround. (The Add venue form
   *           has no time fields; new venues from the form start at 30/30 and are edited
   *           with the Update venue form.)
   * Expected: 201, and the new venue is stored with 10 and 25, not the 30-minute defaults.
   * Type:     normal
   */
  it('stores the setup and turnaround minutes given when a venue is created', async () => {
    const res = await request(app).post('/api/venues')
      .set('Cookie', cookieFor(USERS.venueStaff))
      .send({ name: 'Orchid Boardroom', capacity: 16, setupMinutes: 10, teardownMinutes: 25 });

    expect(res.status).toBe(201);
    expect(tables.venues.find((venue) => venue.name === 'Orchid Boardroom'))
      .toMatchObject({ setup_minutes: 10, teardown_minutes: 25 });
  });

  /*
   * AC:       SCRUM-59 AC1 (card assumption: zero is valid, to be confirmed by the customer)
   * Scenario: Venue Staff set both times to 0 on an existing venue.
   * Setup:    Helix Hall at 30/45; the PATCH sends 0 and 0, the lowest value AC4 allows.
   * Expected: 200, and 0 is stored as 0 (not replaced by a default), so a venue that needs
   *           no setup or turnaround can be recorded that way.
   * Type:     boundary
   */
  it('saves 0 minutes when editing a venue', async () => {
    const res = await request(app).patch('/api/venues/1')
      .set('Cookie', cookieFor(USERS.venueStaff))
      .send({ setupMinutes: 0, teardownMinutes: 0 });

    expect(res.status).toBe(200);
    expect(savedHall()).toMatchObject({ setup_minutes: 0, teardown_minutes: 0 });
  });

  /*
   * AC:       SCRUM-59 AC2
   * Scenario: Venue Staff later change only one of the two values.
   * Setup:    Helix Hall at 30/45. The first PATCH changes only turnaround to 60; the
   *           second changes only setup to 5.
   * Expected: Each change is saved and the other value is left as it was, so either value
   *           can be edited on its own.
   * Type:     normal
   */
  it('lets Venue Staff change either value on its own later', async () => {
    await request(app).patch('/api/venues/1')
      .set('Cookie', cookieFor(USERS.venueStaff))
      .send({ teardownMinutes: 60 });
    expect(savedHall()).toMatchObject({ setup_minutes: 30, teardown_minutes: 60 });

    await request(app).patch('/api/venues/1')
      .set('Cookie', cookieFor(USERS.venueStaff))
      .send({ setupMinutes: 5 });
    expect(savedHall()).toMatchObject({ setup_minutes: 5, teardown_minutes: 60 });
  });

  /*
   * AC:       SCRUM-59 AC3
   * Scenario: Venue Staff save new times, then the venue list is loaded again, as it is when
   *           the Venues page is reopened.
   * Setup:    PATCH 15/50 on Helix Hall, then GET /api/venues as a separate request.
   * Expected: Both the save response and the fresh list show 15 and 50, the values the
   *           Update venue form is filled from when the venue is opened.
   * Type:     normal
   */
  it('returns the saved values when the venue is loaded again', async () => {
    const saved = await request(app).patch('/api/venues/1')
      .set('Cookie', cookieFor(USERS.venueStaff))
      .send({ setupMinutes: 15, teardownMinutes: 50 });
    expect(saved.body.venue).toMatchObject({ setupMinutes: 15, teardownMinutes: 50 });

    const reopened = await request(app).get('/api/venues').set('Cookie', cookieFor(USERS.venueStaff));

    expect(reopened.status).toBe(200);
    expect(reopened.body.venues.find((venue) => venue.id === 1))
      .toMatchObject({ setupMinutes: 15, teardownMinutes: 50 });
  });

  /*
   * AC:       SCRUM-59 AC4
   * Scenario: Venue Staff try to save a negative or non-numeric setup or turnaround time.
   * Setup:    Helix Hall at 30/45. Each row sends one bad value: -1 (just below the
   *           lowest valid value), -30, text, an empty box ('' is what the form sends when
   *           the box is cleared), and null.
   * Expected: 400 VALIDATION_ERROR naming the field, and the saved 30/45 is unchanged.
   * Type:     error
   */
  it.each([
    ['setupMinutes', -1],
    ['setupMinutes', -30],
    ['setupMinutes', 'abc'],
    ['setupMinutes', ''],
    ['setupMinutes', null],
    ['teardownMinutes', -1],
    ['teardownMinutes', -30],
    ['teardownMinutes', 'abc'],
    ['teardownMinutes', ''],
    ['teardownMinutes', null],
  ])('rejects %s = %p and keeps the saved value', async (field, value) => {
    const res = await request(app).patch('/api/venues/1')
      .set('Cookie', cookieFor(USERS.venueStaff))
      .send({ [field]: value });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
    expect(savedHall()).toMatchObject({ setup_minutes: 30, teardown_minutes: 45 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-59 AC4
   * Scenario: The Update venue form sends a bad turnaround together with other valid edits.
   * Setup:    Helix Hall at 30/45; the PATCH sends a new name, setup 10 and turnaround -5.
   * Expected: 400, and nothing in the request is saved: the name, setup and turnaround all
   *           keep their saved values, because the whole save is rejected.
   * Type:     error
   */
  it('rejects the whole save when one value is negative', async () => {
    const res = await request(app).patch('/api/venues/1')
      .set('Cookie', cookieFor(USERS.venueStaff))
      .send({ name: 'Helix Hall Renamed', setupMinutes: 10, teardownMinutes: -5 });

    expect(res.status).toBe(400);
    expect(savedHall()).toMatchObject({ name: 'Helix Hall', setup_minutes: 30, teardown_minutes: 45 });
  });

  /*
   * AC:       SCRUM-59 AC4
   * Scenario: A new venue is created with a negative setup time.
   * Setup:    POST /api/venues as Venue Staff with setup -10.
   * Expected: 400 naming setupMinutes, and no venue is created.
   * Type:     error
   */
  it('rejects a negative setup time on a new venue', async () => {
    const res = await request(app).post('/api/venues')
      .set('Cookie', cookieFor(USERS.venueStaff))
      .send({ name: 'Orchid Boardroom', capacity: 16, setupMinutes: -10 });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'setupMinutes' })]));
    expect(tables.venues).toHaveLength(1);
  });

  /*
   * AC:       SCRUM-59 AC5
   * Scenario: Signed-in users without the Venue Staff role try to change the times.
   * Setup:    Helix Hall at 30/45; each internal and external role sends a valid PATCH
   *           (setup 5, turnaround 5), so only the role can be the reason for refusal.
   * Expected: 403 for every role, and the saved 30/45 is unchanged.
   * Type:     error
   */
  it.each([
    ['Event Coordinator', USERS.coordinator],
    ['Event Organiser', USERS.organiser],
    ['Attendee', USERS.attendee],
    ['Technical Support', USERS.technicalSupport],
  ])('refuses a change from %s and keeps the saved values', async (_name, user) => {
    const res = await request(app).patch('/api/venues/1')
      .set('Cookie', cookieFor(user))
      .send({ setupMinutes: 5, teardownMinutes: 5 });

    expect(res.status).toBe(403);
    expect(savedHall()).toMatchObject({ setup_minutes: 30, teardown_minutes: 45 });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-59 AC5
   * Scenario: Someone who isn't signed in tries to change the times.
   * Setup:    PATCH with no session cookie.
   * Expected: 401, and the saved values are unchanged.
   * Type:     error
   */
  it('refuses a change without a session and keeps the saved values', async () => {
    const res = await request(app).patch('/api/venues/1').send({ setupMinutes: 5 });

    expect(res.status).toBe(401);
    expect(savedHall()).toMatchObject({ setup_minutes: 30, teardown_minutes: 45 });
  });

  /*
   * AC:       SCRUM-59 AC5
   * Scenario: An Event Coordinator tries to create a venue with its own setup and turnaround.
   * Setup:    POST /api/venues as an Event Coordinator with valid values.
   * Expected: 403, and no venue is created, so a non-Venue-Staff user can't set the values
   *           on a new venue either.
   * Type:     error
   */
  it('refuses to let a non-Venue-Staff user create a venue with times', async () => {
    const res = await request(app).post('/api/venues')
      .set('Cookie', cookieFor(USERS.coordinator))
      .send({ name: 'Orchid Boardroom', capacity: 16, setupMinutes: 10, teardownMinutes: 10 });

    expect(res.status).toBe(403);
    expect(tables.venues).toHaveLength(1);
  });
});

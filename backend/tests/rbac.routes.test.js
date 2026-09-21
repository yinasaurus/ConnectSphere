const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() }, fetchOne: jest.fn(), fetchMany: jest.fn(),
}));
jest.mock('../src/services/venues.service', () => ({
  createVenue: jest.fn(), updateVenue: jest.fn(), listBookings: jest.fn(),
  requestBooking: jest.fn(), decideBooking: jest.fn(), blockVenue: jest.fn(),
}));
jest.mock('../src/services/events.service', () => ({
  createEvent: jest.fn(), updateEvent: jest.fn(), submitEvent: jest.fn(), changeStatus: jest.fn(),
}));

const db = require('../src/config/db');
const venues = require('../src/services/venues.service');
const events = require('../src/services/events.service');
const { createApp } = require('../src/app');

describe('SCUM-13 routes with real JWT authentication and role middleware', () => {
  const app = createApp();
  const token = jwt.sign({ sub: 1, roles: [ROLES.VENUE_STAFF] }, env.jwtSecret);
  const cases = [
    ['post', '/api/venues', venues.createVenue, [ROLES.VENUE_STAFF], 201],
    ['patch', '/api/venues/2', venues.updateVenue, [ROLES.VENUE_STAFF], 200],
    ['get', '/api/venues/bookings', venues.listBookings, [ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF], 200],
    ['post', '/api/venues/bookings', venues.requestBooking, [ROLES.EVENT_COORDINATOR], 201],
    ['post', '/api/venues/bookings/2/decision', venues.decideBooking, [ROLES.VENUE_STAFF], 200],
    ['post', '/api/events', events.createEvent, [ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR], 201],
    ['patch', '/api/events/3', events.updateEvent, [ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR], 200],
    ['post', '/api/events/3/submit', events.submitEvent, [ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR], 200],
    ['post', '/api/events/3/status', events.changeStatus, [ROLES.EVENT_COORDINATOR], 200],
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    db.supabase.from.mockReturnValue({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis() });
    db.fetchOne.mockResolvedValue({ id: 1, is_active: true, organisation_id: 10 });
    db.fetchMany.mockResolvedValue([]);
    for (const service of [venues, events]) {
      Object.values(service).forEach((fn) => fn.mockResolvedValue([]));
    }
  });

  for (const [method, path, handler, allowed, success] of cases) {
    it.each([...Object.values(ROLES), 'UNKNOWN'])(`${method} ${path} checks database role %s`, async (role) => {
      db.fetchMany.mockResolvedValue([{ role }]);
      const res = await request(app)[method](path)
        .set('Cookie', `${env.sessionCookieName}=${token}`)
        .send({ roles: [ROLES.VENUE_STAFF], role: ROLES.EVENT_COORDINATOR });
      expect(res.status).toBe(allowed.includes(role) ? success : 403);
      expect(handler).toHaveBeenCalledTimes(allowed.includes(role) ? 1 : 0);
    });

    it(`${method} ${path} rejects a missing session before querying the database`, async () => {
      expect((await request(app)[method](path).send({})).status).toBe(401);
      expect(db.fetchOne).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });
  }

  it.each([
    'invalid',
    jwt.sign({ sub: 1 }, env.jwtSecret, { expiresIn: -1 }),
    jwt.sign({ sub: 1 }, 'wrong-signing-secret'),
  ])('rejects invalid, expired or tampered credentials', async (badToken) => {
    const res = await request(app).get('/api/venues/bookings').set('Authorization', `Bearer ${badToken}`);
    expect(res.status).toBe(401);
    expect(db.fetchOne).not.toHaveBeenCalled();
  });

  it('rejects disabled users even with a valid cookie', async () => {
    db.fetchOne.mockResolvedValue({ id: 1, is_active: false });
    const res = await request(app).get('/api/venues/bookings').set('Cookie', `${env.sessionCookieName}=${token}`);
    expect(res.status).toBe(401);
  });

  it('allows a hybrid user when the permitted role is second', async () => {
    db.fetchMany.mockResolvedValue([{ role: ROLES.EVENT_COORDINATOR }, { role: ROLES.VENUE_STAFF }]);
    const res = await request(app).post('/api/venues').set('Cookie', `${env.sessionCookieName}=${token}`).send({});
    expect(res.status).toBe(201);
  });
});

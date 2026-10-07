const request = require('supertest');
const { ROLES } = require('../src/constants/roles');

let mockRoles = [];

jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');

  return {
    ...actual,
    requireAuth: (req, _res, next) => {
      req.user = {
        id: 999,
        email: 'test@example.com',
        isActive: true,
        roles: mockRoles,
        role: mockRoles[0] || null,
      };
      next();
    },
  };
});

jest.mock('../src/services/venues.service', () => ({
  listBookings: jest.fn().mockResolvedValue([]),
}));

const venuesService = require('../src/services/venues.service');
const { createApp } = require('../src/app');

describe('SCUM-13 venue booking authorisation', () => {
  const app = createApp();

  beforeEach(() => {
    mockRoles = [];
    jest.clearAllMocks();
    venuesService.listBookings.mockResolvedValue([]);
  });

  it('forbids an Event Organiser from viewing the global booking queue', async () => {
    mockRoles = [ROLES.EVENT_ORGANISER];

    const res = await request(app).get('/api/venues/bookings');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
    expect(venuesService.listBookings).not.toHaveBeenCalled();
  });

  it('allows an Event Coordinator to view the global booking queue', async () => {
    mockRoles = [ROLES.EVENT_COORDINATOR];

    const res = await request(app).get('/api/venues/bookings');

    expect(res.status).toBe(200);
    expect(venuesService.listBookings).toHaveBeenCalledTimes(1);
  });

  it('allows Venue Staff to view the global booking queue', async () => {
    mockRoles = [ROLES.VENUE_STAFF];

    const res = await request(app).get('/api/venues/bookings');

    expect(res.status).toBe(200);
    expect(venuesService.listBookings).toHaveBeenCalledTimes(1);
  });

  it('allows a hybrid Coordinator and Venue Staff user', async () => {
    mockRoles = [ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF];

    const res = await request(app).get('/api/venues/bookings');

    expect(res.status).toBe(200);
    expect(venuesService.listBookings).toHaveBeenCalledTimes(1);
  });

  it('forbids an Attendee from viewing the global booking queue', async () => {
    mockRoles = [ROLES.ATTENDEE];

    const res = await request(app).get('/api/venues/bookings');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
    expect(venuesService.listBookings).not.toHaveBeenCalled();
  });
});
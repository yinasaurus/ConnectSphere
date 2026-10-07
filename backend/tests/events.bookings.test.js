const request = require('supertest');
const { ROLES } = require('../src/constants/roles');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
}));

let mockUser;
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    requireAuth: (req, res, next) => {
      if (!mockUser) return res.status(401).json({ error: 'UNAUTHENTICATED' });
      req.user = mockUser;
      return next();
    },
  };
});

const { supabase, fetchOne, fetchMany, insertOne } = require('../src/config/db');
const { createApp } = require('../src/app');

describe('event-specific venue booking access', () => {
  const app = createApp();
  let query;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };
    query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis() };
    supabase.from.mockReturnValue(query);
    fetchOne.mockResolvedValue({ id: 3, organisation_id: 10, status: 'PLANNING' });
    fetchMany.mockResolvedValue([
      // Include saved timing and creation data so the API can power occupied-window summaries.
      {
        id: 7, event_id: 3, venue_id: 2, status: 'APPROVED',
        start_at: '2026-10-11T10:00:00Z', end_at: '2026-10-11T12:00:00Z',
        setup_minutes: 30, teardown_minutes: 45, created_at: '2026-10-05T12:00:00Z',
        venues: { name: 'Hall' }, notes: 'Internal only',
      },
    ]);
  });

  /*
   * AC:       SCRUM-26 AC7 + AC8 + AC9
   * Scenario: An event organizer loads an event's existing venue request summary.
   * Setup:    The event has an Approved booking with saved event times, setup/turnaround
   *           values, submission date, and venue name.
   * Expected: The response is scoped to this event and includes the fields needed to show
   *           this request's status, occupied window, and submission date.
   * Type:     normal
   */
  it('lets an organiser read their event booking summary, scoped in the database', async () => {
    const res = await request(app).get('/api/events/3/venue-bookings');
    expect(res.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith('event_id', 3);
    expect(res.body.bookings).toEqual([
      {
        id: 7, event_id: 3, venue_id: 2, status: 'APPROVED',
        start_at: '2026-10-11T10:00:00Z', end_at: '2026-10-11T12:00:00Z',
        setup_minutes: 30, teardown_minutes: 45, created_at: '2026-10-05T12:00:00Z',
        venue_name: 'Hall',
      },
    ]);
  });

  it('denies another organisation before reading bookings', async () => {
    mockUser.organisationId = 20;
    const res = await request(app).get('/api/events/3/venue-bookings');
    expect(res.status).toBe(404);
    expect(fetchMany).not.toHaveBeenCalled();
  });

  it('does not query bookings for a missing event', async () => {
    fetchOne.mockResolvedValue(null);
    const res = await request(app).get('/api/events/999/venue-bookings');
    expect(res.status).toBe(404);
    expect(fetchMany).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-26 AC7
   * Scenario: Venue Staff and Coordinators load the event's booking requests.
   * Setup:    The signed-in user has either the Event Coordinator or Venue Staff role.
   * Expected: Both internal roles can access the event-specific booking endpoint.
   * Type:     normal
   */
  it.each([ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF])('allows existing internal event access for %s', async (role) => {
    mockUser.roles = [role];
    expect((await request(app).get('/api/events/3/venue-bookings')).status).toBe(200);
  });

  it('denies attendees access to an unconfirmed event', async () => {
    mockUser.roles = [ROLES.ATTENDEE];
    expect((await request(app).get('/api/events/3/venue-bookings')).status).toBe(404);
    expect(fetchMany).not.toHaveBeenCalled();
  });

  it.each(['get', 'post'])('blocks cross-client comments through %s', async (method) => {
    mockUser.organisationId = 20;
    const res = await request(app)[method]('/api/comments/3').send({ body: 'Not permitted' });
    expect(res.status).toBe(404);
    expect(fetchMany).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('allows comments for an accessible event', async () => {
    expect((await request(app).get('/api/comments/3')).status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith('event_id', '3');
  });

  it.each(['/api/comments/3', '/api/events/3/history'])('blocks attendee planning data at %s', async (path) => {
    mockUser.roles = [ROLES.ATTENDEE];
    expect((await request(app).get(path)).status).toBe(403);
    expect(fetchMany).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-26 AC7 + AC8
   * Scenario: An attendee loads the public booking summary for a confirmed event.
   * Setup:    The event is confirmed and registration-required; its booking list includes
   *           internal and Approved requests.
   * Expected: The attendee receives only the event's Approved booking, without internal
   *           event details or pending/rejected request statuses.
   * Type:     boundary
   */
  it('returns only public event fields and approved bookings for attendees', async () => {
    mockUser.roles = [ROLES.ATTENDEE];
    fetchOne.mockResolvedValue({ id: 3, name: 'Public event', status: 'CONFIRMED', registration_required: true, operational_notes: 'Private', equipment_notes: 'Private' });
    const event = await request(app).get('/api/events/3');
    expect(event.status).toBe(200);
    expect(event.body.event.name).toBe('Public event');
    expect(event.body.event).not.toHaveProperty('operationalNotes');
    expect(event.body.event).not.toHaveProperty('equipmentNotes');
    expect((await request(app).get('/api/events/3/venue-bookings')).status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith('status', 'APPROVED');
  });
});

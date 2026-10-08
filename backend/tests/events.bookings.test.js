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
        // Include venue capability data returned by the booking-summary query.
        venues: {
          name: 'Hall',
          capacity: 100,
          facilities: 'Projector, stage',
          accessibility: 'Wheelchair access',
          venue_layouts: [{ layout: 'THEATRE' }],
        },
        notes: 'Internal only',
      },
    ]);
  });

  /*
   * AC:       SCRUM-25 AC3 + AC4 (API capability data support)
   * Scenario: An event organizer loads a booking's venue capability data for suitability review.
   * Setup:    The event has a booking whose venue record contains facilities, accessibility
   *           features, and supported room layouts, as well as capacity.
   * Expected: The event-scoped response includes these venue attributes; this test checks
   *           data availability, not the frontend's suitability comparison or result.
   * Type:     normal
   */
  /*
   * AC:       SCRUM-26 AC2 + AC9 (booking-summary timing data support)
   * Scenario: An event organizer loads an event's existing venue request summary.
   * Setup:    The event has an Approved booking with saved event times, setup/turnaround
   *           values, submission date, and venue name.
   * Expected: The event-scoped response includes this booking's saved date/time and buffer
   *           values for the client to render; this test does not assert occupied-window
   *           calculation or display, or multiple requests.
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
        venue_details: {
          capacity: 100,
          facilities: 'Projector, stage',
          accessibility: 'Wheelchair access',
          layouts: ['THEATRE'],
        },
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
   * AC:       SCRUM-26 AC7 (endpoint access)
   * Scenario: Venue Staff and Coordinators load the event's booking requests.
   * Setup:    The signed-in user has either the Event Coordinator or Venue Staff role.
   * Expected: Both internal roles receive a successful response from the event-specific
   *           booking endpoint; this assertion checks access, not the response contents.
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
   * AC:       Not applicable to SCRUM-25/26 (public attendee event visibility)
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

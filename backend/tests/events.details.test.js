/**
 * SCRUM-39: view event details during the planning or confirmed stage.
 *
 *   AC1  Authorised users can view event details during the Planning or Confirmed stage.
 *   AC2  The details include attendance, venue, date, time and equipment requirement.
 *
 * Decisions agreed before building: "authorised" keeps today's rules (Coordinators, Venue
 * Staff and Technical Support see every event; Organisers see their own organisation's;
 * Attendees only get the public view of confirmed events with registration); other stages
 * are not blocked; "venue" is the booked venue plus the venue needs text; "equipment" is the
 * equipment notes plus the event's equipment requests.
 *
 * Only the database is mocked. Requests carry a real signed session cookie, so the real
 * auth middleware loads the user (first fetchOne) and their roles (first fetchMany).
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  throwIf: jest.fn(),
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  fetchCount: jest.fn(),
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  updateById: jest.fn(),
}));

const { supabase, fetchOne, fetchMany } = require('../src/config/db');
const { createApp } = require('../src/app');

const app = createApp();

// An event in organisation 10 with every AC2 field filled in.
function eventRow(overrides) {
  return {
    id: 3,
    organisation_id: 10,
    coordinator_id: 21,
    name: 'Leadership Forum',
    status: 'PLANNING',
    start_at: '2026-10-20T10:00:00Z',
    end_at: '2026-10-20T12:00:00Z',
    expected_attendance: 120,
    venue_requirements: 'Theatre layout, stage',
    equipment_notes: '2 projectors, 4 wireless mics',
    registration_required: true,
    operational_notes: 'Internal only',
    ...overrides,
  };
}

let chain;
beforeEach(() => {
  jest.clearAllMocks();
  fetchOne.mockReset();
  fetchMany.mockReset();
  chain = {};
  ['select', 'eq', 'order'].forEach((method) => {
    chain[method] = jest.fn(() => chain);
  });
  supabase.from.mockReturnValue(chain);
});

// Signs in user `id` with `roles` (and an organisation for Organisers) through the real middleware.
function as(roles, { id = 5, organisationId = 10 } = {}) {
  fetchOne.mockResolvedValueOnce({ id, is_active: true, organisation_id: organisationId });
  fetchMany.mockResolvedValueOnce(roles.map((role) => ({ role })));
  const token = jwt.sign({ sub: id }, env.jwtSecret);
  return (path) => request(app).get(path).set('Cookie', `${env.sessionCookieName}=${token}`);
}

describe('SCRUM-39 GET /api/events/:id (event details)', () => {
  /*
   * AC:       SCRUM-39 AC1 + AC2
   * Scenario: Each internal role opens an event in the Planning and in the Confirmed stage.
   * Setup:    Coordinator, Venue Staff or Technical Support; event 3 in that status with
   *           attendance 120, 10:00-12:00 on 20 Oct, venue needs and equipment notes.
   * Expected: 200 with the status and every AC2 field: attendance, start and end (date and
   *           time), venue needs and equipment notes, so staff can plan from one place.
   * Type:     normal
   */
  it.each([
    [ROLES.EVENT_COORDINATOR, 'PLANNING'],
    [ROLES.EVENT_COORDINATOR, 'CONFIRMED'],
    [ROLES.VENUE_STAFF, 'PLANNING'],
    [ROLES.VENUE_STAFF, 'CONFIRMED'],
    [ROLES.TECHNICAL_SUPPORT, 'PLANNING'],
    [ROLES.TECHNICAL_SUPPORT, 'CONFIRMED'],
  ])('US39-D01 (AC1+AC2): %s sees the full details of a %s event', async (role, status) => {
    const get = as([role]);
    fetchOne.mockResolvedValueOnce(eventRow({ status }));
    const res = await get('/api/events/3');
    expect(res.status).toBe(200);
    expect(res.body.event).toEqual(expect.objectContaining({
      id: 3,
      status,
      expectedAttendance: 120,
      startAt: '2026-10-20T10:00:00Z',
      endAt: '2026-10-20T12:00:00Z',
      venueRequirements: 'Theatre layout, stage',
      equipmentNotes: '2 projectors, 4 wireless mics',
    }));
  });

  /*
   * AC:       SCRUM-39 AC1 + AC2
   * Scenario: The Organiser whose organisation owns the event opens it while Planning or
   *           Confirmed.
   * Setup:    Organiser in organisation 10; event 3 belongs to organisation 10.
   * Expected: 200 with the same AC2 fields, because the client needs the latest
   *           arrangements for their own event.
   * Type:     normal
   */
  it.each(['PLANNING', 'CONFIRMED'])('US39-D02 (AC1+AC2): the owning Organiser sees a %s event', async (status) => {
    const get = as([ROLES.EVENT_ORGANISER], { organisationId: 10 });
    fetchOne.mockResolvedValueOnce(eventRow({ status }));
    const res = await get('/api/events/3');
    expect(res.status).toBe(200);
    expect(res.body.event).toEqual(expect.objectContaining({ expectedAttendance: 120, equipmentNotes: '2 projectors, 4 wireless mics' }));
  });

  /*
   * AC:       SCRUM-39 AC1 (who is authorised)
   * Scenario: Someone who is not authorised for this event tries to open it.
   * Setup:    (a) an Organiser from organisation 20; (b) a user with an unknown role;
   *           (c) an Attendee while the event is still Planning.
   * Expected: 404 "Event not found", the same as a missing event, so an outsider can't even
   *           learn that the event exists (client isolation).
   * Type:     error
   */
  it.each([
    ['an Organiser from another organisation', [ROLES.EVENT_ORGANISER], 20, 'PLANNING'],
    ['a user with an unknown role', ['UNKNOWN'], 10, 'CONFIRMED'],
    ['an Attendee while the event is Planning', [ROLES.ATTENDEE], 10, 'PLANNING'],
  ])('US39-D03 (AC1): %s gets 404', async (_label, roles, organisationId, status) => {
    const get = as(roles, { organisationId });
    fetchOne.mockResolvedValueOnce(eventRow({ status }));
    const res = await get('/api/events/3');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Event not found');
  });

  /*
   * AC:       SCRUM-39 AC1 (agreed decision: Attendees keep the public view)
   * Scenario: An Attendee opens a Confirmed event that takes registrations.
   * Setup:    Attendee; event 3 Confirmed with registration_required true.
   * Expected: 200 with the date and time, but no attendance, venue needs, equipment notes or
   *           internal notes. Attendees aren't authorised for planning details.
   * Type:     boundary
   */
  it('US39-D04 (AC1): an Attendee sees a confirmed event without planning details', async () => {
    const get = as([ROLES.ATTENDEE]);
    fetchOne.mockResolvedValueOnce(eventRow({ status: 'CONFIRMED' }));
    const res = await get('/api/events/3');
    expect(res.status).toBe(200);
    expect(res.body.event).toEqual(expect.objectContaining({ startAt: '2026-10-20T10:00:00Z', endAt: '2026-10-20T12:00:00Z' }));
    ['expectedAttendance', 'venueRequirements', 'equipmentNotes', 'operationalNotes'].forEach((field) => {
      expect(res.body.event).not.toHaveProperty(field);
    });
  });

  /*
   * AC:       SCRUM-39 AC1 (agreed decision: Attendees keep the public view)
   * Scenario: An Attendee opens a Confirmed event that doesn't take registrations.
   * Setup:    Attendee; event 3 Confirmed with registration_required false.
   * Expected: 404 "Event not found". Only Confirmed events that are open for registration
   *           are public to Attendees.
   * Type:     error
   */
  it('US39-D07 (AC1): an Attendee cannot see a confirmed event without registration', async () => {
    const get = as([ROLES.ATTENDEE]);
    fetchOne.mockResolvedValueOnce(eventRow({ status: 'CONFIRMED', registration_required: false }));
    const res = await get('/api/events/3');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Event not found');
  });

  /*
   * AC:       SCRUM-39 AC2
   * Scenario: A Planning event whose details haven't all been filled in yet.
   * Setup:    Coordinator; attendance, times, venue needs and equipment notes all null.
   * Expected: 200, with each AC2 field present as null rather than missing, so the page can
   *           show "not recorded" instead of breaking.
   * Type:     boundary
   */
  it('US39-D05 (AC2): empty AC2 fields come back as null', async () => {
    const get = as([ROLES.EVENT_COORDINATOR]);
    fetchOne.mockResolvedValueOnce(eventRow({
      expected_attendance: null, start_at: null, end_at: null, venue_requirements: null, equipment_notes: null,
    }));
    const res = await get('/api/events/3');
    expect(res.status).toBe(200);
    expect(res.body.event).toEqual(expect.objectContaining({
      expectedAttendance: null, startAt: null, endAt: null, venueRequirements: null, equipmentNotes: null,
    }));
  });

  /*
   * AC:       SCRUM-39 AC1
   * Scenario: The event id doesn't exist, or nobody is signed in.
   * Setup:    (a) Coordinator asks for event 999, which isn't found; (b) no session cookie.
   * Expected: (a) 404 "Event not found"; (b) 401 before any database lookup.
   * Type:     error
   */
  it('US39-D06 (AC1): a missing event is 404 and no session is 401', async () => {
    const get = as([ROLES.EVENT_COORDINATOR]);
    fetchOne.mockResolvedValueOnce(null);
    expect((await get('/api/events/999')).status).toBe(404);

    fetchOne.mockClear();
    const res = await request(app).get('/api/events/3');
    expect(res.status).toBe(401);
    expect(fetchOne).not.toHaveBeenCalled();
  });
});

describe('SCRUM-39 GET /api/events/:id/venue-bookings (venue, AC2)', () => {
  /*
   * AC:       SCRUM-39 AC2 (venue)
   * Scenario: Technical Support opens a Confirmed event to see which venue it is in.
   * Setup:    Event 3 Confirmed; one APPROVED booking at Helix Hall. (Coordinator, Venue
   *           Staff and Organiser access is already tested in events.bookings.test.js.)
   * Expected: 200 with the venue name and booking status, read only for event 3.
   * Type:     normal
   */
  it('US39-V01 (AC2): the booked venue is returned with the event', async () => {
    const get = as([ROLES.TECHNICAL_SUPPORT]);
    fetchOne.mockResolvedValueOnce(eventRow({ status: 'CONFIRMED' }));
    fetchMany.mockResolvedValueOnce([{ id: 7, event_id: 3, venue_id: 8, status: 'APPROVED', venues: { name: 'Helix Hall' } }]);
    const res = await get('/api/events/3/venue-bookings');
    expect(res.status).toBe(200);
    expect(res.body.bookings).toEqual([{
      id: 7, event_id: 3, venue_id: 8, status: 'APPROVED', venue_name: 'Helix Hall',
      venue_details: { capacity: undefined, facilities: undefined, accessibility: undefined, layouts: [] },
    }]);
    expect(chain.eq).toHaveBeenCalledWith('event_id', 3);
  });

  /*
   * AC:       SCRUM-39 AC2 (venue)
   * Scenario: A booking whose venue record can't be found any more.
   * Setup:    Coordinator; event 3; one PENDING booking with venues null.
   * Expected: 200; the booking is still returned with venue_name null instead of failing,
   *           so the booking status stays visible.
   * Type:     boundary
   */
  it('US39-V02 (AC2): a booking without a venue record still comes back', async () => {
    const get = as([ROLES.EVENT_COORDINATOR]);
    fetchOne.mockResolvedValueOnce(eventRow());
    fetchMany.mockResolvedValueOnce([{ id: 9, event_id: 3, venue_id: 8, status: 'PENDING', venues: null }]);
    const res = await get('/api/events/3/venue-bookings');
    expect(res.status).toBe(200);
    expect(res.body.bookings).toEqual([{
      id: 9, event_id: 3, venue_id: 8, status: 'PENDING', venue_name: null, venue_details: null,
    }]);
  });
});

describe('SCRUM-39 GET /api/events/:id/equipment-requests (equipment, AC2)', () => {
  /*
   * AC:       SCRUM-39 AC2 (equipment requirement)
   * Scenario: A Coordinator opens a Planning event that has equipment requested.
   * Setup:    Event 3; two requests (2 projectors PENDING, 4 mics RESERVED), each row also
   *           carrying an internal decision reason.
   * Expected: 200 with item, quantity and status for each, read only for event 3, and no
   *           decision reason, which is internal to Technical Support.
   * Type:     normal
   */
  it('US39-E01 (AC2): lists the event equipment requests', async () => {
    const get = as([ROLES.EVENT_COORDINATOR]);
    fetchOne.mockResolvedValueOnce(eventRow());
    fetchMany.mockResolvedValueOnce([
      { id: 12, event_id: 3, equipment_id: 4, quantity: 2, status: 'PENDING', decision_reason: 'internal', equipment: { name: 'Projector' } },
      { id: 11, event_id: 3, equipment_id: 6, quantity: 4, status: 'RESERVED', decision_reason: 'internal', equipment: { name: 'Wireless mic' } },
    ]);
    const res = await get('/api/events/3/equipment-requests');
    expect(res.status).toBe(200);
    expect(res.body.requests).toEqual([
      { id: 12, event_id: 3, equipment_id: 4, equipment_name: 'Projector', quantity: 2, status: 'PENDING' },
      { id: 11, event_id: 3, equipment_id: 6, equipment_name: 'Wireless mic', quantity: 4, status: 'RESERVED' },
    ]);
    // Scoped in the database to this event, not filtered after reading everyone's requests.
    expect(supabase.from).toHaveBeenCalledWith('equipment_requests');
    expect(chain.eq).toHaveBeenCalledWith('event_id', 3);
  });

  /*
   * AC:       SCRUM-39 AC2
   * Scenario: An event with no equipment requested, and a request whose catalogue item was
   *           deleted.
   * Setup:    (a) no rows; (b) one row with equipment null (equipment_id set null on delete).
   * Expected: (a) an empty list; (b) the request is still listed, with equipment_name null,
   *           so a requirement never disappears just because the item record is gone.
   * Type:     boundary
   */
  it('US39-E02 (AC2): no requests gives an empty list; a deleted item keeps its request', async () => {
    let get = as([ROLES.VENUE_STAFF]);
    fetchOne.mockResolvedValueOnce(eventRow());
    fetchMany.mockResolvedValueOnce([]);
    expect((await get('/api/events/3/equipment-requests')).body.requests).toEqual([]);

    get = as([ROLES.VENUE_STAFF]);
    fetchOne.mockResolvedValueOnce(eventRow());
    fetchMany.mockResolvedValueOnce([{ id: 13, event_id: 3, equipment_id: null, quantity: 1, status: 'PENDING', equipment: null }]);
    expect((await get('/api/events/3/equipment-requests')).body.requests).toEqual([
      { id: 13, event_id: 3, equipment_id: null, equipment_name: null, quantity: 1, status: 'PENDING' },
    ]);
  });

  /*
   * AC:       SCRUM-39 AC1 (who is authorised)
   * Scenario: Users who may not see this event's planning details ask for its equipment.
   * Setup:    (a) an Organiser from organisation 20; (b) an Attendee on a Confirmed event.
   * Expected: (a) 404 and (b) 403, and in both cases the equipment table is never read,
   *           so another client's or an attendee's request leaks nothing.
   * Type:     error
   */
  it.each([
    ['an Organiser from another organisation', [ROLES.EVENT_ORGANISER], 20, 404],
    ['an Attendee', [ROLES.ATTENDEE], 10, 403],
  ])('US39-E03 (AC1): %s cannot read the equipment requests', async (_label, roles, organisationId, status) => {
    const get = as(roles, { organisationId });
    fetchOne.mockResolvedValueOnce(eventRow({ status: 'CONFIRMED' }));
    const res = await get('/api/events/3/equipment-requests');
    expect(res.status).toBe(status);
    expect(supabase.from).not.toHaveBeenCalledWith('equipment_requests');
  });
});

const { BOOKING_STATUS } = require('../src/constants/statuses');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  throwIf: jest.fn(),
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  updateById: jest.fn(),
}));

jest.mock('../src/services/audit.service', () => ({ writeAudit: jest.fn(), notifyUser: jest.fn() }));
jest.mock('../src/services/notifications.service', () => ({ notifyVenueStaff: jest.fn() }));

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

const request = require('supertest');
const { supabase, fetchMany } = require('../src/config/db');
const venuesService = require('../src/services/venues.service');
const { createApp } = require('../src/app');

const HALL = {
  id: 1,
  name: 'Helix Hall',
  location: 'ConnectSphere Campus, Level 2',
  capacity: 180,
  facilities: 'Projector, lecture capture, hearing loop, stage',
  accessibility: 'Wheelchair access, accessible washrooms, lift',
  operating_hours: '08:00-22:00',
  setup_minutes: 30,
  teardown_minutes: 45,
  is_active: true,
};

const BOARDROOM = {
  id: 2,
  name: 'Orchid Boardroom',
  location: 'ConnectSphere Campus, Level 8',
  capacity: 16,
  facilities: 'Video conferencing, whiteboard, catering pantry',
  accessibility: 'Wheelchair access, lift',
  operating_hours: '08:00-20:00',
  setup_minutes: 15,
  teardown_minutes: 15,
  is_active: true,
};

const LAYOUT_ROWS = [
  { venue_id: 1, layout: 'THEATRE' },
  { venue_id: 1, layout: 'CLASSROOM' },
  { venue_id: 2, layout: 'BOARDROOM' },
];

describe('SCRUM-23 computeOccupiedWindow / windowsOverlap', () => {
  // SCRUM-23-TC01
  it('pads start by setup minutes and end by teardown minutes (the Week 7 example)', () => {
    const { occupiedStart, occupiedEnd } = venuesService.computeOccupiedWindow(
      '2026-10-15T10:00:00Z',
      '2026-10-15T12:00:00Z',
      30,
      45
    );
    expect(occupiedStart.toISOString()).toBe('2026-10-15T09:30:00.000Z');
    expect(occupiedEnd.toISOString()).toBe('2026-10-15T12:45:00.000Z');
  });

  // SCRUM-23-TC02
  it('treats touching windows (end === start) as not overlapping', () => {
    const a = new Date('2026-10-15T09:00:00Z');
    const b = new Date('2026-10-15T10:00:00Z');
    const c = new Date('2026-10-15T11:00:00Z');
    expect(venuesService.windowsOverlap(a, b, b, c)).toBe(false);
  });

  // SCRUM-23-TC03
  it('detects a genuine overlap', () => {
    const a = new Date('2026-10-15T09:00:00Z');
    const b = new Date('2026-10-15T10:30:00Z');
    const c = new Date('2026-10-15T10:00:00Z');
    const d = new Date('2026-10-15T11:00:00Z');
    expect(venuesService.windowsOverlap(a, b, c, d)).toBe(true);
  });

  // SCRUM-23-TC15
  it('adds no padding when setup and turnaround are left out', () => {
    const { occupiedStart, occupiedEnd } = venuesService.computeOccupiedWindow(
      '2026-10-15T10:00:00Z',
      '2026-10-15T12:00:00Z'
    );
    expect(occupiedStart.toISOString()).toBe('2026-10-15T10:00:00.000Z');
    expect(occupiedEnd.toISOString()).toBe('2026-10-15T12:00:00.000Z');
  });
});

describe('SCRUM-23 searchVenues', () => {
  let chain;

  beforeEach(() => {
    jest.clearAllMocks();
    chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    supabase.from.mockReturnValue(chain);
  });

  function mockCatalogue(venues = [HALL, BOARDROOM], layouts = LAYOUT_ROWS) {
    fetchMany.mockResolvedValueOnce(venues).mockResolvedValueOnce(layouts);
  }

  // AC4-AC7
  // SCRUM-23-TC04
  it('filters by capacity, and only matching venues are returned', async () => {
    mockCatalogue();
    const result = await venuesService.searchVenues({ capacityMin: 100 });
    expect(result.map((v) => v.id)).toEqual([1]);
  });

  // SCRUM-23-TC05
  it('combines capacity, location, accessibility, layout and facilities filters (AND, strict)', async () => {
    mockCatalogue();
    const result = await venuesService.searchVenues({
      capacityMin: 50,
      location: 'Level 2',
      accessibility: 'Wheelchair access',
      layout: 'theatre',
      facilities: 'Projector',
    });
    expect(result.map((v) => v.id)).toEqual([1]);
  });

  // SCRUM-23-TC06
  it('returns an empty list when no venue matches every filter (AC8)', async () => {
    mockCatalogue();
    const result = await venuesService.searchVenues({ capacityMin: 9999 });
    expect(result).toEqual([]);
  });

  // SCRUM-23-TC07
  it('requires a required facility to actually be present, not just any filter value', async () => {
    mockCatalogue();
    const result = await venuesService.searchVenues({ facilities: 'Hot tub' });
    expect(result).toEqual([]);
  });

  // AC1 + AC2
  // SCRUM-23-TC08
  it('excludes a venue whose occupied window overlaps an APPROVED booking', async () => {
    mockCatalogue();
    fetchMany
      .mockResolvedValueOnce([
        { venue_id: 1, start_at: '2026-10-15T13:00:00Z', end_at: '2026-10-15T14:00:00Z', setup_minutes: 30, teardown_minutes: 45 },
      ])
      .mockResolvedValueOnce([]);

    // Hall occupies 9:30-12:45 for a 10:00-12:00 search; existing booking
    // occupies 12:15-14:45 once padded (13:00-30m, 14:00+45m) -> overlaps.
    const result = await venuesService.searchVenues({
      startAt: '2026-10-15T10:00:00Z',
      endAt: '2026-10-15T12:00:00Z',
    });
    expect(result.map((v) => v.id)).not.toContain(1);
    expect(result.map((v) => v.id)).toContain(2);
  });

  // SCRUM-23-TC09
  it('excludes a venue with an active TENTATIVE hold in the window', async () => {
    mockCatalogue();
    fetchMany
      .mockResolvedValueOnce([
        { venue_id: 2, start_at: '2026-10-15T10:00:00Z', end_at: '2026-10-15T11:00:00Z', setup_minutes: 15, teardown_minutes: 15 },
      ])
      .mockResolvedValueOnce([]);

    const result = await venuesService.searchVenues({
      startAt: '2026-10-15T10:30:00Z',
      endAt: '2026-10-15T12:00:00Z',
    });
    expect(result.map((v) => v.id)).not.toContain(2);
  });

  // SCRUM-23-TC10
  it('does not let a PENDING (undecided) booking hide a venue', async () => {
    mockCatalogue();
    fetchMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await venuesService.searchVenues({
      startAt: '2026-10-15T10:00:00Z',
      endAt: '2026-10-15T12:00:00Z',
    });

    const bookingsQueryCall = supabase.from.mock.calls.find(([table]) => table === 'venue_bookings');
    expect(bookingsQueryCall).toBeTruthy();
    expect(chain.in).toHaveBeenCalledWith('status', [BOOKING_STATUS.APPROVED, BOOKING_STATUS.TENTATIVE]);
  });

  // AC3
  // SCRUM-23-TC11
  it('excludes a venue with a recorded unavailability period overlapping the window', async () => {
    mockCatalogue();
    fetchMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { venue_id: 1, start_at: '2026-10-15T09:00:00Z', end_at: '2026-10-15T11:00:00Z' },
      ]);

    const result = await venuesService.searchVenues({
      startAt: '2026-10-15T10:00:00Z',
      endAt: '2026-10-15T12:00:00Z',
    });
    expect(result.map((v) => v.id)).not.toContain(1);
  });

  // AC9
  // SCRUM-23-TC12
  it('searching an existing booking\'s own window surfaces other available venues (replacement search)', async () => {
    mockCatalogue();
    fetchMany
      .mockResolvedValueOnce([
        { venue_id: 1, start_at: '2026-10-15T10:00:00Z', end_at: '2026-10-15T12:00:00Z', setup_minutes: 30, teardown_minutes: 45 },
      ])
      .mockResolvedValueOnce([]);

    const result = await venuesService.searchVenues({
      startAt: '2026-10-15T10:00:00Z',
      endAt: '2026-10-15T12:00:00Z',
    });
    expect(result.map((v) => v.id)).toEqual([2]);
  });

  // Validation
  // SCRUM-23-TC13
  it('rejects a one-sided date/time window', async () => {
    mockCatalogue();
    await expect(
      venuesService.searchVenues({ startAt: '2026-10-15T10:00:00Z' })
    ).rejects.toMatchObject({ status: 400 });
  });

  // SCRUM-23-TC14
  it('rejects endAt at or before startAt', async () => {
    mockCatalogue();
    await expect(
      venuesService.searchVenues({ startAt: '2026-10-15T12:00:00Z', endAt: '2026-10-15T10:00:00Z' })
    ).rejects.toMatchObject({ status: 400 });
  });

  // SCRUM-23-TC16
  it('returns every venue when no filters are given', async () => {
    fetchMany.mockReset();
    mockCatalogue();
    const result = await venuesService.searchVenues();
    expect(result.map((v) => v.id)).toEqual([1, 2]);
  });

  // SCRUM-23-TC17
  it('rejects a capacity that is not a number', async () => {
    await expect(venuesService.searchVenues({ capacityMin: 'abc' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(fetchMany).not.toHaveBeenCalled();
  });

  // SCRUM-23-TC18
  it('leaves out a venue missing a required accessibility feature', async () => {
    fetchMany.mockReset();
    mockCatalogue();
    const result = await venuesService.searchVenues({ accessibility: 'accessible washrooms' });
    expect(result.map((v) => v.id)).toEqual([1]);
  });

  // SCRUM-23-TC19
  it('accepts facilities as a list, and a venue with no facilities recorded does not match', async () => {
    fetchMany.mockReset();
    mockCatalogue([HALL, { ...BOARDROOM, facilities: null }]);
    const result = await venuesService.searchVenues({ facilities: ['projector', ' stage '] });
    expect(result.map((v) => v.id)).toEqual([1]);
  });
});

describe('SCRUM-23 GET /api/venues/search', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = undefined;
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    });
  });

  // SCRUM-23-TC20
  it('passes every filter in the query to the search and returns the matches', async () => {
    mockUser = { id: 2, roles: ['EVENT_COORDINATOR'] };
    fetchMany.mockReset();
    fetchMany.mockResolvedValueOnce([HALL, BOARDROOM]).mockResolvedValueOnce(LAYOUT_ROWS);
    const res = await request(app).get('/api/venues/search').query({
      capacityMin: 50,
      location: 'Level 2',
      accessibility: 'Wheelchair access',
      layout: 'theatre',
      facilities: 'Projector',
    });
    expect(res.status).toBe(200);
    expect(res.body.venues.map((v) => v.id)).toEqual([1]);
  });

  // SCRUM-23-TC21
  it('returns 400 for a bad capacity', async () => {
    mockUser = { id: 2, roles: ['EVENT_COORDINATOR'] };
    const res = await request(app).get('/api/venues/search').query({ capacityMin: 'abc' });
    expect(res.status).toBe(400);
  });
});

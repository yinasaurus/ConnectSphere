/**
 * SCRUM-66: View venue availability calendar.
 *
 *   AC1  Confirmed booking blocks start - setup to end + turnaround (10:00-12:00, 30/45 -> 09:30-12:45).
 *   AC2  Active tentative hold blocks its held period.
 *   AC3  Expired tentative hold is not marked unavailable.
 *   AC4  Recorded unavailability (e.g. maintenance) blocks its dates/times.
 *   AC5  Everything else in the range is available.
 *   AC6  Event Organisers and Attendees cannot access the view.
 *
 * The database is mocked: fetchOne returns the venue, the first fetchMany returns
 * bookings/holds and the second returns unavailability periods.
 */
const request = require('supertest');
const { ROLES } = require('../src/constants/roles');

let mockRoles = [];

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  updateById: jest.fn(),
}));

jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    requireAuth: (req, _res, next) => {
      req.user = { id: 999, isActive: true, roles: mockRoles, role: mockRoles[0] || null };
      next();
    },
  };
});

const { supabase, fetchOne, fetchMany } = require('../src/config/db');
const venuesService = require('../src/services/venues.service');
const { createApp } = require('../src/app');

const NOW = new Date('2026-10-15T00:00:00Z');
const RANGE = { from: '2026-10-20T08:00:00Z', to: '2026-10-20T14:00:00Z' };

function booking(overrides) {
  return {
    id: 1,
    status: 'APPROVED',
    start_at: '2026-10-20T10:00:00Z',
    end_at: '2026-10-20T12:00:00Z',
    setup_minutes: 30,
    teardown_minutes: 45,
    hold_expires_at: null,
    events: { name: 'Leadership Forum' },
    ...overrides,
  };
}

function mockData({ bookings = [], unavailability = [] } = {}) {
  fetchOne.mockResolvedValue({ id: 7, name: 'Helix Hall' });
  fetchMany.mockResolvedValueOnce(bookings).mockResolvedValueOnce(unavailability);
}

// Compact view of the timeline: [start HH:MM, end HH:MM, available, reason types].
function summary(result) {
  return result.periods.map((p) => [
    p.startAt.slice(11, 16),
    p.endAt.slice(11, 16),
    p.available,
    p.reasons.map((r) => r.type),
  ]);
}

let chain;
beforeEach(() => {
  jest.clearAllMocks();
  mockRoles = [];
  chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
  };
  supabase.from.mockReturnValue(chain);
});

describe('SCRUM-66 getVenueAvailability (service)', () => {
  it('US66-B01 (AC1): a confirmed 10:00-12:00 booking with 30/45 min marks 09:30-12:45 unavailable', async () => {
    mockData({ bookings: [booking()] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([
      ['08:00', '09:30', true, []],
      ['09:30', '12:45', false, ['BOOKING']],
      ['12:45', '14:00', true, []],
    ]);
    expect(result.periods[1].reasons[0]).toMatchObject({ id: 1, label: 'Leadership Forum' });
  });

  it('US66-B02 (AC1): setup/turnaround padding alone can reach into the range', async () => {
    // Booking ends 07:30, +45 min turnaround -> occupied until 08:15.
    mockData({ bookings: [booking({ start_at: '2026-10-20T06:00:00Z', end_at: '2026-10-20T07:30:00Z' })] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([
      ['08:00', '08:15', false, ['BOOKING']],
      ['08:15', '14:00', true, []],
    ]);
  });

  it('US66-B03 (AC2): an active tentative hold marks exactly its held period unavailable', async () => {
    mockData({ bookings: [booking({ status: 'TENTATIVE', hold_expires_at: '2026-10-16T00:00:00Z' })] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([
      ['08:00', '10:00', true, []],
      ['10:00', '12:00', false, ['TENTATIVE_HOLD']],
      ['12:00', '14:00', true, []],
    ]);
    expect(result.periods[1].reasons[0].expiresAt).toBe('2026-10-16T00:00:00Z');
  });

  it('US66-B04 (AC2): a tentative hold with no expiry recorded is treated as active', async () => {
    mockData({ bookings: [booking({ status: 'TENTATIVE', hold_expires_at: null })] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)[1]).toEqual(['10:00', '12:00', false, ['TENTATIVE_HOLD']]);
  });

  it.each([
    ['expired yesterday', '2026-10-14T00:00:00Z'],
    ['expiring exactly now (boundary)', NOW.toISOString()],
  ])('US66-B05 (AC3): a hold %s is not marked unavailable', async (_label, expiresAt) => {
    mockData({ bookings: [booking({ status: 'TENTATIVE', hold_expires_at: expiresAt })] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([['08:00', '14:00', true, []]]);
  });

  it('US66-B06 (AC4): a maintenance period is marked unavailable for its recorded times', async () => {
    mockData({
      unavailability: [{ id: 4, reason: 'Lighting rig maintenance', start_at: '2026-10-20T13:00:00Z', end_at: '2026-10-21T09:00:00Z' }],
    });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([
      ['08:00', '13:00', true, []],
      ['13:00', '14:00', false, ['UNAVAILABILITY']],
    ]);
    expect(result.periods[1].reasons[0]).toMatchObject({
      label: 'Lighting rig maintenance',
      startAt: '2026-10-20T13:00:00.000Z',
      endAt: '2026-10-21T09:00:00.000Z',
    });
  });

  it('US66-B07 (AC5): with nothing recorded the whole range is one available period', async () => {
    mockData();
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(result).toEqual({
      venue: { id: 7, name: 'Helix Hall' },
      from: '2026-10-20T08:00:00.000Z',
      to: '2026-10-20T14:00:00.000Z',
      periods: [{ startAt: '2026-10-20T08:00:00.000Z', endAt: '2026-10-20T14:00:00.000Z', available: true, reasons: [] }],
    });
  });

  it('US66-B08 (AC5): only confirmed bookings and tentative holds are queried as blocking', async () => {
    mockData();
    await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(chain.in).toHaveBeenCalledWith('status', ['APPROVED', 'TENTATIVE']);
  });

  it('US66-B09 (AC5): a row with another status is not marked even if returned', async () => {
    mockData({ bookings: [booking({ status: 'PENDING' })] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([['08:00', '14:00', true, []]]);
  });

  it('US66-B10 (AC1+AC2+AC4): overlapping blocks merge into one unavailable period listing every reason', async () => {
    mockData({
      bookings: [
        booking(),
        booking({ id: 2, status: 'TENTATIVE', start_at: '2026-10-20T12:30:00Z', end_at: '2026-10-20T13:00:00Z' }),
      ],
      unavailability: [{ id: 4, reason: 'Deep clean', start_at: '2026-10-20T13:00:00Z', end_at: '2026-10-20T13:30:00Z' }],
    });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([
      ['08:00', '09:30', true, []],
      ['09:30', '13:30', false, ['BOOKING', 'TENTATIVE_HOLD', 'UNAVAILABILITY']],
      ['13:30', '14:00', true, []],
    ]);
  });

  it('US66-B11 (AC5): a block that only touches the range edge leaves the range available', async () => {
    // Occupied 06:00-08:00 exactly (no padding); touching windows don't overlap.
    mockData({ bookings: [booking({ start_at: '2026-10-20T06:00:00Z', end_at: '2026-10-20T08:00:00Z', setup_minutes: 0, teardown_minutes: 0 })] });
    const result = await venuesService.getVenueAvailability(7, RANGE, NOW);
    expect(summary(result)).toEqual([['08:00', '14:00', true, []]]);
  });

  it.each([
    ['from is missing', { to: RANGE.to }, 'from and to are required'],
    ['to is missing', { from: RANGE.from }, 'from and to are required'],
    ['a date is invalid', { from: 'not-a-date', to: RANGE.to }, 'from and to must be valid dates'],
    ['from equals to', { from: RANGE.from, to: RANGE.from }, 'from must be before to'],
    ['from is after to', { from: RANGE.to, to: RANGE.from }, 'from must be before to'],
  ])('US66-B12: returns 400 when %s', async (_label, range, message) => {
    await expect(venuesService.getVenueAvailability(7, range, NOW)).rejects.toMatchObject({ status: 400, message });
    expect(fetchOne).not.toHaveBeenCalled();
  });

  it('US66-B13: returns 404 for an unknown venue', async () => {
    fetchOne.mockResolvedValue(null);
    await expect(venuesService.getVenueAvailability(99, RANGE, NOW)).rejects.toMatchObject({ status: 404 });
    expect(fetchMany).not.toHaveBeenCalled();
  });
});

describe('SCRUM-66 GET /api/venues/:id/availability (route)', () => {
  const app = createApp();
  const url = `/api/venues/7/availability?from=${RANGE.from}&to=${RANGE.to}`;

  beforeEach(() => {
    jest.spyOn(venuesService, 'getVenueAvailability').mockResolvedValue({ periods: [] });
  });

  afterEach(() => {
    venuesService.getVenueAvailability.mockRestore();
  });

  it.each([ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF, ROLES.TECHNICAL_SUPPORT])(
    'US66-R01: %s can view availability',
    async (role) => {
      mockRoles = [role];
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(venuesService.getVenueAvailability).toHaveBeenCalledWith('7', { from: RANGE.from, to: RANGE.to });
    }
  );

  it.each([ROLES.EVENT_ORGANISER, ROLES.ATTENDEE])('US66-R02 (AC6): %s is refused with 403', async (role) => {
    mockRoles = [role];
    const res = await request(app).get(url);
    expect(res.status).toBe(403);
    expect(venuesService.getVenueAvailability).not.toHaveBeenCalled();
  });
});

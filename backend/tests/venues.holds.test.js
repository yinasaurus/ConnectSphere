/**
 * SCRUM-75: Venue Staff place a tentative hold on a venue, with an expiry.
 *
 * Labels:
 *   US75-B..  service rules (venuesService.placeHold, findConflict, decideBooking)
 *   US75-R..  HTTP route POST /api/venues/holds and how holds affect POST /api/venues/bookings
 *
 * Times used below (all UTC):
 *   now                2026-11-05 09:00
 *   event              2026-11-20 10:00 to 12:00
 *   venue setup 30m, turnaround 45m  ->  occupied window 09:30 to 12:45
 */
const request = require('supertest');

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

const { supabase, fetchOne, fetchMany, insertOne, updateById } = require('../src/config/db');
const { writeAudit } = require('../src/services/audit.service');
const { ROLES } = require('../src/constants/roles');
const { BOOKING_STATUS } = require('../src/constants/statuses');
const venuesService = require('../src/services/venues.service');
const { createApp } = require('../src/app');

const STAFF = { id: 40, roles: [ROLES.VENUE_STAFF] };
const COORDINATOR = { id: 21, roles: [ROLES.EVENT_COORDINATOR] };

const NOW = new Date('2026-11-05T09:00:00.000Z');
const EVENT = {
  id: 50,
  name: 'Tech Talk',
  start_at: '2026-11-20T10:00:00.000Z',
  end_at: '2026-11-20T12:00:00.000Z',
  coordinator_id: 21,
};
const VENUE = { id: 8, name: 'Hall A', setup_minutes: 30, teardown_minutes: 45 };
const EXPIRES = '2026-11-18T09:00:00.000Z';

// An existing booking at Hall A for another event. Its own setup/turnaround are 0 so the
// tests can place its occupied window exactly where they need it.
function existing(status, startAt, endAt, extra = {}) {
  return {
    id: 70,
    event_id: 99,
    venue_id: 8,
    status,
    start_at: startAt,
    end_at: endAt,
    setup_minutes: 0,
    teardown_minutes: 0,
    ...extra,
  };
}

// fetchOne is called for the event first, then the venue.
function mockEventAndVenue(event = EVENT, venue = VENUE) {
  fetchOne.mockResolvedValueOnce(event).mockResolvedValueOnce(venue);
}

let query;
beforeEach(() => {
  jest.clearAllMocks();
  fetchOne.mockReset();
  fetchMany.mockReset().mockResolvedValue([]);
  query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  };
  supabase.from.mockReturnValue(query);
  insertOne.mockReset().mockImplementation(async (_table, row) => ({ id: 900, ...row }));
  updateById.mockReset().mockImplementation(async (_table, id, patch) => ({ id, ...patch }));
  writeAudit.mockResolvedValue();
  mockUser = undefined;
});

describe('SCRUM-75 place a hold (service rules)', () => {
  it('US75-B01: saves a Held booking for the event\'s date and time, linked to the event and its Coordinator', async () => {
    mockEventAndVenue();

    const hold = await venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW);

    expect(insertOne).toHaveBeenCalledWith('venue_bookings', {
      event_id: 50,
      venue_id: 8,
      requested_by: 40,
      status: BOOKING_STATUS.TENTATIVE,
      start_at: EVENT.start_at,
      end_at: EVENT.end_at,
      setup_minutes: 30,
      teardown_minutes: 45,
      hold_expires_at: EXPIRES,
    });
    expect(hold.status).toBe(BOOKING_STATUS.TENTATIVE);
    expect(hold.event_id).toBe(50);
    expect(hold.coordinator_id).toBe(21);
    expect(hold.hold_expires_at).toBe(EXPIRES);
  });

  it('US75-B02: writes a HOLD_PLACED audit entry', async () => {
    mockEventAndVenue();
    await venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW);
    expect(writeAudit).toHaveBeenCalledWith(40, 'HOLD_PLACED', 'venue_booking', 900, {
      eventId: 50,
      venueId: 8,
      expiresAt: EXPIRES,
    });
  });

  it('US75-B03: returns coordinator_id null when the event has no Coordinator yet', async () => {
    mockEventAndVenue({ ...EVENT, coordinator_id: null });
    const hold = await venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW);
    expect(hold.coordinator_id).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['blank', ''],
  ])('US75-B04: rejects a hold with a %s expiry and saves nothing', async (_label, expiresAt) => {
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt }, NOW)
    ).rejects.toMatchObject({ status: 400, code: 'HOLD_EXPIRY_REQUIRED' });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-B05: rejects an expiry that is not a real date', async () => {
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: 'next tuesday' }, NOW)
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-B06: rejects an expiry in the past and saves nothing', async () => {
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: '2026-11-04T09:00:00.000Z' }, NOW)
    ).rejects.toMatchObject({ status: 400, code: 'HOLD_EXPIRY_IN_PAST' });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-B07: rejects an expiry equal to now (it would already be expired)', async () => {
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: NOW.toISOString() }, NOW)
    ).rejects.toMatchObject({ status: 400, code: 'HOLD_EXPIRY_IN_PAST' });
  });

  it('US75-B08: accepts an expiry one minute from now', async () => {
    mockEventAndVenue();
    const hold = await venuesService.placeHold(
      STAFF,
      { eventId: 50, venueId: 8, expiresAt: '2026-11-05T09:01:00.000Z' },
      NOW
    );
    expect(hold.status).toBe(BOOKING_STATUS.TENTATIVE);
  });

  it('US75-B09: rejects an expiry later than the event start and saves nothing', async () => {
    mockEventAndVenue();
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: '2026-11-20T10:01:00.000Z' }, NOW)
    ).rejects.toMatchObject({ status: 400, code: 'HOLD_EXPIRY_AFTER_EVENT_START' });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-B10: accepts an expiry exactly at the event start', async () => {
    mockEventAndVenue();
    const hold = await venuesService.placeHold(
      STAFF,
      { eventId: 50, venueId: 8, expiresAt: EVENT.start_at },
      NOW
    );
    expect(hold.hold_expires_at).toBe(EVENT.start_at);
  });

  it('US75-B11: rejects a hold that overlaps a confirmed booking and saves nothing', async () => {
    mockEventAndVenue();
    fetchMany.mockResolvedValueOnce([
      existing(BOOKING_STATUS.APPROVED, '2026-11-20T11:00:00.000Z', '2026-11-20T14:00:00.000Z'),
    ]);
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW)
    ).rejects.toMatchObject({ status: 409, code: 'BOOKING_CONFLICT' });
    expect(insertOne).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('US75-B12: rejects a hold that overlaps another active hold', async () => {
    mockEventAndVenue();
    fetchMany.mockResolvedValueOnce([
      existing(BOOKING_STATUS.TENTATIVE, '2026-11-20T08:00:00.000Z', '2026-11-20T10:00:00.000Z', {
        hold_expires_at: '2026-11-19T00:00:00.000Z',
      }),
    ]);
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW)
    ).rejects.toMatchObject({ status: 409, code: 'BOOKING_CONFLICT' });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-B13: setup time counts: a booking ending 09:45 clashes with a hold occupied from 09:30', async () => {
    mockEventAndVenue();
    fetchMany.mockResolvedValueOnce([
      existing(BOOKING_STATUS.APPROVED, '2026-11-20T07:00:00.000Z', '2026-11-20T09:45:00.000Z'),
    ]);
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW)
    ).rejects.toMatchObject({ code: 'BOOKING_CONFLICT' });
  });

  it('US75-B14: turnaround counts: a booking starting 12:30 clashes with a hold occupied until 12:45', async () => {
    mockEventAndVenue();
    fetchMany.mockResolvedValueOnce([
      existing(BOOKING_STATUS.APPROVED, '2026-11-20T12:30:00.000Z', '2026-11-20T15:00:00.000Z'),
    ]);
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW)
    ).rejects.toMatchObject({ code: 'BOOKING_CONFLICT' });
  });

  it.each([
    ['ends exactly when the hold starts (09:30)', '2026-11-20T07:00:00.000Z', '2026-11-20T09:30:00.000Z'],
    ['starts exactly when the hold ends (12:45)', '2026-11-20T12:45:00.000Z', '2026-11-20T15:00:00.000Z'],
  ])('US75-B15: allows a hold next to a confirmed booking that %s', async (_label, startAt, endAt) => {
    mockEventAndVenue();
    fetchMany.mockResolvedValueOnce([existing(BOOKING_STATUS.APPROVED, startAt, endAt)]);
    const hold = await venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW);
    expect(hold.status).toBe(BOOKING_STATUS.TENTATIVE);
  });

  it('US75-B16: a pending request in the same window does not stop the hold', async () => {
    mockEventAndVenue();
    // Only confirmed bookings and holds are asked for, so a PENDING row is never returned.
    await venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW);
    expect(query.in).toHaveBeenCalledWith('status', [BOOKING_STATUS.APPROVED, BOOKING_STATUS.TENTATIVE]);
    expect(insertOne).toHaveBeenCalled();
  });

  it('US75-B17: an expired hold in the same window does not stop a new hold', async () => {
    mockEventAndVenue();
    fetchMany.mockResolvedValueOnce([
      existing(BOOKING_STATUS.TENTATIVE, '2026-11-20T10:00:00.000Z', '2026-11-20T12:00:00.000Z', {
        hold_expires_at: '2026-11-04T00:00:00.000Z',
      }),
    ]);
    const hold = await venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW);
    expect(hold.status).toBe(BOOKING_STATUS.TENTATIVE);
  });

  it.each([
    ['Coordinator', COORDINATOR],
    ['Coordinator Lead', { id: 22, roles: [ROLES.EVENT_COORDINATOR_LEAD] }],
    ['Organiser', { id: 5, roles: [ROLES.EVENT_ORGANISER] }],
    ['Attendee', { id: 30, roles: [ROLES.ATTENDEE] }],
  ])('US75-B18: a %s cannot place a hold and nothing is saved', async (_label, user) => {
    await expect(
      venuesService.placeHold(user, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW)
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(fetchOne).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-B19: 404 when the event does not exist', async () => {
    fetchOne.mockResolvedValueOnce(null);
    await expect(
      venuesService.placeHold(STAFF, { eventId: 404, venueId: 8, expiresAt: EXPIRES }, NOW)
    ).rejects.toMatchObject({ status: 404 });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-B20: 404 when the venue does not exist', async () => {
    mockEventAndVenue(EVENT, null);
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 404, expiresAt: EXPIRES }, NOW)
    ).rejects.toMatchObject({ status: 404 });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-B21: 400 when eventId or venueId is missing', async () => {
    await expect(
      venuesService.placeHold(STAFF, { venueId: 8, expiresAt: EXPIRES }, NOW)
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, expiresAt: EXPIRES }, NOW)
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });
});

describe('SCRUM-75 a Held booking blocks other events but is never confirmed', () => {
  const ACTIVE_HOLD = {
    id: 900,
    event_id: 50,
    venue_id: 8,
    status: BOOKING_STATUS.TENTATIVE,
    start_at: EVENT.start_at,
    end_at: EVENT.end_at,
    setup_minutes: 30,
    teardown_minutes: 45,
    hold_expires_at: EXPIRES,
  };

  it('US75-B22: findConflict reports the hold to another event\'s overlapping request', async () => {
    fetchMany.mockResolvedValueOnce([ACTIVE_HOLD]);
    const conflict = await venuesService.findConflict(
      8, '2026-11-20T12:00:00.000Z', '2026-11-20T14:00:00.000Z', 0, 0,
      { confirmedOnly: true, ownEventId: 77, now: NOW }
    );
    expect(conflict).toMatchObject({ id: 900 });
  });

  it.each([
    ['ends exactly when the hold\'s occupied window starts', '2026-11-20T07:00:00.000Z', '2026-11-20T09:30:00.000Z'],
    ['starts exactly when the hold\'s occupied window ends', '2026-11-20T12:45:00.000Z', '2026-11-20T15:00:00.000Z'],
  ])('US75-B23: a request that %s is not blocked', async (_label, startAt, endAt) => {
    fetchMany.mockResolvedValueOnce([ACTIVE_HOLD]);
    const conflict = await venuesService.findConflict(8, startAt, endAt, 0, 0, {
      confirmedOnly: true, ownEventId: 77, now: NOW,
    });
    expect(conflict).toBeNull();
  });

  it('US75-B24: the held event\'s own request is not blocked by its own hold', async () => {
    fetchMany.mockResolvedValueOnce([ACTIVE_HOLD]);
    const conflict = await venuesService.findConflict(
      8, EVENT.start_at, EVENT.end_at, 30, 45,
      { confirmedOnly: true, ownEventId: 50, now: NOW }
    );
    expect(conflict).toBeNull();
  });

  it('US75-B25: Venue Staff cannot approve a Held booking as if it were a request', async () => {
    fetchOne.mockResolvedValueOnce(ACTIVE_HOLD);
    await expect(
      venuesService.decideBooking(STAFF, 900, { approve: true })
    ).rejects.toMatchObject({ status: 409, code: 'ALREADY_DECIDED' });
    expect(updateById).not.toHaveBeenCalled();
  });

  it('US75-B26: Venue Staff cannot approve another event\'s request over an active hold', async () => {
    const pending = { ...ACTIVE_HOLD, id: 901, event_id: 77, status: BOOKING_STATUS.PENDING, hold_expires_at: null };
    fetchOne.mockResolvedValueOnce(pending);
    fetchMany.mockResolvedValueOnce([ACTIVE_HOLD]);
    await expect(
      venuesService.decideBooking(STAFF, 901, { approve: true })
    ).rejects.toMatchObject({ status: 409, code: 'BOOKING_CONFLICT' });
    expect(updateById).not.toHaveBeenCalled();
  });

  it('US75-B27: Venue Staff can approve the held event\'s own request for the held venue', async () => {
    const pending = { ...ACTIVE_HOLD, id: 902, status: BOOKING_STATUS.PENDING, hold_expires_at: null };
    fetchOne.mockResolvedValueOnce(pending).mockResolvedValueOnce({ ...EVENT, coordinator_id: null });
    fetchMany.mockResolvedValueOnce([ACTIVE_HOLD]);
    const updated = await venuesService.decideBooking(STAFF, 902, { approve: true });
    expect(updated.status).toBe(BOOKING_STATUS.APPROVED);
  });

  it('US75-B28: the hold is never stored as APPROVED', async () => {
    mockEventAndVenue();
    await venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW);
    const saved = insertOne.mock.calls[0][1];
    expect(saved.status).not.toBe(BOOKING_STATUS.APPROVED);
    expect(saved.decided_at).toBeUndefined();
  });
});

describe('SCRUM-75 edge cases and defaults', () => {
  it('US75-B29: rejects a hold for an event with no start or end time and saves nothing', async () => {
    fetchOne.mockResolvedValueOnce({ ...EVENT, start_at: null });
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW)
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    fetchOne.mockResolvedValueOnce({ ...EVENT, end_at: null });
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW)
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-B30: uses 30 minutes setup and turnaround when the venue has none recorded', async () => {
    mockEventAndVenue(EVENT, { ...VENUE, setup_minutes: null, teardown_minutes: null });
    await venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW);
    expect(insertOne.mock.calls[0][1]).toMatchObject({ setup_minutes: 30, teardown_minutes: 30 });
  });

  it('US75-B31: keeps a venue setup and turnaround of 0 (no padding)', async () => {
    mockEventAndVenue(EVENT, { ...VENUE, setup_minutes: 0, teardown_minutes: 0 });
    await venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: EXPIRES }, NOW);
    expect(insertOne.mock.calls[0][1]).toMatchObject({ setup_minutes: 0, teardown_minutes: 0 });
  });

  it('US75-B32: with no body at all the request is rejected with 400', async () => {
    await expect(venuesService.placeHold(STAFF)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('US75-B33: uses the real clock when no time is passed in', async () => {
    mockEventAndVenue({ ...EVENT, start_at: '2099-11-20T10:00:00.000Z', end_at: '2099-11-20T12:00:00.000Z' });
    const hold = await venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: '2099-11-18T09:00:00.000Z' });
    expect(hold.status).toBe(BOOKING_STATUS.TENTATIVE);
    await expect(
      venuesService.placeHold(STAFF, { eventId: 50, venueId: 8, expiresAt: '2000-01-01T00:00:00.000Z' })
    ).rejects.toMatchObject({ code: 'HOLD_EXPIRY_IN_PAST' });
  });

  it('US75-B34: without options, findConflict still checks holds (and pending requests)', async () => {
    fetchMany.mockResolvedValueOnce([
      existing(BOOKING_STATUS.TENTATIVE, '2099-11-20T10:00:00.000Z', '2099-11-20T12:00:00.000Z', {
        hold_expires_at: '2099-11-19T00:00:00.000Z',
      }),
    ]);
    const conflict = await venuesService.findConflict(8, '2099-11-20T11:00:00.000Z', '2099-11-20T13:00:00.000Z');
    expect(conflict).toMatchObject({ id: 70 });
    expect(query.in).toHaveBeenCalledWith('status', [
      BOOKING_STATUS.PENDING,
      BOOKING_STATUS.TENTATIVE,
      BOOKING_STATUS.APPROVED,
    ]);
  });

  it('US75-B35: the bookings list includes a hold\'s expiry, and null for other bookings', async () => {
    fetchMany.mockResolvedValueOnce([
      existing(BOOKING_STATUS.TENTATIVE, EVENT.start_at, EVENT.end_at, { id: 900, hold_expires_at: EXPIRES }),
      existing(BOOKING_STATUS.APPROVED, '2026-12-01T10:00:00.000Z', '2026-12-01T12:00:00.000Z', { id: 901 }),
    ]);
    const rows = await venuesService.listBookings();
    expect(rows.find((row) => row.id === 900).hold_expires_at).toBe(EXPIRES);
    expect(rows.find((row) => row.id === 901).hold_expires_at).toBeNull();
  });
});

describe('SCRUM-75 HTTP routes', () => {
  const app = createApp();

  // Real-clock tests: use times far in the future so "now" never catches up with them.
  const FUTURE_EVENT = { ...EVENT, start_at: '2099-11-20T10:00:00.000Z', end_at: '2099-11-20T12:00:00.000Z' };
  const FUTURE_EXPIRES = '2099-11-18T09:00:00.000Z';

  it('US75-R01: Venue Staff get 201 with the Held booking', async () => {
    mockUser = STAFF;
    mockEventAndVenue(FUTURE_EVENT);
    const res = await request(app)
      .post('/api/venues/holds')
      .send({ eventId: 50, venueId: 8, expiresAt: FUTURE_EXPIRES });
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({
      status: BOOKING_STATUS.TENTATIVE,
      event_id: 50,
      coordinator_id: 21,
      hold_expires_at: FUTURE_EXPIRES,
    });
  });

  it('US75-R02: 400 HOLD_EXPIRY_REQUIRED when expiresAt is left out', async () => {
    mockUser = STAFF;
    const res = await request(app).post('/api/venues/holds').send({ eventId: 50, venueId: 8 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('HOLD_EXPIRY_REQUIRED');
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-R03: 409 BOOKING_CONFLICT when the window is already confirmed', async () => {
    mockUser = STAFF;
    mockEventAndVenue(FUTURE_EVENT);
    fetchMany.mockResolvedValueOnce([
      existing(BOOKING_STATUS.APPROVED, '2099-11-20T11:00:00.000Z', '2099-11-20T13:00:00.000Z'),
    ]);
    const res = await request(app)
      .post('/api/venues/holds')
      .send({ eventId: 50, venueId: 8, expiresAt: FUTURE_EXPIRES });
    expect(res.status).toBe(409);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-R04: a Coordinator gets 403 and nothing is saved', async () => {
    mockUser = COORDINATOR;
    const res = await request(app)
      .post('/api/venues/holds')
      .send({ eventId: 50, venueId: 8, expiresAt: FUTURE_EXPIRES });
    expect(res.status).toBe(403);
    expect(fetchOne).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-R05: signed out gets 401', async () => {
    const res = await request(app)
      .post('/api/venues/holds')
      .send({ eventId: 50, venueId: 8, expiresAt: FUTURE_EXPIRES });
    expect(res.status).toBe(401);
  });

  it('US75-R06: another event\'s booking request over an active hold gets 409', async () => {
    mockUser = COORDINATOR;
    fetchMany.mockResolvedValueOnce([{
      id: 900,
      event_id: 50,
      venue_id: 8,
      status: BOOKING_STATUS.TENTATIVE,
      start_at: FUTURE_EVENT.start_at,
      end_at: FUTURE_EVENT.end_at,
      setup_minutes: 30,
      teardown_minutes: 45,
      hold_expires_at: FUTURE_EXPIRES,
    }]);
    const res = await request(app).post('/api/venues/bookings').send({
      eventId: 77,
      venueId: 8,
      startAt: '2099-11-20T11:00:00.000Z',
      endAt: '2099-11-20T13:00:00.000Z',
      setupMinutes: 0,
      teardownMinutes: 0,
    });
    expect(res.status).toBe(409);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('US75-R07: the held event\'s own Coordinator can still request the held venue', async () => {
    mockUser = COORDINATOR;
    fetchMany.mockResolvedValueOnce([{
      id: 900,
      event_id: 50,
      venue_id: 8,
      status: BOOKING_STATUS.TENTATIVE,
      start_at: FUTURE_EVENT.start_at,
      end_at: FUTURE_EVENT.end_at,
      setup_minutes: 30,
      teardown_minutes: 45,
      hold_expires_at: FUTURE_EXPIRES,
    }]);
    fetchOne.mockResolvedValue(null);
    const res = await request(app).post('/api/venues/bookings').send({
      eventId: 50,
      venueId: 8,
      startAt: FUTURE_EVENT.start_at,
      endAt: FUTURE_EVENT.end_at,
      setupMinutes: 30,
      teardownMinutes: 45,
    });
    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe(BOOKING_STATUS.PENDING);
  });
});

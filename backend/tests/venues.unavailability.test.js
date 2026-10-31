/**
 * SCRUM-72: Venue Staff record a venue unavailability period, with a reason.
 *
 *   AC1  Venue Staff can record a period with start, end, reason.
 *   AC2  Period cannot be saved if start, end or reason is missing.
 *   AC3  Period cannot be saved if end is not after start.
 *   AC4  Period can be saved even when existing bookings overlap it.
 *   AC5  Saving the period does not cancel, delete or change any existing event or booking.
 *   AC6  Once recorded, the occupied window check (SCRUM-66/59) treats an overlapping
 *        window as unavailable.
 *   AC7  An occupied window that only touches the period's edge does not overlap it.
 *   AC8  A user who is not Venue Staff cannot record a period; nothing is saved.
 *
 * Labels:
 *   US72-B..  service rules (venuesService.blockVenue)
 *   US72-R..  HTTP route (auth cookie + service)
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  insertOne: jest.fn(),
  updateById: jest.fn(),
}));

const { supabase, fetchOne, fetchMany, insertOne, updateById } = require('../src/config/db');
const venuesService = require('../src/services/venues.service');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

const venueStaff = { id: 5, roles: [ROLES.VENUE_STAFF] };
const organiser = { id: 1, roles: [ROLES.EVENT_ORGANISER] };

function period(overrides = {}) {
  return {
    venueId: 7,
    startAt: '2026-11-01T09:00:00Z',
    endAt: '2026-11-01T17:00:00Z',
    reason: 'Maintenance',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  insertOne.mockImplementation(async (table, row) => ({ id: 50, ...row }));
  updateById.mockImplementation(async (table, id, patch) => ({ id, ...patch }));
  supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  });
});

describe('SCRUM-72 record venue unavailability (service rules)', () => {
  /*
   * AC:       SCRUM-72 (AC1: Venue Staff can record a period with start, end, reason)
   * Scenario: Venue Staff records a period with every required field.
   * Setup:    venueId, startAt, endAt and reason all provided.
   * Expected: insertOne is called with those fields; the inserted row is returned.
   * Type:     normal
   */
  // SCRUM-72-TC01
  it('US72-B01: Venue Staff can record a period with start, end and reason', async () => {
    const result = await venuesService.blockVenue(venueStaff, period());

    expect(insertOne).toHaveBeenCalledWith('venue_unavailability', expect.objectContaining({
      venue_id: 7,
      start_at: '2026-11-01T09:00:00Z',
      end_at: '2026-11-01T17:00:00Z',
      reason: 'Maintenance',
      created_by: 5,
    }));
    expect(result.id).toBe(50);
  });

  /*
   * AC:       SCRUM-72 (AC1: reason can be any of maintenance/equipment failure/renovation/
   *           safety concerns/other — free text, not a closed enum)
   * Scenario: Venue Staff records a period with each of the example reasons.
   * Setup:    reason set to each of the AC's named examples in turn.
   * Expected: insertOne is called with that exact reason text each time.
   * Type:     normal
   */
  // SCRUM-72-TC02
  it.each([
    'Maintenance',
    'Equipment failure',
    'Renovation',
    'Safety concerns',
    'Other',
  ])('US72-B02: accepts reason "%s"', async (reason) => {
    await venuesService.blockVenue(venueStaff, period({ reason }));
    expect(insertOne).toHaveBeenCalledWith('venue_unavailability', expect.objectContaining({ reason }));
  });

  /*
   * AC:       SCRUM-72 (AC2: cannot be saved if start, end or reason is missing)
   * Scenario: Venue Staff submits a period missing one required field at a time.
   * Setup:    startAt, endAt and reason each set to undefined in turn.
   * Expected: Rejected with 400 VALIDATION_ERROR; insertOne is never called.
   * Type:     error
   */
  // SCRUM-72-TC03
  it.each([
    ['startAt', { startAt: undefined }],
    ['endAt', { endAt: undefined }],
    ['reason', { reason: undefined }],
  ])('US72-B03: rejects a period missing %s', async (_label, overrides) => {
    await expect(venuesService.blockVenue(venueStaff, period(overrides)))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-72 (AC2: a blank reason counts as missing, not a valid value)
   * Scenario: Venue Staff submits a period with reason set to an empty/whitespace string.
   * Setup:    reason is '' and '   '.
   * Expected: Rejected with 400 VALIDATION_ERROR; insertOne is never called.
   * Type:     boundary
   */
  // SCRUM-72-TC04
  it.each(['', '   '])('US72-B04: rejects a blank reason %p', async (reason) => {
    await expect(venuesService.blockVenue(venueStaff, period({ reason })))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-72 (AC3: cannot be saved if end is not after start)
   * Scenario: Venue Staff submits a period where end equals start, and where end is before start.
   * Setup:    endAt set equal to startAt, then earlier than startAt.
   * Expected: Rejected with 400 VALIDATION_ERROR; insertOne is never called.
   * Type:     boundary
   */
  // SCRUM-72-TC05
  it.each([
    ['equal to start', '2026-11-01T09:00:00Z'],
    ['before start', '2026-11-01T08:00:00Z'],
  ])('US72-B05: rejects end %s', async (_label, endAt) => {
    await expect(venuesService.blockVenue(venueStaff, period({ endAt })))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-72 (AC4: the period can be saved even when existing bookings overlap it)
   * Scenario: Venue Staff records a period without the service checking for existing
   *           bookings at all — recording is unconditional on booking state.
   * Setup:    A normal, valid period payload. (No booking lookup exists to stub — the
   *           absence of one is exactly what this test is confirming.)
   * Expected: insertOne is called; the save succeeds with no booking-overlap check in the way.
   * Type:     normal
   */
  // SCRUM-72-TC06
  it('US72-B06: the period is saved without any booking-overlap check blocking it', async () => {
    await venuesService.blockVenue(venueStaff, period());
    expect(insertOne).toHaveBeenCalled();
    // Confirms blockVenue never queries venue_bookings before saving.
    expect(fetchMany).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-72 (AC5: saving does not cancel, delete or change any existing event
   *           or booking)
   * Scenario: Venue Staff records a period.
   * Setup:    A normal, valid period payload.
   * Expected: updateById is never called — nothing existing is touched by this save.
   * Type:     normal
   */
  // SCRUM-72-TC07
  it('US72-B07: recording a period never updates an existing event or booking row', async () => {
    await venuesService.blockVenue(venueStaff, period());
    expect(updateById).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-72 (AC6/AC7: once recorded, the occupied-window overlap check treats
   *           an overlapping window as unavailable, and a touching-edge window as available)
   * Scenario: A period is recorded for 10:00-12:00. A venue-availability check is then run
   *           for a window that overlaps it, and for one that only touches its edge.
   * Setup:    blockVenue() records 10:00-12:00 with no setup/teardown padding (padding on
   *           the checking side is applied separately, per SCRUM-66/59). The subsequent
   *           getVenueAvailability() call sees that same period via the mocked fetchMany.
   * Expected: The 10:00-12:00 slot is unavailable; a 08:00-10:00 slot (ending exactly when
   *           the period starts) is available.
   * Type:     normal
   */
  // SCRUM-72-TC08
  it('US72-B08: a recorded period makes an overlapping window unavailable, but a touching one available', async () => {
    const recorded = await venuesService.blockVenue(venueStaff, period({
      startAt: '2026-11-01T10:00:00Z',
      endAt: '2026-11-01T12:00:00Z',
    }));

    fetchOne.mockResolvedValueOnce({ id: 7, name: 'Helix Hall' });
    fetchMany
      .mockResolvedValueOnce([]) // no bookings
      .mockResolvedValueOnce([{ id: recorded.id, reason: 'Maintenance', start_at: recorded.start_at, end_at: recorded.end_at }]);

    const overlapping = await venuesService.getVenueAvailability(
      7,
      { from: '2026-11-01T09:00:00Z', to: '2026-11-01T13:00:00Z' },
      new Date('2026-10-20T00:00:00Z')
    );
    const unavailablePeriod = overlapping.periods.find((p) => !p.available);
    expect(unavailablePeriod).toBeDefined();
    expect(unavailablePeriod.reasons[0]).toMatchObject({ type: 'UNAVAILABILITY' });

    fetchOne.mockResolvedValueOnce({ id: 7, name: 'Helix Hall' });
    fetchMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // the 08:00-10:00 check window never reaches the period at all

    const touching = await venuesService.getVenueAvailability(
      7,
      { from: '2026-11-01T08:00:00Z', to: '2026-11-01T10:00:00Z' },
      new Date('2026-10-20T00:00:00Z')
    );
    expect(touching.periods.every((p) => p.available)).toBe(true);
  });

  /*
   * AC:       SCRUM-72 (AC8: a user who is not Venue Staff cannot record a period;
   *           nothing is saved)
   * Scenario: An Organiser (not Venue Staff) tries to record a period.
   * Setup:    Caller holds only the EVENT_ORGANISER role.
   * Expected: Rejected with 403 FORBIDDEN; insertOne is never called.
   * Type:     error
   */
  // SCRUM-72-TC09
  it('US72-B09: a user who is not Venue Staff cannot record a period', async () => {
    await expect(venuesService.blockVenue(organiser, period()))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(insertOne).not.toHaveBeenCalled();
  });
});

describe('SCRUM-72 record venue unavailability route', () => {
  const { createApp } = require('../src/app');
  const app = createApp();

  function cookieFor(userId) {
    const token = jwt.sign({ sub: userId }, env.jwtSecret);
    return `${env.sessionCookieName}=${token}`;
  }

  /*
   * AC:       SCRUM-72 (AC1: recording a period works through the real HTTP route)
   * Scenario: Venue Staff records a period through the real route.
   * Setup:    Venue Staff is signed in with a valid session cookie.
   * Expected: 201 with the saved unavailability row in the body.
   * Type:     normal
   */
  // SCRUM-72-TC10
  it('US72-R01: Venue Staff can record a period through the API', async () => {
    fetchOne.mockResolvedValueOnce({ id: 5, is_active: true }); // auth: the signed-in user
    fetchMany.mockResolvedValueOnce([{ role: ROLES.VENUE_STAFF }]); // auth: their roles

    const res = await request(app)
      .post('/api/venues/unavailability')
      .set('Cookie', cookieFor(5))
      .send(period());

    expect(res.status).toBe(201);
    expect(res.body.unavailability).toMatchObject({ venue_id: 7, reason: 'Maintenance' });
  });

  /*
   * AC:       SCRUM-72 (AC8: non-Venue-Staff rejected — route level)
   * Scenario: An Organiser hits the real route.
   * Setup:    Signed in as an Organiser, not Venue Staff.
   * Expected: 403, through the real role middleware; nothing saved.
   * Type:     error
   */
  // SCRUM-72-TC11
  it('US72-R02: a non-Venue-Staff user gets 403 through the API', async () => {
    fetchOne.mockResolvedValueOnce({ id: 1, is_active: true });
    fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_ORGANISER }]);

    const res = await request(app)
      .post('/api/venues/unavailability')
      .set('Cookie', cookieFor(1))
      .send(period());

    expect(res.status).toBe(403);
    expect(insertOne).not.toHaveBeenCalled();
  });

    /*
    * AC:       SCRUM-72 (the route requires authentication)
    * Scenario: An unauthenticated request hits the real route.
    * Setup:    No session cookie is sent.
    * Expected: 401, before the service or database is reached.
    * Type:     error
    */
  // SCRUM-72-TC12
  it('US72-R03: the route needs a signed-in user', async () => {
    const res = await request(app).post('/api/venues/unavailability').send(period());
    expect(res.status).toBe(401);
  });
});

/**
 * SCRUM-78: notify the assigned Event Coordinator when Venue Staff decide a booking request.
 *
 *   AC1  Approval: the Coordinator assigned to the event is notified.
 *   AC2  Rejection: the Coordinator is notified, with the reason or information staff gave.
 *   AC3  Rejection with no reason: the notice is still sent and shows no reason.
 *   AC4  Each notice identifies the event and the venue.
 *   AC5  Only the assigned Coordinator is notified (not other Coordinators, the deciding
 *        Venue Staff member or unrelated users).
 *   AC6  No notice while the request is still pending.
 *
 * Decisions agreed before building: the rejection notice carries both the reason and the
 * suggested alternative, each only if given; a hybrid user who is both the assigned
 * Coordinator and the deciding Venue Staff member is still notified; an event with no
 * Coordinator gets no notice.
 *
 * Only the database is mocked. The real notifyUser (audit.service) runs, so the tests check
 * the exact row written to the notifications table.
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

const { supabase, fetchOne, fetchMany, insertOne, updateById } = require('../src/config/db');
const venuesService = require('../src/services/venues.service');
const { createApp } = require('../src/app');

const STAFF = { id: 40, roles: [ROLES.VENUE_STAFF] };
const BOOKING = { id: 5, event_id: 50, venue_id: 8, requested_by: 30, status: 'PENDING' };
const EVENT = { id: 50, name: 'Leadership Forum', coordinator_id: 21 };
const VENUE = { id: 8, name: 'Helix Hall' };

// decideBooking looks up, in order: the booking, then the event, then the venue.
function mockLookups({ booking = BOOKING, event = EVENT, venue = VENUE } = {}) {
  fetchOne
    .mockResolvedValueOnce(booking)
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce(venue);
}

function notificationRows() {
  return insertOne.mock.calls.filter(([table]) => table === 'notifications').map(([, row]) => row);
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchOne.mockReset();
  fetchMany.mockReset();
  const chain = {};
  ['select', 'eq', 'in', 'lt', 'gt', 'limit'].forEach((method) => {
    chain[method] = jest.fn(() => chain);
  });
  supabase.from.mockReturnValue(chain);
  updateById.mockImplementation(async (_table, id, patch) => ({ id, ...patch }));
  insertOne.mockImplementation(async (_table, row) => ({ id: 900, ...row }));
});

describe('SCRUM-78 booking decision notice (decideBooking)', () => {
  /*
   * AC:       SCRUM-78 AC1 + AC4
   * Scenario: Venue Staff approve the pending booking for Leadership Forum at Helix Hall.
   * Setup:    Event 50 has Coordinator 21; booking 5 is for venue 8 (Helix Hall).
   * Expected: Exactly one notice, to user 21, linked to event 50, saying the request for
   *           Leadership Forum at Helix Hall was approved, so the Coordinator can go ahead.
   * Type:     normal
   */
  it('US78-N01 (AC1+AC4): approving notifies the assigned Coordinator, naming event and venue', async () => {
    mockLookups();
    await venuesService.decideBooking(STAFF, 5, { approve: true });
    expect(notificationRows()).toEqual([{
      user_id: 21,
      event_id: 50,
      type: 'BOOKING_DECISION',
      title: 'Venue booking approved',
      body: 'The venue booking request for Leadership Forum at Helix Hall was approved.',
    }]);
  });

  /*
   * AC:       SCRUM-78 AC2 + AC4
   * Scenario: Venue Staff reject, giving a reason and suggesting another venue.
   * Setup:    Reason "Stage under repair", suggested alternative "Orchid Room".
   * Expected: One notice to Coordinator 21 that names the event and venue and includes both
   *           pieces of information staff gave, so they can arrange the alternative.
   * Type:     normal
   */
  it('US78-N02 (AC2+AC4): rejecting includes the reason and the suggested alternative', async () => {
    mockLookups();
    await venuesService.decideBooking(STAFF, 5, {
      approve: false, reason: 'Stage under repair', alternativeSuggestion: 'Orchid Room',
    });
    expect(notificationRows()).toEqual([expect.objectContaining({
      user_id: 21,
      title: 'Venue booking rejected',
      body: 'The venue booking request for Leadership Forum at Helix Hall was rejected.'
        + ' Reason: Stage under repair Suggested alternative: Orchid Room',
    })]);
  });

  /*
   * AC:       SCRUM-78 AC2
   * Scenario: Venue Staff reject with a reason but no alternative (the alternative is
   *           optional, Week 4 Q&A).
   * Setup:    Reason "Double-booked by facilities", no alternativeSuggestion.
   * Expected: The reason is included and there is no "Suggested alternative" text, so the
   *           Coordinator isn't shown an empty field.
   * Type:     boundary
   */
  it('US78-N03 (AC2): a reason without an alternative shows only the reason', async () => {
    mockLookups();
    await venuesService.decideBooking(STAFF, 5, { approve: false, reason: 'Double-booked by facilities' });
    const [row] = notificationRows();
    expect(row.body).toBe('The venue booking request for Leadership Forum at Helix Hall was rejected.'
      + ' Reason: Double-booked by facilities');
  });

  /*
   * AC:       SCRUM-78 AC3
   * Scenario: Venue Staff reject without giving a reason.
   * Setup:    The reason is missing, null, empty or only spaces (what a blank text box sends).
   * Expected: The notice is still sent to Coordinator 21 and shows no reason at all: just
   *           the event, the venue and the outcome.
   * Type:     boundary
   */
  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['only spaces', '   '],
  ])('US78-N04 (AC3): a %s reason still sends the notice, with no reason shown', async (_label, reason) => {
    mockLookups();
    await venuesService.decideBooking(STAFF, 5, { approve: false, reason });
    expect(notificationRows()).toEqual([expect.objectContaining({
      user_id: 21,
      body: 'The venue booking request for Leadership Forum at Helix Hall was rejected.',
    })]);
  });

  /*
   * AC:       SCRUM-78 AC2 + AC3
   * Scenario: Venue Staff reject with no reason but do suggest an alternative.
   * Setup:    reason blank, alternativeSuggestion "Orchid Room".
   * Expected: No reason is shown (AC3) but the alternative is, because it is information
   *           staff gave (AC2).
   * Type:     boundary
   */
  it('US78-N05 (AC2+AC3): an alternative with no reason shows the alternative only', async () => {
    mockLookups();
    await venuesService.decideBooking(STAFF, 5, { approve: false, reason: '', alternativeSuggestion: 'Orchid Room' });
    const [row] = notificationRows();
    expect(row.body).toBe('The venue booking request for Leadership Forum at Helix Hall was rejected.'
      + ' Suggested alternative: Orchid Room');
    expect(row.body).not.toContain('Reason');
  });

  /*
   * AC:       SCRUM-78 AC1
   * Scenario: Venue Staff approve and type a note.
   * Setup:    approve true with reason "Approved, use the side entrance".
   * Expected: The approval notice is sent with the standard approval text. The reason line
   *           is only part of rejection notices (AC2), so the note is not added here.
   * Type:     boundary
   */
  it('US78-N06 (AC1): an approval notice does not carry a reason line', async () => {
    mockLookups();
    await venuesService.decideBooking(STAFF, 5, { approve: true, reason: 'Approved, use the side entrance' });
    const [row] = notificationRows();
    expect(row.body).toBe('The venue booking request for Leadership Forum at Helix Hall was approved.');
  });

  /*
   * AC:       SCRUM-78 AC4
   * Scenario: The venue record can't be found (for example it was deleted after the request).
   * Setup:    The venue lookup returns null for venue 8.
   * Expected: The notice is still sent and still identifies the venue, by its id ("venue #8"),
   *           and the event; a missing name must not stop the Coordinator hearing back.
   * Type:     error
   */
  it('US78-N07 (AC4): a missing venue record is identified by its id', async () => {
    mockLookups({ venue: null });
    await venuesService.decideBooking(STAFF, 5, { approve: true });
    const [row] = notificationRows();
    expect(row.body).toBe('The venue booking request for Leadership Forum at venue #8 was approved.');
    expect(row.event_id).toBe(50);
  });

  /*
   * AC:       SCRUM-78 AC5
   * Scenario: The request was sent by Coordinator 30, but the event has since been
   *           reassigned to Coordinator 21. Venue Staff member 40 decides it.
   * Setup:    booking.requested_by 30, event.coordinator_id 21, deciding user 40.
   * Expected: Exactly one notice, to 21. The previous Coordinator (30), the deciding Venue
   *           Staff member (40) and anyone else get nothing.
   * Type:     conflict
   */
  it('US78-N08 (AC5): only the currently assigned Coordinator is notified', async () => {
    mockLookups();
    await venuesService.decideBooking(STAFF, 5, { approve: false, reason: 'Closed for works' });
    // One row in total, so no other user can have been notified.
    expect(notificationRows().map((row) => row.user_id)).toEqual([21]);
  });

  /*
   * AC:       SCRUM-78 AC5 (agreed decision for hybrid users)
   * Scenario: User 21 is both the event's assigned Coordinator and the Venue Staff member
   *           deciding the booking (one person can hold several roles, Week 4 Q&A).
   * Setup:    Deciding user 21 with roles Coordinator + Venue Staff; event.coordinator_id 21.
   * Expected: They are notified once, as the assigned Coordinator (agreed with the product
   *           owner, though AC5 also says the deciding Venue Staff member is not notified).
   * Type:     conflict
   */
  it('US78-N09 (AC5): a hybrid user deciding their own event booking is notified once', async () => {
    mockLookups();
    const hybrid = { id: 21, roles: [ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF] };
    await venuesService.decideBooking(hybrid, 5, { approve: true });
    expect(notificationRows().map((row) => row.user_id)).toEqual([21]);
  });

  /*
   * AC:       SCRUM-78 AC5 (agreed decision: no Coordinator, no notice)
   * Scenario: The event has no Coordinator assigned yet.
   * Setup:    event.coordinator_id null.
   * Expected: Nobody is notified, but the decision is still saved and returned.
   * Type:     boundary
   */
  it('US78-N10 (AC5): no notice when the event has no assigned Coordinator, decision still saved', async () => {
    mockLookups({ event: { ...EVENT, coordinator_id: null } });
    const result = await venuesService.decideBooking(STAFF, 5, { approve: true });
    expect(notificationRows()).toEqual([]);
    expect(result).toEqual(expect.objectContaining({ id: 5, status: 'APPROVED', decided_by: 40 }));
  });

  /*
   * AC:       SCRUM-78 AC6
   * Scenario: A Coordinator sends a booking request, which is now pending.
   * Setup:    No conflicting booking; the request is created with status PENDING.
   * Expected: The booking is created, but no notice is written, because nothing has been
   *           decided yet.
   * Type:     normal
   */
  it('US78-N11 (AC6): sending a booking request (pending) creates no notice', async () => {
    fetchMany.mockResolvedValueOnce([]);
    const coordinator = { id: 21, roles: [ROLES.EVENT_COORDINATOR] };
    const created = await venuesService.requestBooking(coordinator, {
      eventId: 50, venueId: 8, startAt: '2026-10-20T10:00:00Z', endAt: '2026-10-20T12:00:00Z',
    });
    expect(created.status).toBe('PENDING');
    expect(notificationRows()).toEqual([]);
  });

  /*
   * AC:       SCRUM-78 AC6
   * Scenario: A booking request is refused before it is created.
   * Setup:    (a) the sender is Venue Staff, not a Coordinator (403); (b) the venue already
   *           has an overlapping booking (409), returned by the conflict query.
   * Expected: No booking is created and no notice is written. Nothing exists to decide yet,
   *           so the Coordinator must not hear anything.
   * Type:     error
   */
  it.each([
    ['the sender is not a Coordinator', STAFF, [], 403],
    ['the venue already has an overlapping booking', { id: 21, roles: [ROLES.EVENT_COORDINATOR] }, [{ id: 77 }], 409],
  ])('US78-N13 (AC6): no booking and no notice when %s', async (_label, user, conflicts, status) => {
    fetchMany.mockResolvedValueOnce(conflicts);
    await expect(venuesService.requestBooking(user, {
      eventId: 50, venueId: 8, startAt: '2026-10-20T10:00:00Z', endAt: '2026-10-20T12:00:00Z',
    })).rejects.toMatchObject({ status });
    // No insert at all: neither the booking nor a notification was written.
    expect(insertOne).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-78 AC6
   * Scenario: A decision attempt fails, so the request stays pending.
   * Setup:    (a) the user is not Venue Staff (403); (b) the booking doesn't exist (404);
   *           (c) saving the decision fails in the database.
   * Expected: No notice in any case. A Coordinator must never be told about a decision that
   *           wasn't actually recorded.
   * Type:     error
   */
  it.each([
    ['the user is not Venue Staff', () => venuesService.decideBooking({ id: 21, roles: [ROLES.EVENT_COORDINATOR] }, 5, { approve: true }), 403],
    ['the booking does not exist', () => {
      fetchOne.mockResolvedValueOnce(null);
      return venuesService.decideBooking(STAFF, 99, { approve: true });
    }, 404],
    ['saving the decision fails', () => {
      mockLookups();
      updateById.mockRejectedValueOnce(Object.assign(new Error('Database error'), { status: 500 }));
      return venuesService.decideBooking(STAFF, 5, { approve: true });
    }, 500],
  ])('US78-N12 (AC6): no notice when %s', async (_label, attempt, status) => {
    await expect(attempt()).rejects.toMatchObject({ status });
    expect(notificationRows()).toEqual([]);
  });
});

describe('SCRUM-78 notifyUser (the write path every decision notice goes through)', () => {
  const { notifyUser } = require('../src/services/audit.service');

  /*
   * AC:       SCRUM-78 AC5 (agreed decision: no Coordinator, no notice)
   * Scenario: notifyUser is asked to notify nobody, as when an event has no Coordinator.
   * Setup:    userId null, then undefined.
   * Expected: Nothing is written, so a notice can never be stored without a recipient.
   * Type:     boundary
   */
  it.each([['null', null], ['undefined', undefined]])(
    'US78-U01 (AC5): a %s user id writes no notification',
    async (_label, userId) => {
      await notifyUser(userId, 'BOOKING_DECISION', 'Venue booking approved', 'body', 50);
      expect(insertOne).not.toHaveBeenCalled();
    }
  );

  /*
   * AC:       SCRUM-78 AC4
   * Scenario: A notice is written without an event id.
   * Setup:    userId 21, eventId omitted.
   * Expected: The row is still written, with event_id null rather than undefined, so the
   *           insert can't fail on a missing column value; the venue and event names are
   *           still in the body (see N07).
   * Type:     boundary
   */
  it('US78-U02 (AC4): a notice without an event id is saved with event_id null', async () => {
    await notifyUser(21, 'BOOKING_DECISION', 'Venue booking approved', 'body');
    expect(insertOne).toHaveBeenCalledWith('notifications', {
      user_id: 21, event_id: null, type: 'BOOKING_DECISION', title: 'Venue booking approved', body: 'body',
    });
  });
});

describe('SCRUM-78 POST /api/venues/bookings/:id/decision (route, real session cookie)', () => {
  const app = createApp();

  // Real auth middleware: the first fetchOne loads the signed-in user and the first
  // fetchMany loads their roles from user_roles.
  function as(userId, roles) {
    fetchOne.mockResolvedValueOnce({ id: userId, is_active: true });
    fetchMany.mockResolvedValueOnce(roles.map((role) => ({ role })));
    const token = jwt.sign({ sub: userId }, env.jwtSecret);
    return request(app).post('/api/venues/bookings/5/decision').set('Cookie', `${env.sessionCookieName}=${token}`);
  }

  /*
   * AC:       SCRUM-78 AC2 + AC4 + AC5 (integration: HTTP body -> route -> service -> notifications)
   * Scenario: A Venue Staff member rejects through the real API with a reason and an
   *           alternative, as the event page sends them.
   * Setup:    User 40 signed in with a real cookie and the VENUE_STAFF role; JSON body
   *           { approve: false, reason, alternativeSuggestion }.
   * Expected: 200, the booking is saved as REJECTED with the reason, and one notice goes to
   *           Coordinator 21 with the reason, the alternative, the event and the venue.
   * Type:     normal
   */
  it('US78-R01 (AC2+AC4+AC5): a rejection through the API notifies the assigned Coordinator', async () => {
    const pending = as(40, [ROLES.VENUE_STAFF])
      .send({ approve: false, reason: 'Stage under repair', alternativeSuggestion: 'Orchid Room' });
    mockLookups();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.body.booking).toEqual(expect.objectContaining({ status: 'REJECTED', decision_reason: 'Stage under repair' }));
    expect(notificationRows()).toEqual([expect.objectContaining({
      user_id: 21,
      event_id: 50,
      body: 'The venue booking request for Leadership Forum at Helix Hall was rejected.'
        + ' Reason: Stage under repair Suggested alternative: Orchid Room',
    })]);
  });

  /*
   * AC:       SCRUM-78 AC6 (with the existing rule that only Venue Staff decide)
   * Scenario: A Coordinator tries to approve their own booking through the API.
   * Setup:    User 21 signed in with only the EVENT_COORDINATOR role.
   * Expected: 403 and no notice; the request stays pending, so nothing is announced.
   * Type:     error
   */
  it('US78-R02 (AC6): a refused decision sends no notice', async () => {
    const res = await as(21, [ROLES.EVENT_COORDINATOR]).send({ approve: true });
    expect(res.status).toBe(403);
    expect(notificationRows()).toEqual([]);
    // Nothing was saved either, so the booking really is still pending.
    expect(updateById).not.toHaveBeenCalled();
  });
});

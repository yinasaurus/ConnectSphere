/**
 * SCRUM-46: Notify Venue Staff and Attendees.
 *
 *   AC1  Venue Staff hear about a new booking request, and about an approved booking
 *        when a critical event change flags it or the event is cancelled.
 *   AC2  An Attendee hears when their registration is confirmed or withdrawn, and when
 *        a event they are registered for changes date, time or venue, or is cancelled.
 *   AC3  Each notice goes only to those people. Not the actor, not other roles, not
 *        withdrawn or waitlisted Attendees.
 *   AC4  A new notice is unread. Marking it read records that, and only for that user.
 *        This reuses the existing notifications list (SCRUM-44).
 *
 * A waitlist promotion does not exist, so there is no "you are now registered from the
 * waitlist" notice. The older "a place is available" notice is unchanged.
 */
jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  fetchCount: jest.fn(),
  updateById: jest.fn(),
  insertOne: jest.fn(),
  throwIf: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn(),
  notifyUser: jest.fn(),
}));

const db = require('../src/config/db');
const audit = require('../src/services/audit.service');
const venuesService = require('../src/services/venues.service');
const eventsService = require('../src/services/events.service');
const registrationsService = require('../src/services/registrations.service');
const { flagArrangementsForReview } = require('../src/services/criticalChange.service');
const notificationsService = require('../src/services/notifications.service');
const { ROLES } = require('../src/constants/roles');

const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const attendee = { id: 30, roles: [ROLES.ATTENDEE] };

let tables;

function rowsFor(query) {
  return (tables[query.table] || []).filter((row) => (
    query.filters.every(([column, value]) => (
      Array.isArray(value)
        ? value.map(String).includes(String(row[column]))
        : String(row[column]) === String(value)
    ))
  ));
}

function notices(type) {
  return audit.notifyUser.mock.calls
    .filter((call) => call[1] === type)
    .map((call) => call[0]);
}

beforeEach(() => {
  jest.clearAllMocks();
  tables = {
    events: [{
      id: 3,
      name: 'Clash Test',
      organiser_id: 1,
      organisation_id: 10,
      coordinator_id: 2,
      status: 'PLANNING',
      start_at: '2026-12-03T09:00:00.000Z',
      end_at: '2026-12-03T11:00:00.000Z',
      expected_attendance: 40,
      venue_requirements: 'Any hall',
      equipment_notes: '',
      registration_open: true,
      registration_required: true,
      registration_opens_at: '2026-10-01T00:00:00.000Z',
      registration_closes_at: '2026-12-01T00:00:00.000Z',
      registration_capacity: 50,
    }],
    venues: [{ id: 8, name: 'Helix Hall', capacity: 180 }],
    venue_bookings: [],
    equipment_requests: [],
    registrations: [],
    users: [
      { id: 2, is_active: true },
      { id: 30, is_active: true },
      { id: 40, is_active: true },
      { id: 41, is_active: false },
    ],
    user_roles: [
      { user_id: 2, role: ROLES.EVENT_COORDINATOR },
      { user_id: 40, role: ROLES.VENUE_STAFF },
      { user_id: 41, role: ROLES.VENUE_STAFF },
    ],
    notifications: [],
    safety_checks: [],
    event_status_history: [],
  };
  db.supabase.from.mockImplementation((table) => {
    const query = { table, filters: [] };
    query.select = () => query;
    query.eq = (column, value) => {
      query.filters.push([column, value]);
      return query;
    };
    query.neq = () => query;
    query.in = (column, value) => {
      query.filters.push([column, value]);
      return query;
    };
    query.is = (column, value) => {
      query.filters.push([column, value]);
      return query;
    };
    query.order = () => query;
    query.limit = () => query;
    query.update = (patch) => {
      query.patch = patch;
      query.mode = 'update';
      return query;
    };
    query.then = (resolve) => {
      if (query.mode === 'update') {
        rowsFor(query).forEach((row) => Object.assign(row, query.patch));
      }
      resolve({ error: null });
    };
    return query;
  });
  // A copy, so a later update of the table row does not change the row the service already read.
  db.fetchOne.mockImplementation(async (query) => {
    const row = rowsFor(query)[0];
    return row ? { ...row } : null;
  });
  db.fetchMany.mockImplementation(async (query) => rowsFor(query));
  db.fetchCount.mockImplementation(async (query) => rowsFor(query).length);
  db.updateById.mockImplementation(async (table, id, patch) => {
    const row = tables[table].find((item) => Number(item.id) === Number(id));
    Object.assign(row, patch);
    return row;
  });
  db.insertOne.mockImplementation(async (table, row) => {
    const created = { id: tables[table].length + 1, read_at: null, ...row };
    tables[table].push(created);
    return created;
  });
});

describe('SCRUM-46 Venue Staff notices', () => {
  /*
   * AC:       SCRUM-46 AC1, AC3
   * Scenario: A Coordinator submits a booking request.
   * Setup:    Active Venue Staff 40, inactive Venue Staff 41, Coordinator 2 is not Venue Staff.
   *           No overlapping booking.
   * Expected: Only user 40 is told a request arrived for Clash Test at Helix Hall.
   *           No decision notice. The Coordinator is not told.
   * Type:     normal
   */
  it('US46-V01: a new booking request notifies active Venue Staff only', async () => {
    const created = await venuesService.requestBooking(coordinator, {
      eventId: 3,
      venueId: 8,
      startAt: '2026-12-03T09:00:00.000Z',
      endAt: '2026-12-03T11:00:00.000Z',
    });

    expect(created.status).toBe('PENDING');
    expect(notices('BOOKING_REQUESTED')).toEqual([40]);
    expect(notices('BOOKING_DECISION')).toEqual([]);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      40,
      'BOOKING_REQUESTED',
      'New venue booking request',
      'A venue booking was requested for Clash Test at Helix Hall.',
      3
    );
  });

  /*
   * AC:       SCRUM-46 AC3
   * Scenario: The person who submits the request is also Venue Staff.
   * Setup:    User 40 holds both roles and is the sender.
   * Expected: User 40 is not told about their own request. Nobody else is active Venue Staff.
   * Type:     boundary
   */
  it('US46-V02: the Venue Staff member who sent the request is not notified', async () => {
    await venuesService.requestBooking(
      { id: 40, roles: [ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF] },
      {
        eventId: 3,
        venueId: 8,
        startAt: '2026-12-03T09:00:00.000Z',
        endAt: '2026-12-03T11:00:00.000Z',
      }
    );

    expect(notices('BOOKING_REQUESTED')).toEqual([]);
  });

  /*
   * AC:       SCRUM-46 AC1, AC3
   * Scenario: The request is refused because the venue is already booked.
   * Setup:    An approved booking overlaps the requested window.
   * Expected: No notice. Nothing was created.
   * Type:     error
   */
  it('US46-V03: a refused booking request notifies nobody', async () => {
    tables.venue_bookings.push({
      id: 9,
      event_id: 4,
      venue_id: 8,
      status: 'APPROVED',
      start_at: '2026-12-03T09:00:00.000Z',
      end_at: '2026-12-03T11:00:00.000Z',
      setup_minutes: 0,
      teardown_minutes: 0,
    });

    await expect(venuesService.requestBooking(coordinator, {
      eventId: 3,
      venueId: 8,
      startAt: '2026-12-03T09:30:00.000Z',
      endAt: '2026-12-03T10:30:00.000Z',
    })).rejects.toMatchObject({ status: 409 });

    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-46 AC1, AC3
   * Scenario: A date change flags an approved booking.
   * Setup:    Approved booking 7 on the event's current slot. Venue Staff 40, and user 2
   *           is also Venue Staff (the editor).
   * Expected: Only user 40 is told the approved booking needs review. The booking status
   *           is not changed.
   * Type:     normal
   */
  it('US46-V04: flagging an approved booking notifies the other Venue Staff', async () => {
    tables.user_roles.push({ user_id: 2, role: ROLES.VENUE_STAFF });
    tables.venue_bookings.push({
      id: 7,
      event_id: 3,
      venue_id: 8,
      status: 'APPROVED',
      start_at: '2026-12-03T09:00:00.000Z',
      end_at: '2026-12-03T11:00:00.000Z',
    });

    await flagArrangementsForReview(
      coordinator,
      tables.events[0],
      { ...tables.events[0], start_at: '2026-12-04T09:00:00.000Z' }
    );

    expect(notices('BOOKING_AFFECTED')).toEqual([40]);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      40,
      'BOOKING_AFFECTED',
      'Approved booking needs review',
      'Clash Test changed (date and time). An approved venue booking now needs review.',
      3
    );
    expect(tables.venue_bookings[0].status).toBe('APPROVED');
  });

  /*
   * AC:       SCRUM-46 AC1, AC3
   * Scenario: A critical change flags equipment only. The booking is still pending.
   * Setup:    One PENDING booking and one equipment request.
   * Expected: Venue Staff are not told. The approved-booking rule is not met.
   * Type:     boundary
   */
  it('US46-V05: a change that flags no approved booking does not notify Venue Staff', async () => {
    tables.venue_bookings.push({
      id: 7, event_id: 3, venue_id: 8, status: 'PENDING',
      start_at: '2026-12-03T09:00:00.000Z', end_at: '2026-12-03T11:00:00.000Z',
    });
    tables.equipment_requests.push({ id: 12, event_id: 3, status: 'PENDING' });

    await flagArrangementsForReview(
      coordinator,
      tables.events[0],
      { ...tables.events[0], equipment_notes: '4 mics' }
    );

    expect(notices('BOOKING_AFFECTED')).toEqual([]);
  });

  /*
   * AC:       SCRUM-46 AC1, AC3
   * Scenario: The Coordinator cancels an event that has an approved booking.
   * Setup:    Approved booking. Registered attendee 30 is covered in the Attendee tests.
   * Expected: Active Venue Staff are told. The booking is not cancelled.
   * Type:     normal
   */
  it('US46-V06: cancelling an event with an approved booking notifies Venue Staff', async () => {
    tables.venue_bookings.push({
      id: 7, event_id: 3, venue_id: 8, status: 'APPROVED',
      start_at: '2026-12-03T09:00:00.000Z', end_at: '2026-12-03T11:00:00.000Z',
    });

    await eventsService.changeStatus(coordinator, 3, 'CANCELLED');

    expect(notices('BOOKING_AFFECTED')).toEqual([40]);
    expect(tables.venue_bookings[0].status).toBe('APPROVED');
    expect(tables.events[0].status).toBe('CANCELLED');
  });

  /*
   * AC:       SCRUM-46 AC3
   * Scenario: The event is cancelled but its only booking is still pending.
   * Expected: Venue Staff get no booking notice.
   * Type:     boundary
   */
  it('US46-V07: cancelling an event with no approved booking does not notify Venue Staff', async () => {
    tables.venue_bookings.push({
      id: 7, event_id: 3, venue_id: 8, status: 'PENDING',
      start_at: '2026-12-03T09:00:00.000Z', end_at: '2026-12-03T11:00:00.000Z',
    });

    await eventsService.changeStatus(coordinator, 3, 'CANCELLED');

    expect(notices('BOOKING_AFFECTED')).toEqual([]);
  });
});

describe('SCRUM-46 Attendee notices', () => {
  function confirmedEvent() {
    tables.events[0].status = 'CONFIRMED';
  }

  /*
   * AC:       SCRUM-46 AC2, AC3
   * Scenario: An Attendee registers successfully.
   * Setup:    Confirmed event, open window, empty registration list, capacity left.
   * Expected: Only that Attendee is told they are registered.
   * Type:     normal
   */
  it('US46-A01: registering notifies that Attendee and nobody else', async () => {
    confirmedEvent();

    await registrationsService.register(attendee, 3);

    expect(notices('REGISTRATION_CONFIRMED')).toEqual([30]);
    expect(audit.notifyUser).toHaveBeenCalledTimes(1);
  });

  /*
   * AC:       SCRUM-46 AC2 (failure)
   * Scenario: Registration is refused because the event is full.
   * Setup:    Capacity 50 and 50 places already taken.
   * Expected: No notice.
   * Type:     error
   */
  it('US46-A02: a refused registration notifies nobody', async () => {
    confirmedEvent();
    db.fetchCount.mockResolvedValueOnce(50);

    await expect(registrationsService.register(attendee, 3)).rejects.toMatchObject({ status: 409 });

    expect(audit.notifyUser).not.toHaveBeenCalled();
  });

  /*
   * AC:       SCRUM-46 AC2, AC3
   * Scenario: The Attendee withdraws their own place.
   * Expected: That Attendee is told. A withdrawn registration is not a waitlist promotion.
   * Type:     normal
   */
  it('US46-A03: withdrawing notifies the Attendee who withdrew', async () => {
    tables.registrations.push({
      id: 10, event_id: 3, attendee_id: 30, status: 'REGISTERED',
    });

    await registrationsService.withdraw(attendee, 3);

    expect(notices('REGISTRATION_WITHDRAWN')).toEqual([30]);
    expect(notices('WAITLIST_OPENING')).toEqual([]);
  });

  /*
   * AC:       SCRUM-46 AC2, AC3
   * Scenario: The event date changes. One Attendee is registered, one withdrew, one is waitlisted.
   * Setup:    Coordinator edits the start time. Approved booking so Venue Staff are also told,
   *           which this test does not treat as an Attendee notice.
   * Expected: Only the registered Attendee gets the event-updated notice.
   * Type:     normal
   */
  it('US46-A04: a date change notifies registered Attendees only', async () => {
    tables.registrations.push(
      { id: 10, event_id: 3, attendee_id: 30, status: 'REGISTERED' },
      { id: 11, event_id: 3, attendee_id: 31, status: 'WITHDRAWN' },
      { id: 12, event_id: 3, attendee_id: 32, status: 'WAITLISTED' }
    );

    await eventsService.updateEvent(coordinator, 3, {
      startAt: '2026-12-04T09:00:00.000Z',
      endAt: '2026-12-04T11:00:00.000Z',
    });

    expect(notices('EVENT_CHANGED')).toEqual([30]);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      30,
      'EVENT_CHANGED',
      'Event updated',
      'Clash Test has a new date and time.',
      3
    );
  });

  /*
   * AC:       SCRUM-46 AC2
   * Scenario: Only the expected attendance changes.
   * Setup:    A registered Attendee. Venue capacity is high enough that no booking is flagged.
   * Expected: The Attendee is not told. Attendance is not a date, time or venue change.
   * Type:     boundary
   */
  it('US46-A05: an attendance-only change does not notify Attendees', async () => {
    tables.registrations.push({ id: 10, event_id: 3, attendee_id: 30, status: 'REGISTERED' });

    await eventsService.updateEvent(coordinator, 3, { expectedAttendance: 50 });

    expect(notices('EVENT_CHANGED')).toEqual([]);
  });

  /*
   * AC:       SCRUM-46 AC2, AC3
   * Scenario: The event is cancelled.
   * Setup:    Registered, withdrawn and waitlisted Attendees.
   * Expected: Only the registered Attendee is told it was cancelled.
   * Type:     normal
   */
  it('US46-A06: cancelling the event notifies registered Attendees only', async () => {
    tables.registrations.push(
      { id: 10, event_id: 3, attendee_id: 30, status: 'REGISTERED' },
      { id: 11, event_id: 3, attendee_id: 31, status: 'WITHDRAWN' },
      { id: 12, event_id: 3, attendee_id: 32, status: 'WAITLISTED' }
    );

    await eventsService.changeStatus(coordinator, 3, 'CANCELLED');

    expect(notices('EVENT_CANCELLED')).toEqual([30]);
  });

  /*
   * AC:       SCRUM-46 AC2
   * Scenario: An approved change request moves the venue requirements.
   * Setup:    One registered Attendee. The request changes venue text only.
   * Expected: That Attendee is told the venue changed.
   * Type:     normal
   */
  it('US46-A07: an approved venue change notifies registered Attendees', async () => {
    tables.registrations.push({ id: 10, event_id: 3, attendee_id: 30, status: 'REGISTERED' });
    tables.event_change_requests = [{
      id: 50,
      event_id: 3,
      requested_by: 1,
      status: 'PENDING',
      start_at: null,
      end_at: null,
      expected_attendance: null,
      venue_requirements: 'A larger hall',
      equipment_notes: null,
    }];

    await eventsService.decideChangeRequest(coordinator, 3, 50, { approve: true });

    expect(notices('EVENT_CHANGED')).toEqual([30]);
    expect(audit.notifyUser).toHaveBeenCalledWith(
      30,
      'EVENT_CHANGED',
      'Event updated',
      'Clash Test has a new venue.',
      3
    );
  });
});

describe('SCRUM-46 new and already viewed notices', () => {
  /*
   * AC:       SCRUM-46 AC4
   * Scenario: Venue Staff have a new booking notice. They mark it read. Another user tries
   *           to mark that same notice.
   * Setup:    One notifications row for user 40, read_at null. The list and mark-read
   *           functions are the existing ones.
   * Expected: It is unread at first. After user 40 marks it, it has a read time and the
   *           unread count is 0. User 30 cannot mark it, and does not see it in their list.
   * Type:     normal
   */
  it('US46-R01: a notice starts unread, and only its owner can mark it viewed', async () => {
    tables.notifications.push({
      id: 5,
      user_id: 40,
      event_id: 3,
      type: 'BOOKING_REQUESTED',
      title: 'New venue booking request',
      body: 'A venue booking was requested.',
      read_at: null,
    });

    const mine = await notificationsService.listMine(40);
    expect(mine.map((row) => row.id)).toEqual([5]);
    expect(mine[0].read_at).toBeNull();
    expect(await notificationsService.unreadCount(40)).toBe(1);

    const read = await notificationsService.markRead(40, 5);
    expect(read.read_at).toEqual(expect.any(String));
    expect(await notificationsService.unreadCount(40)).toBe(0);

    await notificationsService.markRead(30, 5);
    expect(tables.notifications[0].read_at).toEqual(expect.any(String));
    const others = await notificationsService.listMine(30);
    expect(others).toEqual([]);
  });
});

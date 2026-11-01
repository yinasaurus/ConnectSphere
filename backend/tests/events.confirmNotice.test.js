/**
 * SCRUM-70: Notify of event confirmation — Organiser gets a dedicated notice when the
 * event becomes Confirmed (not on other status moves; not on re-view / re-save).
 *
 *   AC1  When status becomes Confirmed, a notification is created for that event's Organiser.
 *   AC2  The notice identifies the event and states that it has been confirmed.
 *   AC3  No EVENT_CONFIRMED notice for any status change other than becoming Confirmed.
 *   AC4  Confirming once creates exactly one EVENT_CONFIRMED — no duplicates from re-save/view.
 *   AC5  Only that event's Organiser receives EVENT_CONFIRMED (not the Coordinator).
 *
 * Product rules: UI Confirm uses changeStatus; POST /confirm uses confirmEvent. Both must
 * emit EVENT_CONFIRMED. Generic EVENT_STATUS_CHANGED (SCRUM-44) may still fire separately.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/db', () => ({
  supabase: { from: jest.fn() },
  fetchOne: jest.fn(),
  fetchMany: jest.fn(),
  updateById: jest.fn(),
  insertOne: jest.fn(),
}));
jest.mock('../src/services/audit.service', () => ({
  writeAudit: jest.fn(),
  notifyUser: jest.fn(),
}));

const db = require('../src/config/db');
const audit = require('../src/services/audit.service');
const events = require('../src/services/events.service');
const { createApp } = require('../src/app');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };

let event;
let tables;

function queryFor(table) {
  const query = { table, filters: [], excluded: [] };
  query.select = jest.fn(() => query);
  query.eq = jest.fn((column, value) => {
    query.filters.push([column, value]);
    return query;
  });
  query.neq = jest.fn((column, value) => {
    query.excluded.push([column, value]);
    return query;
  });
  query.order = jest.fn(() => query);
  return query;
}

function matchingRows(query) {
  return (tables[query.table] || []).filter((row) =>
    query.filters.every(([column, value]) => String(row[column]) === String(value))
    && query.excluded.every(([column, value]) => String(row[column]) !== String(value))
  );
}

function confirmationNotices() {
  return audit.notifyUser.mock.calls.filter(([, type]) => type === 'EVENT_CONFIRMED');
}

beforeEach(() => {
  jest.clearAllMocks();
  event = {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    name: 'Leadership Forum',
    status: 'PREPARATION',
    purpose: 'Briefing',
    description: 'Closed-door forum',
    start_at: '2026-11-20T10:00:00.000Z',
    end_at: '2026-11-20T12:00:00.000Z',
    expected_attendance: 40,
    venue_requirements: 'Boardroom',
    accessibility_needs: 'Step-free',
  };
  tables = {
    events: [event],
    venue_bookings: [{ id: 7, event_id: 3, status: 'APPROVED' }],
    equipment_requests: [],
    users: [
      { id: 1, full_name: 'Organiser', is_active: true },
      { id: 2, full_name: 'Coordinator', is_active: true },
    ],
    user_roles: [
      { user_id: 1, role: ROLES.EVENT_ORGANISER },
      { user_id: 2, role: ROLES.EVENT_COORDINATOR },
    ],
    organisations: [{ id: 10, name: 'Acme' }],
  };

  db.supabase.from.mockImplementation(queryFor);
  db.fetchOne.mockImplementation(async (query) => {
    const row = matchingRows(query)[0];
    if (!row) return null;
    if (query.table === 'events') {
      const org = tables.organisations.find((o) => o.id === row.organisation_id);
      const orgUser = tables.users.find((u) => u.id === row.organiser_id);
      const coordUser = tables.users.find((u) => u.id === row.coordinator_id);
      return {
        ...row,
        organisation: org ? { name: org.name } : null,
        organiser: orgUser ? { full_name: orgUser.full_name } : null,
        coordinator: coordUser ? { full_name: coordUser.full_name } : null,
      };
    }
    return { ...row };
  });
  db.fetchMany.mockImplementation(async (query) => matchingRows(query).map((row) => ({ ...row })));
  db.updateById.mockImplementation(async (table, id, patch) => {
    const row = (tables[table] || []).find((item) => String(item.id) === String(id));
    if (row) Object.assign(row, patch);
    return row;
  });
  db.insertOne.mockImplementation(async (table, row) => {
    const saved = { id: (tables[table]?.length || 0) + 1, ...row };
    tables[table] = [...(tables[table] || []), saved];
    return saved;
  });
});

describe('SCRUM-70 confirmation notice via changeStatus (UI Confirm)', () => {
  /*
   * AC:       SCRUM-70 AC1, AC2, AC4
   * Scenario: Assigned Coordinator confirms a Preparation event through changeStatus
   *           (the EventDetail Confirm button path).
   * Setup:    Event 3 in PREPARATION with one APPROVED venue booking; organiser 1;
   *           name "Leadership Forum".
   * Expected: Exactly one EVENT_CONFIRMED to user 1; title/body name the event and
   *           say it is confirmed; event_id 3 is attached (AC4: no duplicate on one confirm).
   * Type:     normal
   */
  // SCRUM-70-TC01
  it('US70-B01: confirming via changeStatus notifies the Organiser that the event is confirmed', async () => {
    await events.changeStatus(coordinator, 3, 'CONFIRMED');

    expect(confirmationNotices()).toHaveLength(1);
    expect(confirmationNotices()[0]).toEqual([
      1,
      'EVENT_CONFIRMED',
      'Event confirmed',
      expect.stringMatching(/Leadership Forum[\s\S]*confirmed/i),
      3,
    ]);
  });

  /*
   * AC:       SCRUM-70 AC4
   * Scenario: Opening / reloading the event after it is already Confirmed must not
   *           create another confirmation notice.
   * Setup:    Event already CONFIRMED; call getEvent as the organiser.
   * Expected: No EVENT_CONFIRMED notifyUser calls.
   * Type:     boundary
   */
  // SCRUM-70-TC02
  it('US70-B03: viewing a Confirmed event does not create a confirmation notice', async () => {
    event.status = 'CONFIRMED';
    await events.getEvent({ id: 1, roles: [ROLES.EVENT_ORGANISER], organisationId: 10 }, 3);
    expect(confirmationNotices()).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-70 AC4
   * Scenario: A second save of a Confirmed event must not emit EVENT_CONFIRMED.
   * Setup:    Event CONFIRMED; assigned Coordinator sends a description-only update.
   *           SCRUM-40 refuses that direct edit (EDIT_LOCKED), so the save never runs.
   * Expected: 409 EDIT_LOCKED, nothing written, and no EVENT_CONFIRMED notice.
   * Type:     boundary
   */
  // SCRUM-70-TC03
  it('US70-B04: re-saving a Confirmed event does not create a confirmation notice', async () => {
    event.status = 'CONFIRMED';
    await expect(events.updateEvent(coordinator, 3, { description: 'Updated notes only' }))
      .rejects.toMatchObject({
        status: 409,
        code: 'EDIT_LOCKED',
        message: 'Confirmed events cannot be edited directly. Create a change request instead.',
      });
    expect(db.updateById).not.toHaveBeenCalled();
    expect(confirmationNotices()).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-70 AC3
   * Scenario: Other status moves must not create a confirmation notice.
   * Setup:    Event in PLANNING with arrangements ready; send to Awaiting Safety Check.
   * Expected: Zero EVENT_CONFIRMED calls (SO readiness may still notify under SCRUM-81).
   * Type:     error
   */
  // SCRUM-70-TC04
  it('US70-B05: sending to safety check does not create an EVENT_CONFIRMED notice', async () => {
    event.status = 'PLANNING';
    await events.changeStatus(coordinator, 3, 'AWAITING_SAFETY_CHECK');
    expect(confirmationNotices()).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-70 AC3
   * Scenario: Completing a Confirmed event is not "becoming Confirmed".
   * Setup:    Event already CONFIRMED; move to COMPLETED.
   * Expected: No EVENT_CONFIRMED notice.
   * Type:     boundary
   */
  // SCRUM-70-TC05
  it('US70-B06: marking completed does not create an EVENT_CONFIRMED notice', async () => {
    event.status = 'CONFIRMED';
    await events.changeStatus(coordinator, 3, 'COMPLETED');
    expect(confirmationNotices()).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-70 AC1
   * Scenario: If the event has no organiser id, confirmation still succeeds without a notice.
   * Setup:    organiser_id null; otherwise ready to confirm.
   * Expected: Status CONFIRMED; zero EVENT_CONFIRMED notices.
   * Type:     boundary
   */
  // SCRUM-70-TC06
  it('US70-B09: confirming with no organiser creates no EVENT_CONFIRMED notice', async () => {
    event.organiser_id = null;
    await events.changeStatus(coordinator, 3, 'CONFIRMED');
    expect(event.status).toBe('CONFIRMED');
    expect(confirmationNotices()).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-70 AC1, AC4
   * Scenario: A refused confirm must not create a confirmation notice — status never
   *           becomes Confirmed, so AC1's trigger does not fire.
   * Setup:    Preparation event with no venue bookings → NOT_READY_TO_CONFIRM.
   * Expected: 409; status stays PREPARATION; zero EVENT_CONFIRMED calls.
   * Type:     error
   */
  // SCRUM-70-TC07
  it('US70-B11: a refused confirm creates no EVENT_CONFIRMED notice', async () => {
    tables.venue_bookings = [];
    await expect(events.changeStatus(coordinator, 3, 'CONFIRMED')).rejects.toMatchObject({
      status: 409,
      code: 'NOT_READY_TO_CONFIRM',
    });
    expect(event.status).toBe('PREPARATION');
    expect(confirmationNotices()).toHaveLength(0);
  });

  /*
   * AC:       SCRUM-70 AC2
   * Scenario: Confirmation notice must still identify the event when the name is missing.
   * Setup:    Ready Preparation event with name null; confirm via changeStatus.
   * Expected: One EVENT_CONFIRMED whose body uses the "An event" fallback and says confirmed.
   * Type:     boundary
   */
  // SCRUM-70-TC08
  it('US70-B12: confirming with a missing event name uses the An event fallback', async () => {
    event.name = null;
    await events.changeStatus(coordinator, 3, 'CONFIRMED');
    expect(confirmationNotices()).toHaveLength(1);
    expect(confirmationNotices()[0][3]).toMatch(/An event[\s\S]*confirmed/i);
  });
});

describe('SCRUM-70 confirmation notice via confirmEvent (API path)', () => {
  /*
   * AC:       SCRUM-70 AC1, AC2, AC4
   * Scenario: Dedicated confirm endpoint also notifies the Organiser once.
   * Setup:    Same Preparation + approved booking fixture.
   * Expected: Exactly one EVENT_CONFIRMED with event name in the body.
   * Type:     normal
   */
  // SCRUM-70-TC09
  it('US70-B10: confirmEvent notifies the Organiser once with the event name', async () => {
    await events.confirmEvent(coordinator, 3);
    expect(confirmationNotices()).toHaveLength(1);
    expect(confirmationNotices()[0][3]).toContain('Leadership Forum');
    expect(confirmationNotices()[0][3]).toMatch(/confirmed/i);
  });
});

describe('SCRUM-70 confirmation notice HTTP route', () => {
  const app = createApp();
  const token = jwt.sign({ sub: 2 }, env.jwtSecret);

  /*
   * AC:       SCRUM-70 AC1, AC2
   * Scenario: Real status route used by the Confirm button.
   * Setup:    Cookie for coordinator 2; PREPARATION event ready to confirm.
   * Expected: 200; EVENT_CONFIRMED was requested for organiser 1.
   * Type:     normal
   */
  // SCRUM-70-TC10
  it('US70-R01: POST /status CONFIRMED creates an EVENT_CONFIRMED notice for the Organiser', async () => {
    db.fetchOne.mockImplementation(async (query) => {
      if (query.table === 'users') {
        return { id: 2, is_active: true };
      }
      const row = matchingRows(query)[0];
      if (!row) return null;
      if (query.table === 'events') {
        return {
          ...row,
          organisation: { name: 'Acme' },
          organiser: { full_name: 'Organiser' },
          coordinator: { full_name: 'Coordinator' },
        };
      }
      return { ...row };
    });
    db.fetchMany.mockImplementation(async (query) => {
      if (query.table === 'user_roles') {
        return [{ role: ROLES.EVENT_COORDINATOR }];
      }
      return matchingRows(query).map((row) => ({ ...row }));
    });

    const res = await request(app)
      .post('/api/events/3/status')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ status: 'CONFIRMED' });

    expect(res.status).toBe(200);
    expect(confirmationNotices()).toEqual([
      [
        1,
        'EVENT_CONFIRMED',
        'Event confirmed',
        expect.stringContaining('Leadership Forum'),
        3,
      ],
    ]);
  });
});

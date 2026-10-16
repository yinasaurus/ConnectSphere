/*
 * Purpose: cover SCRUM-73 confirmation, safety-check, authorization, and state-preservation rules.
 * AC: SCRUM-73 AC1–AC9 and the additional mandatory Safety Officer requirements.
 * Inputs: mocked event, booking, equipment, user, and role rows.
 * Outputs: expected service results and HTTP responses without external database access.
 * Failure: blocked actions must leave the event status and audit side effects unchanged.
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
const access = require('../src/services/access.service');
const { createApp } = require('../src/app');
const { ROLES } = require('../src/constants/roles');
const { env } = require('../src/config/env');

const coordinator = { id: 2, roles: [ROLES.EVENT_COORDINATOR] };
const otherCoordinator = { id: 9, roles: [ROLES.EVENT_COORDINATOR] };
const organiser = { id: 1, roles: [ROLES.EVENT_ORGANISER] };
const safetyOfficer = { id: 12, roles: [ROLES.SAFETY_OFFICER] };
const app = createApp();
const organiserToken = jwt.sign({ sub: organiser.id }, env.jwtSecret);

let event;
let tables;

/*
 * Purpose: model the small subset of Supabase query chaining used by these services.
 * AC: SCRUM-73 — keep fixture rows scoped to the requested event and status.
 * Inputs: table name. Output: chainable query with equality and inequality filters.
 * Failure: none; unfiltered tables return no rows when not present in the fixture.
 */
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
  return query;
}

/*
 * Purpose: return only fixture rows matching the service's query filters.
 * AC: SCRUM-73 AC3–AC6 — cancelled bookings and unrelated event rows must be handled accurately.
 * Inputs: a query returned by queryFor. Output: matching fixture rows.
 * Failure: none; an absent table is represented as an empty result.
 */
function matchingRows(query) {
  return (tables[query.table] || []).filter((row) =>
    query.filters.every(([column, value]) => String(row[column]) === String(value)) &&
    query.excluded.every(([column, value]) => String(row[column]) !== String(value))
  );
}

/*
 * Purpose: verify that rejected service calls do not change the event or write confirmation.
 * AC: SCRUM-73 AC7 — a blocked confirmation leaves the event status unchanged.
 * Inputs: service promise, expected HTTP-like status and error code.
 * Output: assertions for the error and absent writes.
 * Failure: fails if an invalid request succeeds or persists a change.
 */
async function expectBlocked(promise, status, code) {
  const originalStatus = event.status;
  await expect(promise).rejects.toMatchObject({ status, code });
  expect(event.status).toBe(originalStatus);
  expect(db.updateById).not.toHaveBeenCalled();
  expect(db.insertOne).not.toHaveBeenCalled();
}

/*
 * Purpose: reset the in-memory event workflow and database doubles for each scenario.
 * AC: SCRUM-73 AC1–AC9 — tests begin from an isolated, assigned Planning event.
 * Inputs: none. Output: a Planning event with one approved active booking.
 * Failure: none; Jest mocks are cleared before each test.
 */
beforeEach(() => {
  jest.clearAllMocks();
  event = {
    id: 3,
    organiser_id: 1,
    organisation_id: 10,
    coordinator_id: 2,
    name: 'Workshop',
    status: 'PLANNING',
  };
  tables = {
    events: [event],
    venue_bookings: [{ id: 7, event_id: 3, status: 'APPROVED' }],
    equipment_requests: [],
    users: [
      { id: 1, is_active: true },
      { id: 2, is_active: true },
    ],
    user_roles: [
      { user_id: 1, role: ROLES.EVENT_ORGANISER },
      { user_id: 2, role: ROLES.EVENT_COORDINATOR },
    ],
  };

  db.supabase.from.mockImplementation(queryFor);
  db.fetchOne.mockImplementation(async (query) => matchingRows(query)[0] || null);
  db.fetchMany.mockImplementation(async (query) => matchingRows(query));
  db.updateById.mockImplementation(async (table, id, patch) => {
    const row = (tables[table] || []).find((item) => String(item.id) === String(id));
    if (row) Object.assign(row, patch);
    return row;
  });
  db.insertOne.mockImplementation(async (table, row) => {
    tables[table] = [...(tables[table] || []), row];
    return row;
  });
});

describe('SCRUM-73 event confirmation service rules', () => {
  /*
   * Purpose: confirm an assigned Coordinator's event when all arrangements are ready.
   * AC: SCRUM-73 AC8–AC9 — no equipment request is valid and success changes status to Confirmed.
   * Inputs: assigned Coordinator, Planning event, approved active venue booking, no equipment.
   * Output: confirmed event, status history, audit entry, and organiser notification.
   * Failure: any unmet prerequisite rejects without confirming.
   */
  it('confirms a Planning event with an approved venue booking and no equipment requested', async () => {
    const result = await events.confirmEvent(coordinator, 3);

    expect(result.status).toBe('CONFIRMED');
    expect(event.status).toBe('CONFIRMED');
    expect(db.updateById).toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({ status: 'CONFIRMED' })
    );
    expect(db.insertOne).toHaveBeenCalledWith(
      'event_status_history',
      expect.objectContaining({ from_status: 'PLANNING', to_status: 'CONFIRMED' })
    );
    expect(audit.notifyUser).toHaveBeenCalledWith(
      1,
      'EVENT_CONFIRMED',
      'Event confirmed',
      expect.stringContaining('Registration can now be opened.'),
      3
    );
  });

  /*
   * Purpose: enforce that only the coordinator assigned to the event may confirm it.
   * AC: SCRUM-73 AC1 — another Coordinator is forbidden and cannot modify the event.
   * Inputs: a different Coordinator and event 3 assigned to Coordinator 2.
   * Output: 403 FORBIDDEN with no writes or status change.
   * Failure: fails if another Coordinator can confirm or inspect through a successful response.
   */
  it('rejects confirmation by a Coordinator who is not assigned to the event', async () => {
    await expectBlocked(
      events.confirmEvent(otherCoordinator, 3),
      403,
      'FORBIDDEN'
    );
  });

  /*
   * Purpose: restrict confirmation to the Event Coordinator role.
   * AC: SCRUM-73 AC1 and cross-cutting security — an organiser cannot invoke the service action.
   * Inputs: an organiser without the Coordinator role.
   * Output: 403 FORBIDDEN before any confirmation write.
   * Failure: fails if a non-Coordinator can confirm.
   */
  it('rejects confirmation by a user without the Coordinator role', async () => {
    await expectBlocked(events.confirmEvent(organiser, 3), 403, 'FORBIDDEN');
  });

  /*
   * Purpose: allow confirmation only from the Planning status.
   * AC: SCRUM-73 AC2, AC7 — other lifecycle states are rejected without mutation.
   * Inputs: each non-Planning state in the event lifecycle.
   * Output: 409 INVALID_STATUS and unchanged event state.
   * Failure: fails if any other status is accepted.
   */
  it.each([
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'AWAITING_SAFETY_CHECK',
    'PREPARATION',
    'CONFIRMED',
    'COMPLETED',
    'CANCELLED',
  ])('blocks confirmation when the event is %s', async (status) => {
    event.status = status;
    await expectBlocked(events.confirmEvent(coordinator, 3), 409, 'INVALID_STATUS');
  });

  /*
   * Purpose: require at least one non-cancelled venue booking.
   * AC: SCRUM-73 AC3, AC7 — no booking and cancelled-only bookings both block confirmation.
   * Inputs: an empty booking list or one cancelled booking.
   * Output: 409 NOT_READY_TO_CONFIRM without changing the Planning status.
   * Failure: fails if cancelled bookings count as active arrangements.
   */
  it.each([
    ['no venue bookings', []],
    ['only a cancelled venue booking', [{ id: 8, event_id: 3, status: 'CANCELLED' }]],
  ])('blocks confirmation with %s', async (_scenario, bookings) => {
    tables.venue_bookings = bookings;
    await expectBlocked(
      events.confirmEvent(coordinator, 3),
      409,
      'NOT_READY_TO_CONFIRM'
    );
  });

  /*
   * Purpose: require every non-cancelled venue booking to be approved.
   * AC: SCRUM-73 AC4, AC7 — one pending booking blocks even when another is approved.
   * Inputs: approved, pending, and cancelled bookings for the same event.
   * Output: 409 with the event still Planning; cancelled bookings are ignored.
   * Failure: fails if an unapproved active booking is ignored or cancellation blocks approval.
   */
  it('blocks a pending booking while ignoring a cancelled booking', async () => {
    tables.venue_bookings.push(
      { id: 8, event_id: 3, status: 'PENDING' },
      { id: 9, event_id: 3, status: 'CANCELLED' }
    );

    await expectBlocked(
      events.confirmEvent(coordinator, 3),
      409,
      'NOT_READY_TO_CONFIRM'
    );
  });

  /*
   * Purpose: ignore cancelled bookings when all remaining venue bookings are approved.
   * AC: SCRUM-73 AC4, AC7 — cancelled bookings do not prevent confirmation.
   * Inputs: one approved booking and one cancelled booking.
   * Output: successful transition from Planning to Confirmed.
   * Failure: fails if a cancelled booking is treated as an outstanding arrangement.
   */
  it('confirms when every active booking is approved and other bookings are cancelled', async () => {
    tables.venue_bookings.push({ id: 8, event_id: 3, status: 'CANCELLED' });

    const result = await events.confirmEvent(coordinator, 3);

    expect(result.status).toBe('CONFIRMED');
    expect(event.status).toBe('CONFIRMED');
  });

  /*
   * Purpose: require every requested equipment item to be reserved.
   * AC: SCRUM-73 AC5, AC7 — one unreserved item blocks the whole event.
   * Inputs: one reserved and one pending equipment request.
   * Output: 409 NOT_READY_TO_CONFIRM with no event write.
   * Failure: fails if partially arranged equipment is accepted.
   */
  it('blocks confirmation when any requested equipment is not reserved', async () => {
    tables.equipment_requests = [
      { id: 1, event_id: 3, status: 'RESERVED' },
      { id: 2, event_id: 3, status: 'PENDING' },
    ];

    await expectBlocked(
      events.confirmEvent(coordinator, 3),
      409,
      'NOT_READY_TO_CONFIRM'
    );
  });

  /*
   * Purpose: block venue arrangements marked for review or alternative arrangements.
   * AC: SCRUM-73 AC6, AC7 — both issue fields prevent confirmation until cleared.
   * Inputs: an approved booking with a review reason or alternative suggestion.
   * Output: 409 NOT_READY_TO_CONFIRM and an unchanged event.
   * Failure: fails if either outstanding venue issue is overlooked.
   */
  it.each([
    ['review reason', { decision_reason: 'Needs review' }],
    ['alternative suggestion', { alternative_suggestion: 'Use another room' }],
  ])('blocks confirmation when a venue booking has a %s', async (_issue, issue) => {
    tables.venue_bookings[0] = { ...tables.venue_bookings[0], ...issue };

    await expectBlocked(
      events.confirmEvent(coordinator, 3),
      409,
      'NOT_READY_TO_CONFIRM'
    );
  });

  /*
   * Purpose: block equipment reservations marked as needing review or alternatives.
   * AC: SCRUM-73 AC6, AC7 — equipment issues must be cleared before confirmation.
   * Inputs: a reserved equipment request carrying a non-empty decision reason.
   * Output: 409 NOT_READY_TO_CONFIRM and an unchanged event.
   * Failure: fails if an equipment issue is ignored.
   */
  it('blocks confirmation when a reserved equipment request still needs review', async () => {
    tables.equipment_requests = [{
      id: 1,
      event_id: 3,
      status: 'RESERVED',
      decision_reason: 'Needs review',
    }];

    await expectBlocked(
      events.confirmEvent(coordinator, 3),
      409,
      'NOT_READY_TO_CONFIRM'
    );
  });
});

describe('SCRUM-73 Safety Officer workflow', () => {
  /*
   * Purpose: prevent a Coordinator from starting preparation before the Safety Officer check.
   * AC: mandatory safety requirement — only the approved safety-check workflow may proceed.
   * Inputs: assigned Coordinator attempts AWAITING_SAFETY_CHECK to PREPARATION.
   * Output: 409 SAFETY_CHECK_REQUIRED and unchanged status.
   * Failure: fails if the Coordinator can bypass the Safety Officer check.
   */
  it('blocks a direct move to Preparation before the Safety Officer check', async () => {
    event.status = 'AWAITING_SAFETY_CHECK';

    await expectBlocked(
      events.changeStatus(coordinator, 3, 'PREPARATION'),
      409,
      'SAFETY_CHECK_REQUIRED'
    );
  });

  /*
   * Purpose: return an event to Planning when the Safety Officer declines the check.
   * AC: additional requirement 3 — a declined check returns the event to Planning.
   * Inputs: Safety Officer decision { approved: false, outcome } on an awaiting event.
   * Output: event status PLANNING, with the decision recorded and coordinator notified.
   * Failure: fails if the decline leaves the event in another status.
   */
  it('returns the event to Planning when the Safety Officer declines', async () => {
    event.status = 'AWAITING_SAFETY_CHECK';

    const result = await access.recordSafetyCheck(
      safetyOfficer,
      3,
      { approved: false, outcome: 'Fire exits need clearing' }
    );

    expect(event.status).toBe('PLANNING');
    expect(result).toMatchObject({ eventId: 3, approved: false });
    expect(db.updateById).toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({ status: 'PLANNING' })
    );
  });

  /*
   * Purpose: confirm an event only after the Safety Officer approves its final check.
   * AC: additional requirement 1 — after all approvals, including the Safety Officer check,
   * the event status moves to Confirmed.
   * Inputs: Safety Officer approval for event 3 awaiting its safety check.
   * Output: event status CONFIRMED, with approval recorded and coordinator notified.
   * Failure: fails if an approval does not complete confirmation.
   */
  it('moves the event to Confirmed after the Safety Officer approves the final check', async () => {
    event.status = 'AWAITING_SAFETY_CHECK';

    const result = await access.recordSafetyCheck(
      safetyOfficer,
      3,
      { approved: true, outcome: 'All safety requirements met' }
    );

    expect(event.status).toBe('CONFIRMED');
    expect(result).toMatchObject({ eventId: 3, approved: true });
    expect(db.updateById).toHaveBeenCalledWith(
      'events',
      3,
      expect.objectContaining({ status: 'CONFIRMED' })
    );
  });
});

describe('SCRUM-73 confirmation route authorization', () => {
  /*
   * Purpose: require a valid signed-in session before accepting a confirmation request.
   * AC: SCRUM-73 AC1 and cross-cutting security — unauthenticated callers receive 401.
   * Inputs: POST /api/events/3/confirm without a session cookie.
   * Output: 401 UNAUTHENTICATED and no event update.
   * Failure: fails if an anonymous request reaches confirmation logic.
   */
  it('rejects an unauthenticated confirmation request', async () => {
    const response = await request(app).post('/api/events/3/confirm');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: 'UNAUTHENTICATED' });
    expect(db.updateById).not.toHaveBeenCalled();
  });

  /*
   * Purpose: prevent a signed-in non-Coordinator from calling the confirmation endpoint.
   * AC: SCRUM-73 AC1 and cross-cutting security — authorization runs before event lookup.
   * Inputs: an authenticated Event Organiser calls POST /api/events/3/confirm.
   * Output: 403 FORBIDDEN without event details or writes.
   * Failure: fails if the route bypasses its Coordinator role guard.
   */
  it('rejects an authenticated user without the Coordinator role', async () => {
    const response = await request(app)
      .post('/api/events/3/confirm')
      .set('Cookie', `${env.sessionCookieName}=${organiserToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
    expect(response.body).not.toHaveProperty('event');
    expect(db.updateById).not.toHaveBeenCalled();
  });
});

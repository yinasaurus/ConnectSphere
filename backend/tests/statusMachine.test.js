/**
 * SCRUM-5: Progressing Event Statuses (status machine unit tests)
 *
 * Acceptance criteria covered:
 *   AC1  The 11 statuses: Draft, Submitted, Under Review, Approved, Planning,
 *        Awaiting Safety Check, Preparation, Confirmed, Completed, Cancelled, Rejected.
 *   AC2  Under Review -> Approved.
 *   AC3  Approved -> Planning.
 *   AC4  Submitted / Under Review -> Rejected.
 *   AC6  Planning -> Awaiting Safety Check.
 *   AC7  Preparation is only reachable from Awaiting Safety Check.
 *   Any transition outside the matrix fails with HTTP 409 (kept from the pre-existing
 *   convention; SCRUM-64 already shipped a test depending on this exact status code).
 *
 * Labels: US5-M.. (this file), US5-S.. / US5-R.. (events.status.test.js),
 *         US5-F.. (frontend StatusBadge.test.jsx, EventDetail.status.test.jsx, Dashboard.test.jsx)
 */
const { assertTransition, ALLOWED_TRANSITIONS } = require('../src/domain/statusMachine');
const { EVENT_STATUS } = require('../src/constants/statuses');

// AC1 · the statuses, written out by hand from the story.
const AC1_STATUSES = [
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PLANNING', 'AWAITING_SAFETY_CHECK',
  'PREPARATION', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED',
];

// The agreed matrix, written out by hand from the ACs plus the customer's earlier rules.
// Deliberately NOT imported from statusMachine.js, so the test checks the code against the
// requirement rather than against itself.
const EXPECTED_ALLOWED = [
  // main path
  ['DRAFT', 'SUBMITTED'],
  ['SUBMITTED', 'UNDER_REVIEW'],
  ['UNDER_REVIEW', 'APPROVED'], // AC2
  ['APPROVED', 'PLANNING'], // AC3
  ['PLANNING', 'AWAITING_SAFETY_CHECK'], // AC6
  ['AWAITING_SAFETY_CHECK', 'PREPARATION'], // AC7
  ['PREPARATION', 'CONFIRMED'], // SCRUM-73
  ['CONFIRMED', 'COMPLETED'],
  // rejection (AC4), essential requirements can't be met (Week 2 Q&A), resubmission (Week 4 Q&A)
  ['SUBMITTED', 'REJECTED'],
  ['UNDER_REVIEW', 'REJECTED'],
  ['PLANNING', 'REJECTED'],
  ['REJECTED', 'SUBMITTED'],
  // cancellation from any non-final status
  ['DRAFT', 'CANCELLED'],
  ['SUBMITTED', 'CANCELLED'],
  ['UNDER_REVIEW', 'CANCELLED'],
  ['REJECTED', 'CANCELLED'],
  ['APPROVED', 'CANCELLED'],
  ['PLANNING', 'CANCELLED'],
  ['AWAITING_SAFETY_CHECK', 'CANCELLED'],
  ['PREPARATION', 'CANCELLED'],
  ['CONFIRMED', 'CANCELLED'],
  // re-planning after a major change (Week 4 Q&A)
  ['CONFIRMED', 'PLANNING'],
];

const ALL_STATUSES = Object.values(EVENT_STATUS);
const isAllowed = (from, to) => EXPECTED_ALLOWED.some(([f, t]) => f === from && t === to);
const EXPECTED_BLOCKED = ALL_STATUSES
  .flatMap((from) => ALL_STATUSES.map((to) => [from, to]))
  .filter(([from, to]) => !isAllowed(from, to));

function errorFrom(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

describe('SCRUM-5 event status machine', () => {
  // AC1 · The system supports exactly the 11 statuses in the story.
  it('US5-M00: defines exactly the AC1 statuses', () => {
    expect(Object.values(EVENT_STATUS).sort()).toEqual([...AC1_STATUSES].sort());
  });

  // Every allowed step in the matrix succeeds.
  it.each(EXPECTED_ALLOWED)('US5-M01: allows %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  // Every other pair of statuses (skipping steps, going backwards, staying on the same
  // status, leaving COMPLETED/CANCELLED) fails with 409 INVALID_STATUS_TRANSITION.
  // This includes the key "no bypass" cases, e.g. PLANNING -> PREPARATION (skips the
  // safety check, AC7), APPROVED -> REJECTED (AC4 only from Submitted / Under Review)
  // and REJECTED -> APPROVED (must be resubmitted and reviewed again).
  it.each(EXPECTED_BLOCKED)('US5-M02: blocks %s -> %s with 409', (from, to) => {
    expect(errorFrom(() => assertTransition(from, to)))
      .toMatchObject({ status: 409, code: 'INVALID_STATUS_TRANSITION' });
  });

  // A status that doesn't exist (typo, the removed VENUE_SECURED value, missing) is refused.
  it.each(['ARCHIVED', 'VENUE_SECURED', undefined])('US5-M03: refuses unknown target status %s', (to) => {
    expect(errorFrom(() => assertTransition('DRAFT', to)))
      .toMatchObject({ status: 409, message: `Unknown event status: ${to}` });
  });

  // An event stuck on an unknown current status (bad data) can't move anywhere.
  it('US5-M04: an event with an unknown current status cannot move', () => {
    expect(errorFrom(() => assertTransition('VENUE_SECURED', 'PLANNING')))
      .toMatchObject({ status: 409 });
  });

  // Safety net: every status has a row in the matrix, so a status added later can't be
  // forgotten, and the matrix has no extra entries beyond the agreed list.
  it('US5-M05: the matrix defines exactly the agreed transitions for every status', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
    const actualPairs = Object.entries(ALLOWED_TRANSITIONS)
      .flatMap(([from, targets]) => targets.map((to) => [from, to]));
    const asKeys = (pairs) => pairs.map(([from, to]) => `${from}->${to}`).sort();
    expect(asKeys(actualPairs)).toEqual(asKeys(EXPECTED_ALLOWED));
  });
});

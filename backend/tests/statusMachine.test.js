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
  ['AWAITING_SAFETY_CHECK', 'PREPARATION'], // AC7 / SCRUM-56 approve
  ['AWAITING_SAFETY_CHECK', 'PLANNING'], // SCRUM-56 reject / request-changes
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

// M05 checks every pair against EXPECTED_ALLOWED. M01 and M02 run assertTransition on the
// moves the ACs name and on the shortcuts the ACs forbid, to show it reads that matrix.
const AC_MOVES = [
  // SCRUM-5-TC02
  ['DRAFT', 'SUBMITTED'],
  // SCRUM-5-TC03
  ['UNDER_REVIEW', 'APPROVED'], // AC2
  // SCRUM-5-TC04
  ['APPROVED', 'PLANNING'], // AC3
  // SCRUM-5-TC05
  ['SUBMITTED', 'REJECTED'], // AC4
  // SCRUM-5-TC06
  ['UNDER_REVIEW', 'REJECTED'], // AC4
  // SCRUM-5-TC07
  ['PLANNING', 'AWAITING_SAFETY_CHECK'], // AC6
  // SCRUM-5-TC08
  ['AWAITING_SAFETY_CHECK', 'PREPARATION'], // AC7
];

const FORBIDDEN_SHORTCUTS = [
  // SCRUM-5-TC09
  ['PLANNING', 'PREPARATION'], // AC7: skips the safety check
  // SCRUM-5-TC10
  ['APPROVED', 'AWAITING_SAFETY_CHECK'], // AC6: skips planning
  // SCRUM-5-TC11
  ['SUBMITTED', 'APPROVED'], // AC2: approved only after review
  // SCRUM-5-TC12
  ['APPROVED', 'REJECTED'], // AC4: rejected only from Submitted or Under Review
  // SCRUM-5-TC13
  ['REJECTED', 'APPROVED'], // must be resubmitted and reviewed again
  // SCRUM-5-TC14
  ['CANCELLED', 'PLANNING'], // Cancelled is final
  // SCRUM-5-TC15
  ['PLANNING', 'PLANNING'], // staying on the same status is not a move
];

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
  // SCRUM-5-TC01
  it('US5-M00: defines exactly the AC1 statuses', () => {
    expect(Object.values(EVENT_STATUS).sort()).toEqual([...AC1_STATUSES].sort());
  });

  // Each move the ACs name succeeds.
  it.each(AC_MOVES)('US5-M01: allows %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  // Each shortcut the ACs forbid fails with 409 INVALID_STATUS_TRANSITION.
  it.each(FORBIDDEN_SHORTCUTS)('US5-M02: blocks %s -> %s with 409', (from, to) => {
    expect(errorFrom(() => assertTransition(from, to)))
      .toMatchObject({ status: 409, code: 'INVALID_STATUS_TRANSITION' });
  });

  // A status that doesn't exist (a typo, or missing) is refused. The removed VENUE_SECURED
  // value is not separate: TC01 already shows it is not one of the statuses.
  it.each([
    // SCRUM-5-TC16
    'ARCHIVED',
    // SCRUM-5-TC17
    undefined,
  ])('US5-M03: refuses unknown target status %s', (to) => {
    expect(errorFrom(() => assertTransition('DRAFT', to)))
      .toMatchObject({ status: 409, message: `Unknown event status: ${to}` });
  });

  // An event stuck on an unknown current status (bad data) can't move anywhere.
  // SCRUM-5-TC18
  it('US5-M04: an event with an unknown current status cannot move', () => {
    expect(errorFrom(() => assertTransition('VENUE_SECURED', 'PLANNING')))
      .toMatchObject({ status: 409 });
  });

  // Safety net: every status has a row in the matrix, so a status added later can't be
  // forgotten, and the matrix has no extra entries beyond the agreed list.
  // SCRUM-5-TC19
  it('US5-M05: the matrix defines exactly the agreed transitions for every status', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
    const actualPairs = Object.entries(ALLOWED_TRANSITIONS)
      .flatMap(([from, targets]) => targets.map((to) => [from, to]));
    const asKeys = (pairs) => pairs.map(([from, to]) => `${from}->${to}`).sort();
    expect(asKeys(actualPairs)).toEqual(asKeys(EXPECTED_ALLOWED));
  });
});

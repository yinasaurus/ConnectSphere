/**
 * SCRUM-5: Progressing Event Statuses (status machine unit tests)
 *
 * Acceptance criteria covered:
 *   AC1  Statuses move strictly along Draft -> Pending Review -> Approved - Pending Venue
 *        -> Venue Secured -> Confirmed -> Completed (or Rejected / Cancelled).
 *   AC2  Any transition outside this matrix fails with HTTP 400.
 *
 * Stored values used in code (label shown to users):
 *   DRAFT (Draft), UNDER_REVIEW (Pending review), PLANNING (Approved - pending venue),
 *   VENUE_SECURED (Venue secured), CONFIRMED, COMPLETED, REJECTED, CANCELLED
 *
 * Labels: US5-M.. (this file), US5-S.. / US5-R.. (events.status.test.js),
 *         US5-F.. (frontend StatusBadge.test.jsx, EventDetail.status.test.jsx)
 */
const { assertTransition, ALLOWED_TRANSITIONS } = require('../src/domain/statusMachine');
const { EVENT_STATUS } = require('../src/constants/statuses');

// The agreed matrix, written out by hand from AC1 plus the customer's backward steps.
// Deliberately NOT imported from statusMachine.js, so the test checks the code against the
// requirement rather than against itself.
const EXPECTED_ALLOWED = [
  // main path (AC1)
  ['DRAFT', 'UNDER_REVIEW'],
  ['UNDER_REVIEW', 'PLANNING'],
  ['PLANNING', 'VENUE_SECURED'],
  ['VENUE_SECURED', 'CONFIRMED'],
  ['CONFIRMED', 'COMPLETED'],
  // rejection (AC1 "or Rejected") and resubmission (Week 4 Q&A)
  ['UNDER_REVIEW', 'REJECTED'],
  ['PLANNING', 'REJECTED'],
  ['REJECTED', 'UNDER_REVIEW'],
  // cancellation (AC1 "or Cancelled") from any non-final status
  ['DRAFT', 'CANCELLED'],
  ['UNDER_REVIEW', 'CANCELLED'],
  ['REJECTED', 'CANCELLED'],
  ['PLANNING', 'CANCELLED'],
  ['VENUE_SECURED', 'CANCELLED'],
  ['CONFIRMED', 'CANCELLED'],
  // re-planning: venue falls through (Week 7 change 2) / major change (Week 4 Q&A)
  ['VENUE_SECURED', 'PLANNING'],
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
  // AC1 · Every allowed step in the matrix succeeds.
  it.each(EXPECTED_ALLOWED)('US5-M01: allows %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  // AC2 · Every other pair of statuses (skipping steps, going backwards, staying on the
  // same status, leaving COMPLETED/CANCELLED) fails with 400 INVALID_STATUS_TRANSITION.
  // This includes the key "no bypass" cases, e.g. DRAFT -> PLANNING (skips review) and
  // PLANNING -> CONFIRMED (skips the venue booking).
  it.each(EXPECTED_BLOCKED)('US5-M02: blocks %s -> %s with 400', (from, to) => {
    expect(errorFrom(() => assertTransition(from, to)))
      .toMatchObject({ status: 400, code: 'INVALID_STATUS_TRANSITION' });
  });

  // AC2 · A status that doesn't exist (typo, old SUBMITTED value, missing) is refused with 400.
  it.each(['ARCHIVED', 'SUBMITTED', undefined])('US5-M03: refuses unknown target status %s', (to) => {
    expect(errorFrom(() => assertTransition('DRAFT', to)))
      .toMatchObject({ status: 400, message: `Unknown event status: ${to}` });
  });

  // AC2 · An event stuck on an unknown current status (bad data) can't move anywhere.
  it('US5-M04: an event with an unknown current status cannot move', () => {
    expect(errorFrom(() => assertTransition('SUBMITTED', 'UNDER_REVIEW')))
      .toMatchObject({ status: 400 });
  });

  // Safety net: every status has a row in the matrix, so a status added later can't be
  // forgotten, and the matrix has no extra entries beyond the agreed list.
  it('US5-M05: the matrix defines exactly the agreed transitions for every status', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
    const actualPairs = Object.entries(ALLOWED_TRANSITIONS)
      .flatMap(([from, targets]) => targets.map((to) => [from, to]));
    expect(actualPairs).toHaveLength(EXPECTED_ALLOWED.length);
  });
});

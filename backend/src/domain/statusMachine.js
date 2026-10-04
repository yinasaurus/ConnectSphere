const { EVENT_STATUS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');

const {
  DRAFT, UNDER_REVIEW, PLANNING, VENUE_SECURED, CONFIRMED, COMPLETED, CANCELLED, REJECTED,
} = EVENT_STATUS;

// Main path: DRAFT -> UNDER_REVIEW -> PLANNING -> VENUE_SECURED -> CONFIRMED -> COMPLETED.
// The backward steps are customer rules:
//   REJECTED -> UNDER_REVIEW       rejected requests can be resubmitted (Week 4 Q&A)
//   PLANNING -> REJECTED           essential requirements can't be met (Week 2 Q&A)
//   VENUE_SECURED -> PLANNING      the secured venue falls through (Week 7 change 2)
//   CONFIRMED -> PLANNING          a major change needs re-planning (Week 4 Q&A)
// COMPLETED and CANCELLED are final (Week 4 Q&A: "When an event is cancelled, it is cancelled").
const ALLOWED = {
  [DRAFT]: [UNDER_REVIEW, CANCELLED],
  [UNDER_REVIEW]: [PLANNING, REJECTED, CANCELLED],
  [REJECTED]: [UNDER_REVIEW, CANCELLED],
  [PLANNING]: [VENUE_SECURED, REJECTED, CANCELLED],
  [VENUE_SECURED]: [CONFIRMED, PLANNING, CANCELLED],
  [CONFIRMED]: [COMPLETED, PLANNING, CANCELLED],
  [COMPLETED]: [],
  [CANCELLED]: [],
};

function assertTransition(from, to) {
  if (!Object.values(EVENT_STATUS).includes(to)) {
    throw httpError(400, `Unknown event status: ${to}`, 'INVALID_STATUS_TRANSITION');
  }
  const allowed = ALLOWED[from] || [];
  if (!allowed.includes(to)) {
    throw httpError(
      400,
      `Cannot move event from ${from} to ${to}`,
      'INVALID_STATUS_TRANSITION'
    );
  }
}

module.exports = { assertTransition, ALLOWED_TRANSITIONS: ALLOWED };

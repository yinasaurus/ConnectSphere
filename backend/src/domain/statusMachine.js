const { EVENT_STATUS } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');

const {
  DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, PLANNING, AWAITING_SAFETY_CHECK, PREPARATION,
  CONFIRMED, COMPLETED, CANCELLED, REJECTED,
} = EVENT_STATUS;

// Main path: DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> PLANNING
//   -> AWAITING_SAFETY_CHECK -> PREPARATION -> CONFIRMED -> COMPLETED.
// Other customer rules:
//   SUBMITTED / UNDER_REVIEW -> REJECTED   coordinator rejects with a reason
//   PLANNING -> REJECTED                   essential requirements can't be met (Week 2 Q&A)
//   REJECTED -> SUBMITTED                  rejected requests can be resubmitted (Week 4 Q&A)
//   CONFIRMED -> PLANNING                  a major change needs re-planning (Week 4 Q&A)
// COMPLETED and CANCELLED are final (Week 4 Q&A: "When an event is cancelled, it is cancelled").
const ALLOWED = {
  [DRAFT]: [SUBMITTED, CANCELLED],
  [SUBMITTED]: [UNDER_REVIEW, REJECTED, CANCELLED],
  [UNDER_REVIEW]: [APPROVED, REJECTED, CANCELLED],
  [REJECTED]: [SUBMITTED, CANCELLED],
  [APPROVED]: [PLANNING, CANCELLED],
  [PLANNING]: [AWAITING_SAFETY_CHECK, REJECTED, CANCELLED],
  [AWAITING_SAFETY_CHECK]: [PREPARATION, CANCELLED],
  [PREPARATION]: [CONFIRMED, CANCELLED],
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

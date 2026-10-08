const { EVENT_STATUS, EVENT_SUB_STATE } = require('../constants/statuses');
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

const ALLOWED_SUB_STATES = {
  [EVENT_SUB_STATE.IN_REVIEW]: [EVENT_SUB_STATE.ACTION_REQUIRED],
  [EVENT_SUB_STATE.ACTION_REQUIRED]: [EVENT_SUB_STATE.CLARIFICATION_PROVIDED],
  [EVENT_SUB_STATE.CLARIFICATION_PROVIDED]: [EVENT_SUB_STATE.ACTION_REQUIRED],
};

// Kept at 409 (Conflict), not 400: SCRUM-64 already shipped on this exact status
// code for an invalid transition (e.g. a Draft request can't be opened for review),
// and that test is already merged into main.
function assertTransition(from, to) {
  if (!Object.values(EVENT_STATUS).includes(to)) {
    throw httpError(409, `Unknown event status: ${to}`, 'INVALID_STATUS_TRANSITION');
  }
  const allowed = ALLOWED[from] || [];
  if (!allowed.includes(to)) {
    throw httpError(
      409,
      `Cannot move event from ${from} to ${to}`,
      'INVALID_STATUS_TRANSITION'
    );
  }
}

function assertSubStateTransition(from, to) {
  const effectiveFrom = from || EVENT_SUB_STATE.IN_REVIEW;
  const allowed = ALLOWED_SUB_STATES[effectiveFrom] || [];
  if (!allowed.includes(to)) {
    throw httpError(
      409,
      `Cannot move event sub-state from ${effectiveFrom} to ${to}`,
      'INVALID_SUB_STATE_TRANSITION'
    );
  }
}

module.exports = {
  assertTransition,
  assertSubStateTransition,
  ALLOWED_TRANSITIONS: ALLOWED,
  ALLOWED_SUB_STATES,
};

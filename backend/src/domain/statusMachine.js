const { EVENT_STATUS, EVENT_SUB_STATE } = require('../constants/statuses');
const { httpError } = require('../middleware/errorHandler');

const ALLOWED = {
  [EVENT_STATUS.DRAFT]: [EVENT_STATUS.SUBMITTED, EVENT_STATUS.CANCELLED],
  [EVENT_STATUS.SUBMITTED]: [EVENT_STATUS.UNDER_REVIEW, EVENT_STATUS.CANCELLED],
  [EVENT_STATUS.UNDER_REVIEW]: [
    EVENT_STATUS.PLANNING,
    EVENT_STATUS.REJECTED,
    EVENT_STATUS.CANCELLED,
  ],
  [EVENT_STATUS.REJECTED]: [EVENT_STATUS.SUBMITTED, EVENT_STATUS.CANCELLED],
  [EVENT_STATUS.PLANNING]: [
    EVENT_STATUS.CONFIRMED,
    EVENT_STATUS.REJECTED,
    EVENT_STATUS.CANCELLED,
  ],
  [EVENT_STATUS.CONFIRMED]: [
    EVENT_STATUS.COMPLETED,
    EVENT_STATUS.CANCELLED,
    EVENT_STATUS.PLANNING,
  ],
  [EVENT_STATUS.COMPLETED]: [],
  [EVENT_STATUS.CANCELLED]: [],
};

const ALLOWED_SUB_STATES = {
  [EVENT_SUB_STATE.IN_REVIEW]: [EVENT_SUB_STATE.ACTION_REQUIRED],
  [EVENT_SUB_STATE.ACTION_REQUIRED]: [EVENT_SUB_STATE.CLARIFICATION_PROVIDED],
  [EVENT_SUB_STATE.CLARIFICATION_PROVIDED]: [EVENT_SUB_STATE.ACTION_REQUIRED],
};

function assertTransition(from, to) {
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

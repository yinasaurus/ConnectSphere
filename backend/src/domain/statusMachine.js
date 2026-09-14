const { EVENT_STATUS } = require('../constants/statuses');
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

module.exports = { assertTransition, ALLOWED_TRANSITIONS: ALLOWED };

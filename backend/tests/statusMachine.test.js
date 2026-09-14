const { assertTransition } = require('../src/domain/statusMachine');
const { EVENT_STATUS } = require('../src/constants/statuses');

describe('event status machine', () => {
  it('allows draft to submitted', () => {
    expect(() => assertTransition(EVENT_STATUS.DRAFT, EVENT_STATUS.SUBMITTED)).not.toThrow();
  });

  it('allows rejected events to be resubmitted', () => {
    expect(() => assertTransition(EVENT_STATUS.REJECTED, EVENT_STATUS.SUBMITTED)).not.toThrow();
  });

  it('allows confirmed events to revert to planning after a major change', () => {
    expect(() => assertTransition(EVENT_STATUS.CONFIRMED, EVENT_STATUS.PLANNING)).not.toThrow();
  });

  it('blocks jumping from draft to confirmed', () => {
    expect(() => assertTransition(EVENT_STATUS.DRAFT, EVENT_STATUS.CONFIRMED)).toThrow();
  });
});

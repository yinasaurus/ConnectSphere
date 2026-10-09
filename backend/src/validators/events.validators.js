const { z } = require('zod');
const { EVENT_DECISION, MIN_REJECTION_REASON_LENGTH } = require('../constants/statuses');

const REJECTION_REASON_MESSAGE = `Rejection reason must be at least ${MIN_REJECTION_REASON_LENGTH} characters`;

const eventDecisionSchema = z.object({
  decision: z.enum(Object.values(EVENT_DECISION), {
    error: 'Decision must be APPROVE or REJECT',
  }),
  reason: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : ''),
    z.string().max(1000, 'Reason must be 1000 characters or fewer')
  ),
}).superRefine((data, ctx) => {
  if (data.decision === EVENT_DECISION.REJECT && data.reason.length < MIN_REJECTION_REASON_LENGTH) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: REJECTION_REASON_MESSAGE });
  }
});

/**
 * Purpose: require a numeric coordinator id on the Lead assign action.
 * AC: SCRUM-71 AC1
 * Inputs: request body. Output: { coordinatorId }. Failure: 400 when missing or not a positive integer.
 */
const assignCoordinatorSchema = z.object({
  coordinatorId: z.coerce.number({ error: 'Coordinator is required' }).int().positive('Coordinator is required'),
});

module.exports = { eventDecisionSchema, REJECTION_REASON_MESSAGE, assignCoordinatorSchema };

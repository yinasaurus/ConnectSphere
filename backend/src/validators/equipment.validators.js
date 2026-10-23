const { z } = require('zod');

/**
 * Purpose: validate body for creating an equipment request (SCRUM-47).
 * AC: SCRUM-47 AC1–AC4
 *
 * Cross-field rules enforced here (business logic stays in the service):
 *   1. startAt and endAt must both be supplied, or both omitted — a lone value is rejected.
 *   2. When both dates are supplied, startAt must be before endAt.
 */
const createEquipmentRequestSchema = z
  .object({
    eventId: z.coerce
      .number({ error: 'eventId is required' })
      .int()
      .positive('eventId is required')
      .optional(),
    equipmentId: z.coerce.number().int().positive().nullable().optional(),
    equipmentType: z.string().trim().min(1).nullable().optional(),
    quantity: z.coerce
      .number({ error: 'quantity must be a whole number of at least 1' })
      .int('quantity must be a whole number of at least 1')
      .min(1, 'quantity must be a whole number of at least 1')
      .optional(),
    technicalRequirements: z.string().trim().max(2000).nullable().optional(),
    specifications: z.string().trim().max(2000).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    startAt: z
      .string()
      .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), {
        message: 'startAt must be a valid ISO date',
      })
      .nullable()
      .optional(),
    endAt: z
      .string()
      .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), {
        message: 'endAt must be a valid ISO date',
      })
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    // startAt and endAt must be supplied together and in order
    const hasStart = !!data.startAt;
    const hasEnd = !!data.endAt;
    if (hasStart !== hasEnd) {
      const missing = hasStart ? 'endAt' : 'startAt';
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [missing],
        message: `${missing} is required when the other date is provided`,
      });
    } else if (hasStart && hasEnd) {
      const s = new Date(data.startAt);
      const e = new Date(data.endAt);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s >= e) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['startAt'],
          message: 'from must be before to',
        });
      }
    }
  });

module.exports = {
  createEquipmentRequestSchema,
};

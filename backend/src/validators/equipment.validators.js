const { z } = require('zod');

/**
 * Purpose: validate body for creating an equipment request (SCRUM-47).
 * AC: SCRUM-47 AC1–AC4
 */
const createEquipmentRequestSchema = z.object({
  eventId: z.coerce.number({ error: 'eventId is required' }).int().positive('eventId is required').optional(),
  equipmentId: z.coerce.number().int().positive().nullable().optional(),
  equipmentType: z.string().trim().min(1).nullable().optional(),
  quantity: z.coerce.number({ error: 'quantity must be a whole number of at least 1' })
    .int('quantity must be a whole number of at least 1')
    .min(1, 'quantity must be a whole number of at least 1')
    .optional(),
  technicalRequirements: z.string().trim().max(2000).nullable().optional(),
  specifications: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  startAt: z.string().nullable().optional(),
  endAt: z.string().nullable().optional(),
});

module.exports = {
  createEquipmentRequestSchema,
};

const { z } = require('zod');

const optionalText = z.string().trim().min(1).optional();
const optionalNullableText = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().min(1).nullable().optional()
);
const optionalNonNegativeInteger = z.number({
  message: 'Capacity must be a number',
}).int('Capacity must be a whole number').min(0, 'Capacity must be at least 0').optional();
const layoutName = z.string().trim().min(1);

const layoutUpdate = z.object({
  id: z.number().int().positive().optional(),
  layout: layoutName.optional(),
  deleted: z.boolean().optional().default(false),
}).strict().refine(
  (value) => value.deleted || value.layout,
  'A layout name is required unless the layout is being deleted'
);

// Venue catalogue validation keeps capacity optional while rejecting incomplete numeric values.
const venueFields = {
  name: optionalText,
  location: optionalNullableText,
  capacity: optionalNonNegativeInteger,
  facilities: optionalNullableText,
  accessibility: optionalNullableText,
  operatingHours: optionalNullableText,
  setupMinutes: z.number({
    message: 'Setup minutes must be a number',
  }).int('Setup minutes must be a whole number').min(0, 'Setup minutes must be at least 0').optional(),
  teardownMinutes: z.number({
    message: 'Teardown minutes must be a number',
  }).int('Teardown minutes must be a whole number').min(0, 'Teardown minutes must be at least 0').optional(),
  isActive: z.boolean().optional(),
  layouts: z.array(layoutName).transform((layouts) => [...new Set(layouts)]).optional(),
};

const createVenueSchema = z.object({
  ...venueFields,
  name: z.string().trim().min(1, 'Venue name is required'),
}).strict();

const updateVenueSchema = z.object({
  ...venueFields,
  layouts: z.array(layoutUpdate).optional(),
}).strict();

module.exports = {
  createVenueSchema,
  updateVenueSchema,
};

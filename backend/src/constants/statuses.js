/**
 * Event lifecycle statuses (SCRUM-5):
 *
 * DRAFT                  – saved before submission
 * SUBMITTED              – sent for review
 * UNDER_REVIEW           – coordinator assigned and reviewing
 * APPROVED               – enough information to plan (W4)
 * PLANNING               – venue/equipment sourcing underway
 * AWAITING_SAFETY_CHECK  – every venue booking approved and requested equipment reserved
 * PREPARATION            – Safety Officer approved the safety check (W7 #6)
 * CONFIRMED              – essential arrangements completed (W4)
 * COMPLETED              – event finished
 * CANCELLED              – will not proceed
 * REJECTED               – not accepted; organiser may resubmit after changes
 */
const EVENT_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  PLANNING: 'PLANNING',
  AWAITING_SAFETY_CHECK: 'AWAITING_SAFETY_CHECK',
  PREPARATION: 'PREPARATION',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
};

const SIGNIFICANT_FIELDS = [
  'startAt',
  'endAt',
  'expectedAttendance',
  'requestedVenueId',
  'accessibilityNeeds',
  'layoutPreference',
];

const BOOKING_STATUS = {
  PENDING: 'PENDING',
  TENTATIVE: 'TENTATIVE',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

const EQUIPMENT_STATUS = {
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  MAINTENANCE: 'MAINTENANCE',
  DAMAGED: 'DAMAGED',
};

const REGISTRATION_STATUS = {
  REGISTERED: 'REGISTERED',
  WAITLISTED: 'WAITLISTED',
  WITHDRAWN: 'WITHDRAWN',
  ATTENDED: 'ATTENDED',
  NO_SHOW: 'NO_SHOW',
};

module.exports = {
  EVENT_STATUS,
  SIGNIFICANT_FIELDS,
  BOOKING_STATUS,
  EQUIPMENT_STATUS,
  REGISTRATION_STATUS,
};

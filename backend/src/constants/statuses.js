/**
 * Event lifecycle statuses from the customer briefing + G3/G4 Q&A.
 *
 * Draft            – saved before submission
 * Submitted        – sent for review
 * Under Review     – coordinator assigned; clarification is a sub-state of this
 * Planning         – approved; venue/equipment arrangements underway
 * Confirmed        – essential arrangements completed
 * Completed        – event finished
 * Cancelled        – event will not proceed
 * Rejected         – not accepted; organiser may resubmit after changes
 */
const EVENT_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  PLANNING: 'PLANNING',
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

const EVENT_SUB_STATE = {
  IN_REVIEW: 'IN_REVIEW',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  CLARIFICATION_PROVIDED: 'CLARIFICATION_PROVIDED',
};

module.exports = {
  EVENT_STATUS,
  EVENT_SUB_STATE,
  SIGNIFICANT_FIELDS,
  BOOKING_STATUS,
  EQUIPMENT_STATUS,
  REGISTRATION_STATUS,
};

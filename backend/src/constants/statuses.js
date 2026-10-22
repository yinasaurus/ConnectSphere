/**
 * Event lifecycle statuses (SCRUM-5):
 *
 * DRAFT                  – saved before submission (not in the unassigned queue)
 * SUBMITTED              – in the Lead's unassigned queue; no Coordinator yet (W7 #5 / SCRUM-28)
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

const EVENT_DECISION = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
};

const MIN_REJECTION_REASON_LENGTH = 10;

// Historically named the “significant” Confirmed lock set. SCRUM-40 2A now locks
// every direct edit on Confirmed; critical Confirmed changes use CHANGE_REQUEST_FIELDS.
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

const EQUIPMENT_REQUEST_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  PREPARING: 'PREPARING',
  RESERVED: 'RESERVED',
  READY: 'READY',
  UNAVAILABLE: 'UNAVAILABLE',
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

const CHANGE_REQUEST_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

// SCRUM-34 AC2: only these event fields may be proposed. Anything else is 400.
const CHANGE_REQUEST_FIELDS = [
  'startAt',
  'endAt',
  'expectedAttendance',
  'venueRequirements',
  'equipmentNotes',
];

/**
 * SCRUM-56: Safety Officer records exactly one of these for an awaiting check.
 * APPROVED clears the event for Preparation; REJECTED and REQUEST_CHANGES return it to Planning.
 */
const SAFETY_CHECK_OUTCOME = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REQUEST_CHANGES: 'REQUEST_CHANGES',
};

const SAFETY_ARRANGEMENT_TYPE = {
  VENUE_BOOKING: 'VENUE_BOOKING',
  EQUIPMENT_REQUEST: 'EQUIPMENT_REQUEST',
};

module.exports = {
  EVENT_STATUS,
  EVENT_SUB_STATE,
  EVENT_DECISION,
  MIN_REJECTION_REASON_LENGTH,
  SIGNIFICANT_FIELDS,
  BOOKING_STATUS,
  EQUIPMENT_STATUS,
  EQUIPMENT_REQUEST_STATUS,
  REGISTRATION_STATUS,
  CHANGE_REQUEST_STATUS,
  CHANGE_REQUEST_FIELDS,
  SAFETY_CHECK_OUTCOME,
  SAFETY_ARRANGEMENT_TYPE,
};

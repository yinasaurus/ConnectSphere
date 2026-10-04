/**
 * Event lifecycle statuses (SCRUM-5). Stored value – label shown to users:
 *
 * DRAFT          – Draft: saved before submission
 * UNDER_REVIEW   – Pending review: submitted; coordinator assigned and reviewing
 * PLANNING       – Approved - pending venue: approved; venue being arranged
 * VENUE_SECURED  – Venue secured: a venue booking has been approved
 * CONFIRMED      – Confirmed: essential arrangements completed
 * COMPLETED      – Completed: event finished
 * CANCELLED      – Cancelled: will not proceed
 * REJECTED       – Rejected: not accepted; organiser may resubmit after changes
 */
const EVENT_STATUS = {
  DRAFT: 'DRAFT',
  UNDER_REVIEW: 'UNDER_REVIEW',
  PLANNING: 'PLANNING',
  VENUE_SECURED: 'VENUE_SECURED',
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

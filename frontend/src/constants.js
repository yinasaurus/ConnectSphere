export const ROLES = {
  EVENT_ORGANISER: 'EVENT_ORGANISER',
  EVENT_COORDINATOR: 'EVENT_COORDINATOR',
  EVENT_COORDINATOR_LEAD: 'EVENT_COORDINATOR_LEAD',
  VENUE_STAFF: 'VENUE_STAFF',
  TECHNICAL_SUPPORT: 'TECHNICAL_SUPPORT',
  ATTENDEE: 'ATTENDEE',
};

export const ROLE_LABELS = {
  EVENT_ORGANISER: 'Event Organiser',
  EVENT_COORDINATOR: 'Event Coordinator',
  EVENT_COORDINATOR_LEAD: 'Event Coordinator Lead',
  VENUE_STAFF: 'Venue Staff',
  TECHNICAL_SUPPORT: 'Technical Support',
  ATTENDEE: 'Attendee',
};

export const STATUS_LABELS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  PLANNING: 'Planning',
  AWAITING_SAFETY_CHECK: 'Awaiting Safety Check',
  PREPARATION: 'Preparation',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

export const SUB_STATES = {
  IN_REVIEW: 'IN_REVIEW',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  CLARIFICATION_PROVIDED: 'CLARIFICATION_PROVIDED',
};

export const SUB_STATE_LABELS = {
  IN_REVIEW: 'In review',
  ACTION_REQUIRED: 'Clarification requested',
  CLARIFICATION_PROVIDED: 'Clarification provided',
};

export const MIN_REJECTION_REASON_LENGTH = 10;

// SCRUM-5 AC5: how often dashboards and the event page re-fetch so status changes appear without a reload.
export const LIVE_REFRESH_MS = 10000;

export const CATEGORIES = [
  'CONFERENCE',
  'WORKSHOP',
  'TRAINING',
  'EXHIBITION',
  'MEETING',
  'SEMINAR',
  'NETWORKING',
  'OTHER',
];

export const LAYOUTS = ['THEATRE', 'CLASSROOM', 'BOARDROOM', 'BANQUET', 'EXHIBITION'];

export const DEMO_ACCOUNTS = [
  { email: 'organiser@acme.example', role: 'Organiser (Acme)' },
  { email: 'coordinator@connectsphere.sg', role: 'Coordinator' },
  { email: 'lead@connectsphere.sg', role: 'Lead' },
  { email: 'venue@connectsphere.sg', role: 'Venue staff' },
  { email: 'tech@connectsphere.sg', role: 'Technical support' },
  { email: 'attendee@example.com', role: 'Attendee' },
  { email: 'hybrid@connectsphere.sg', role: 'Coordinator + Venue' },
];

export const DEMO_PASSWORD = 'Password123!';

/**
 * Purpose: send each role to a useful first screen after login.
 * AC: SCRUM-65 AC1 — the Lead lands on the unassigned queue so they can see new requests.
 * Inputs: role name array from the session. Outputs: an in-app path.
 * Failure: unknown roles fall through to `/app`.
 */
export function homePathForRoles(roles = []) {
  if (roles.includes(ROLES.EVENT_COORDINATOR_LEAD)) return '/app/events/unassigned';
  if (roles.includes(ROLES.EVENT_COORDINATOR)) return '/app';
  if (roles.includes(ROLES.VENUE_STAFF)) return '/app/venues';
  if (roles.includes(ROLES.TECHNICAL_SUPPORT)) return '/app/equipment';
  if (roles.includes(ROLES.EVENT_ORGANISER)) return '/app/events';
  if (roles.includes(ROLES.ATTENDEE)) return '/app/events';
  return '/app';
}

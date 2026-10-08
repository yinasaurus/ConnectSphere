/**
 * Purpose: role names that match backend user_roles.role after login.
 * AC: SCRUM-54 AC1, AC2
 * Business rule: W4 multiple roles; W7 #5 Lead; W7 #6 Safety Officer.
 */
export const ROLES = {
  EVENT_ORGANISER: 'EVENT_ORGANISER',
  EVENT_COORDINATOR: 'EVENT_COORDINATOR',
  EVENT_COORDINATOR_LEAD: 'EVENT_COORDINATOR_LEAD',
  SAFETY_OFFICER: 'SAFETY_OFFICER',
  VENUE_STAFF: 'VENUE_STAFF',
  TECHNICAL_SUPPORT: 'TECHNICAL_SUPPORT',
  ATTENDEE: 'ATTENDEE',
};

/**
 * Purpose: labels shown in the header and profile after a valid login so the
 * session is recognised as Lead or Safety Officer (and any other held roles).
 * AC: SCRUM-54 AC1
 */
export const ROLE_LABELS = {
  EVENT_ORGANISER: 'Event Organiser',
  EVENT_COORDINATOR: 'Event Coordinator',
  EVENT_COORDINATOR_LEAD: 'Lead',
  SAFETY_OFFICER: 'Safety Officer',
  VENUE_STAFF: 'Venue Staff',
  TECHNICAL_SUPPORT: 'Technical Support',
  ATTENDEE: 'Attendee',
};

export const STATUS_LABELS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  PLANNING: 'Planning',
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
  { email: 'leadcoord@connectsphere.sg', role: 'Coordinator + Lead' },
  { email: 'safety@connectsphere.sg', role: 'Safety Officer' },
  { email: 'venue@connectsphere.sg', role: 'Venue staff' },
  { email: 'tech@connectsphere.sg', role: 'Technical support' },
  { email: 'attendee@example.com', role: 'Attendee' },
  { email: 'hybrid@connectsphere.sg', role: 'Coordinator + Venue' },
];

export const DEMO_PASSWORD = 'Password123!';

/**
 * Purpose: send each role to a home screen they are allowed to use.
 * AC: SCRUM-54 AC1, AC2 (a hybrid account still lands on a screen for a role they hold).
 * Inputs: roles array from the login payload. Output: an in-app path.
 */
export function homePathForRoles(roles = []) {
  if (roles.includes(ROLES.EVENT_COORDINATOR) || roles.includes(ROLES.EVENT_COORDINATOR_LEAD)) return '/app';
  if (roles.includes(ROLES.SAFETY_OFFICER)) return '/app';
  if (roles.includes(ROLES.VENUE_STAFF)) return '/app/venues';
  if (roles.includes(ROLES.TECHNICAL_SUPPORT)) return '/app/equipment';
  if (roles.includes(ROLES.EVENT_ORGANISER)) return '/app/events';
  if (roles.includes(ROLES.ATTENDEE)) return '/app/events';
  return '/app';
}

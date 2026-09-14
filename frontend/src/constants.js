export const ROLES = {
  EVENT_ORGANISER: 'EVENT_ORGANISER',
  EVENT_COORDINATOR: 'EVENT_COORDINATOR',
  VENUE_STAFF: 'VENUE_STAFF',
  TECHNICAL_SUPPORT: 'TECHNICAL_SUPPORT',
  ATTENDEE: 'ATTENDEE',
};

export const ROLE_LABELS = {
  EVENT_ORGANISER: 'Event Organiser',
  EVENT_COORDINATOR: 'Event Coordinator',
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
  { email: 'venue@connectsphere.sg', role: 'Venue staff' },
  { email: 'tech@connectsphere.sg', role: 'Technical support' },
  { email: 'attendee@example.com', role: 'Attendee' },
  { email: 'hybrid@connectsphere.sg', role: 'Coordinator + Venue' },
];

export const DEMO_PASSWORD = 'Password123!';

/**
 * Purpose: canonical role names stored in user_roles.role and returned after login.
 * AC: SCRUM-54 AC1 (Lead and Safety Officer are first-class roles);
 *     SCRUM-54 AC2 (one account may hold more than one of these in the same session).
 * Business rule: W4 — accounts are created outside the system; multiple roles are
 * possible. W7 #5 — Coordinator Lead controls unassigned work. W7 #6 — Safety Officer.
 */
const ROLES = {
  EVENT_ORGANISER: 'EVENT_ORGANISER',
  EVENT_COORDINATOR: 'EVENT_COORDINATOR',
  EVENT_COORDINATOR_LEAD: 'EVENT_COORDINATOR_LEAD',
  SAFETY_OFFICER: 'SAFETY_OFFICER',
  VENUE_STAFF: 'VENUE_STAFF',
  TECHNICAL_SUPPORT: 'TECHNICAL_SUPPORT',
  ATTENDEE: 'ATTENDEE',
};

const ALL_ROLES = Object.values(ROLES);

const INTERNAL_ROLES = [
  ROLES.EVENT_COORDINATOR,
  ROLES.EVENT_COORDINATOR_LEAD,
  ROLES.SAFETY_OFFICER,
  ROLES.VENUE_STAFF,
  ROLES.TECHNICAL_SUPPORT,
];

module.exports = { ROLES, ALL_ROLES, INTERNAL_ROLES };

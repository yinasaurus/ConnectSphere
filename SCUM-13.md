# SCUM-13: role-based access control

## Scope and policy

Server-side authorisation is the security boundary. React guards and navigation provide matching user experience. Users may hold several roles; any permitted role is sufficient. Roles are reloaded from `user_roles` after JWT verification; browser fields and token role claims do not override database roles.

| Action | Allowed access |
| --- | --- |
| Create request; open new-request/My drafts pages | Organiser or Coordinator (preserves existing repository policy) |
| Edit request | Owner within existing draft/edit rules, or assigned Coordinator; role must be Organiser/Coordinator |
| Submit request | Owner with Organiser/Coordinator role, or assigned Coordinator |
| Review/change event status | Assigned Coordinator only |
| Read events | Organisers: same organisation; internal staff: existing visibility; attendees: confirmed registration-enabled events, public fields only |
| Read/post planning discussion; read history | Planning roles with event access; no attendee-only access |
| Venue page/global booking queue | Coordinator or Venue Staff |
| Create/update venue; decide booking | Venue Staff |
| Request venue booking | Coordinator |
| Event-specific bookings | Event access checked first, query constrained to event; attendees see approved bookings only; internal notes omitted |
| Equipment page | Coordinator or Technical Support (matches existing navigation) |

Missing/invalid/expired session and disabled users receive 401. Wrong roles receive 403. Inaccessible event IDs receive 404 to avoid disclosing other clients' events. Frontend role denial redirects home; logged-out users redirect to login.

## Changes and evidence

- Restricted the global booking list, retaining venue mutation guards.
- Added `/api/events/:id/venue-bookings` and migrated EventDetail so organiser event pages still work.
- Added reusable frontend allowed-role checks; guarded venue, equipment, creation, draft and edit pages. The edit form waits for ownership/assignment checks; backend remains authoritative.
- Added role guards for event update/submission, enforced coordinator assignment for submission/review, and checked event access for comments.
- Restricted attendee planning history/comments and removed internal fields from attendee event responses.

## Automated verification

- `backend/tests/rbac.routes.test.js`: actual JWT verification, current database role checks, all roles plus unknown role, denied handlers not invoked, missing/invalid/expired tokens, disabled users, hybrid account, untrusted request/token role claims.
- `backend/tests/events.permissions.test.js`: owner versus other organiser, assigned versus unassigned Coordinator, draft edits, submission and review.
- `backend/tests/events.bookings.test.js`: same-client access, cross-client rejection before querying bookings, missing event, comment access and attendee privacy.
- `backend/tests/venues.authorization.test.js`: global queue role regression.
- `frontend/src/components/ProtectedRoute.test.jsx`: session loading, login redirect, denied roles, allowed roles, hybrid role and unrestricted authenticated route.
- `frontend/src/pages/EventDetail.test.jsx`: organiser event details load without calling the restricted global queue.

Run `npm test`, `npm run lint`, and `npm run build` from the repository root. Tests mock database access; they do not seed, alter or require the shared database.

Local verification on 2026-09-21: 118 backend tests and 17 frontend tests passed; lint and production build passed. These are automated results, not a claim that the manual review checklist or remote CI has been completed.

## Manual review before merge

1. Organiser opens `/app/venues`: redirected home; direct global bookings API returns 403.
2. Organiser opens their existing event: details and its booking summary load.
3. Coordinator opens venues without catalogue-edit controls; Venue Staff/hybrid can see controls.
4. Venue Staff opens `/app/events/new`: redirected home.
5. Attendee sees confirmed registration-enabled events without planning discussion/history.

## Integration notes and limits

- Coordinator request creation is existing behaviour, preserved pending team/customer confirmation.
- SCUM-16's dedicated clarification endpoint is not present in this checkout. Its implementation must use Coordinator role plus assigned-event checks, following `changeStatus`; this document does not claim that workflow is implemented.
- Venue deletion is not exposed by this checkout. Any future DELETE endpoint must use the same Venue Staff guard as create/update. Do not add a destructive endpoint solely to test permissions.
- These changes cover current Sprint 1 access-control integration, not completion of every feature in the Release 1 backlog. Team review/CI and Scrum evidence submission remain handoff steps.

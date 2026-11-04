# ConnectSphere Event Planning

The IS212 Event Planning and Venue Booking System.

| Layer | Choice |
| --- | --- |
| Frontend | React 18, Vite, React Router |
| Backend | Node.js, Express |
| Database | Supabase Postgres via `@supabase/supabase-js` (service role) |
| CI | GitHub Actions (lint, backend tests, frontend tests, frontend build) |

The app covers event requests, Lead assignment, venue booking, equipment, safety checks, and attendee registration.

Run everything from the repo root. npm workspaces are `frontend/` and `backend/`.

## Quick start

Prerequisites: Node 20+ and a Supabase project.

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/schema.sql`.
3. Copy `backend/.env.example` to `backend/.env`.
4. Paste **Project URL** into `SUPABASE_URL` and the **service role** key into `SUPABASE_SERVICE_ROLE_KEY` (Settings → API). Never put the service role key in the React app. The other values in that file have defaults, so a local run only needs these two.

```bash
npm install
npm run seed
npm run dev
```

The web app calls `/api` on the same origin. Vite proxies that to port 3001, so there is no frontend `.env`.

- Web: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:3001/api/health](http://localhost:3001/api/health)

All demo passwords: `Password123!`. The login screen has one-click buttons for the main demo accounts.

| Email | Roles |
| --- | --- |
| organiser@acme.example | Event Organiser (Acme) |
| organiser@apex.example | Event Organiser (Apex) — cannot see Acme events |
| coordinator@connectsphere.sg | Event Coordinator |
| coordinator2@connectsphere.sg | Event Coordinator |
| lead@connectsphere.sg | Event Coordinator Lead |
| leadcoord@connectsphere.sg | Event Coordinator **and** Lead |
| safety@connectsphere.sg | Safety Officer |
| venue@connectsphere.sg | Venue Staff |
| tech@connectsphere.sg | Technical Support |
| hybrid@connectsphere.sg | Coordinator **and** Venue Staff |
| attendee@example.com | Attendee |

Login reads `public.users`, checks the password with bcrypt, and sets an httpOnly JWT cookie. Roles stay in `user_roles`. This is **not** Supabase Auth (`auth.users`). Accounts are not self-serve signup. The seed users stand in for a future identity integration.

If login fails locally: the schema was not applied, `.env` is missing the service role key, or seed was not run.

## What you can click through

1. Organiser saves a draft and submits it.
2. The request is placed in the unassigned queue with status **Submitted** (no Coordinator is assigned automatically). The Event Coordinator Lead (`lead@connectsphere.sg`) can open **Unassigned queue** to see event name, organiser, date/time, attendance, and venue/equipment needs, then open the full request and assign a Coordinator. Once assigned, the event page and dashboard show the Coordinator's name to the Organiser (**Unassigned** until then), and the Coordinator gets an in-app notice every time the Lead assigns them, and again when the Lead reassigns the event to them. When the Coordinator changes, the Organiser sees the new name and the previous Coordinator is told they are no longer assigned. The Lead can open **Assignments** to see the Coordinators they assigned and the events those Coordinators hold. An event whose latest assignment was by another Lead is not on that page. Unassigned events stay on **Unassigned queue**.
3. Coordinator approves (**Approved**), starts planning (**Planning**) and requests a venue, or rejects with a required reason (rejection is not final — resubmit is allowed).
4. Venue staff approve/reject the booking, optionally giving a reason and a suggested alternative. The event's assigned Coordinator gets an in-app notice naming the event and venue (with the reason and alternative on a rejection). Submitting the request tells every active Venue Staff member (not the sender). If a later critical change flags an approved booking, or the event is cancelled while one is still approved, Venue Staff are told again; the booking itself is not cancelled. Confirmed bookings block overlapping windows, including setup/teardown. If Venue Staff later change a venue's setup or turnaround time, any confirmed booking or active hold that now overlaps another is flagged **Requires review** (under **Venues → Flagged**, heading **Flagged for review**, and on the event page for its Coordinator); nothing is cancelled or changed.
5. Venue staff set each venue's setup and turnaround times in minutes ("Teardown" on the Update venue form). Negative or non-numeric values are rejected and the saved values stay.
6. After Planning, the Coordinator sends the event to **Awaiting Safety Check** (all venue bookings approved and requested equipment reserved). Active Safety Officers are notified that the event is ready. The Safety Officer (`safety@connectsphere.sg`) opens **Safety queue**, reviews attendance / venues / equipment, and records approve (→ **Preparation**), reject, or request changes (both return to **Planning**). The Organiser and assigned Coordinator are notified of the outcome (reject/request-changes include the reason; request-changes also lists the arrangements) and see it on the event page.
7. Coordinator can confirm from **Preparation** once arrangements are ready. A Coordinator can open an event only when they are assigned to it. Opening another Coordinator's event, or an unassigned one, is access denied. A Lead, Safety Officer, Venue Staff member, Technical Support member, and the Organiser can still open it and see its attendance, date/time, venue (needs and booking) and equipment (notes and requests) throughout Planning and Confirmed.
8. The assigned Coordinator can **Edit event details** on any status before **Confirmed** (ordinary fields save directly). Confirmed and closed events reject direct edits — critical Confirmed changes go through an organiser change request (step 11). Unassigned Coordinators and post-submit Organisers cannot direct-edit (Organisers may still amend while clarification is ACTION_REQUIRED).
9. Coordinators, venue staff and technical support can check a venue's availability for any date/time range under **Venue availability** (confirmed bookings incl. setup/turnaround, active tentative holds and maintenance blocks are shown as unavailable). Coordinators and venue staff also get an **Existing bookings** list for the same period, showing each confirmed booking's occupied window and each active tentative hold.
10. Attendees can register or withdraw once the event is Confirmed and registration is open.
11. After a Coordinator is assigned, the Organiser can request a change to date/time, attendance, venue requirements or equipment requirements. The assigned Coordinator approves (those fields are applied; invalid values refuse the approve) or rejects. Approving a change to date, time, or expected attendance on a Confirmed event returns it to Planning. A venue-only or equipment-only change leaves the status at Confirmed. The Organiser is notified either way. A critical change (date, time, attendance, venue, equipment) flags affected venue bookings and equipment requests as **Requires review** — booking status is not changed and nothing is cancelled. Draft / cancelled / rejected / completed events cannot use this path.
12. Technical Support (`tech@connectsphere.sg`) can open **Equipment**, see whether each pending request is Sufficient / Insufficient / Unavailable for the event date/time, then reserve (blocked if leftover stock is short) or mark unavailable.
13. In-app notifications and status history are written along the way.

## Demo path (5 minutes)

1. Sign in as **Aisha** (`organiser@acme.example`).
2. Create an event and submit it. It stays **Submitted** with no Coordinator.
3. Sign in as **Ivy** (`lead@connectsphere.sg`). Open **Unassigned queue**, read the basic fields, then open the request and assign a Coordinator.
4. Sign in as **Chloe**. Approve, start planning, and send a venue booking.
5. Sign in as **Elena**. Approve the venue.
6. Back to Chloe. Send to safety check. Preparation and confirmation wait for the Safety Officer.
7. Sign in as **Hari**. Register.

Acme and Apex organisers are seeded so you can show that client data is isolated.

## Project layout

```
frontend/src/
  api.js                 fetch wrapper (cookies, credentials: include)
  auth.jsx               session context
  pages/                 screens (dashboard, events, venues, …)
  components/            layout, status badge, route guard

backend/src/
  app.js                 Express app (also used by tests)
  server.js              process start, hold expiry, hold notices
  config/db.js           Supabase client
  routes/                HTTP paths
  controllers/           thin request/response
  services/              business rules
  domain/statusMachine.js  allowed event status transitions
  middleware/auth.js     JWT cookie + role checks
  constants/             roles and statuses
  jobs/holdExpiry.job.js expires tentative venue holds

supabase/schema.sql
backend/scripts/seed.js
cypress/                 end-to-end tests
.github/workflows/ci.yml
```

Backend pattern: `routes → controllers → services → Supabase`.

Put new features in **services**, then expose them through a controller and route. Keep React screens dumb: they call `/api/...` and render. Do not put business rules in React. The status machine lives in `backend/src/domain/statusMachine.js`.

## Common commands

```bash
npm run dev                 # API + web together
npm run seed                # demo users/venues into Supabase
npm test                    # backend and frontend unit tests
npm run lint
npm run build               # frontend only
npm run test:e2e            # Cypress; start the web app and API first
```

## Domain rules

These come from the briefing and the G3/G4/G5 Q&A. If a later story disagrees, change the service. Do not fork a second copy of the rule in the UI.

| Rule | Where |
| --- | --- |
| Statuses (SCRUM-5): Draft → Submitted → Under Review → Approved → Planning → Awaiting Safety Check → Preparation → Confirmed → Completed, plus Cancelled / Rejected. Anything else is 409 | `constants/statuses.js`, `statusMachine.js` |
| Rejecting (from Submitted / Under Review) needs a reason of 10–1000 characters | `changeStatus`, `events.validators.js` |
| Awaiting Safety Check needs every active venue booking approved and all equipment requests reserved | `isReadyForSafetyCheck` |
| Safety review (SCRUM-55 / SCRUM-56, W7 #6): Safety Officer sees only **Awaiting Safety Check** events whose active venue bookings are approved and requested equipment is reserved; opens attendance, venue capacity/layouts, accessibility and equipment; records approve / reject / request-changes (reject and request-changes need a reason; request-changes needs at least one selected arrangement). Approve → **Preparation**; reject or request-changes → **Planning**. Outcome is visible to the event's Organiser and assigned Coordinator only. Non-SO cannot open or record (403). | `safety_checks`; `GET /api/events/safety-queue`; `GET/POST /api/events/:id/safety-check` → SafetyQueue / SafetyCheck |
| Safety review return (SCRUM-58, W7 #6): request-changes still sets **Planning** and marks only the selected venue bookings and equipment requests (`needs_review`). Unselected rows are untouched. Nothing is cancelled or edited. The Safety Officer queue lists an event only when it is **Awaiting Safety Check**, arrangements are ready, and no booking or equipment request still needs review. Venue Staff can approve an already-approved marked booking again (status stays Approved, the mark clears). Technical Support can reserve an already-reserved marked request again (status stays Reserved, no second stock hold). | `recordSafetyCheck`, `listSafetyQueue`, `decideBooking`, `decideRequest` |
| Safety-check notices (SCRUM-81): when the Coordinator successfully sends an event to **Awaiting Safety Check**, every active Safety Officer gets an in-app notice; no readiness notice if arrangements are incomplete. Approve / reject / request-changes notify only that event's Coordinator and Organiser (reject includes the reason; request-changes includes reason and selected arrangements). Sending again after request-changes notifies SOs again. | `notifySafetyOfficersEventReady` / `notifySafetyCheckContacts` → `notifyUser` (`SAFETY_CHECK_READY` / `SAFETY_CHECK_OUTCOME`) |
| Event confirmation notice (SCRUM-70): when an event becomes **Confirmed**, that event's Organiser gets one in-app `EVENT_CONFIRMED` notice naming the event; not created for other status changes, re-views, or re-saves; Coordinator is not a recipient of this notice (generic status notices may still apply). | `notifyOrganiserEventConfirmed` from `changeStatus` / `confirmEvent` → `notifyUser` (`EVENT_CONFIRMED`) |
| Status changes show on the dashboard and event page within 10 s, no reload | `LIVE_REFRESH_MS` polling |
| Moving to Awaiting Safety Check is a coordinator action, not automatic | "Send to safety check" button |
| Clarification is **not** its own status (sub-state of under review) | we stay on `UNDER_REVIEW` |
| Rejected requests can be resubmitted | `REJECTED → SUBMITTED` |
| Approving a date, time, or expected-attendance change on a Confirmed event returns it to Planning. A venue-only or equipment-only change does not. | `decideChangeRequest`, `CONFIRMED → PLANNING` |
| Organiser cannot edit after submit (SCRUM-38 / SCRUM-40 3A); Draft and clarification ACTION_REQUIRED amend only; otherwise changes go through the assigned coordinator or a change request | `events.service` `updateEvent` |
| Assigned Coordinator edits event details before Confirmed (SCRUM-40 1C); Confirmed and terminal statuses reject every direct patch (SCRUM-40 2A); critical Confirmed changes use change requests (SCRUM-40 4A / SCRUM-69) | `updateEvent`; EventDetail / NewEvent edit gates |
| Change requests (SCRUM-34 / SCRUM-35 / SCRUM-69): owning Organiser proposes date/time, attendance, venue requirements and/or equipment requirements after a Coordinator is assigned (not Draft/Cancelled/Rejected/Completed; one PENDING per event). Assigned Coordinator approves (every included field is copied onto the event) or rejects (event unchanged, optional reason). Approve is refused when requested values are invalid (attendance ≤ 0, start in the past, end not after start); the request stays PENDING. The Organiser is notified in-app on approve and on reject. Other coordinators 403. | `event_change_requests`; `POST/GET /api/events/:id/change-requests`; `POST /api/events/:id/change-requests/:requestId/decision` → EventDetail |
| Critical changes (SCRUM-41 / SCRUM-42): a real write of date, time, attendance, venue or equipment (including an approved change request) flags affected active venue bookings and equipment requests with `needs_review`. Booking status is unchanged; nothing is auto-cancelled. One booking's window does not automatically flag another. EventDetail shows **Requires review** next to the existing status. | `criticalChange.service`; `venue_bookings.needs_review`; `equipment_requests.needs_review` |
| Submitted requests go to an **unassigned queue** (no auto-assign); the Lead assigns a Coordinator later (SCRUM-28 / W7 #5) | `submitEvent` → `SUBMITTED`, `coordinator_id` null |
| A submitted request stays visible and is flagged **Unassigned** until a Coordinator is assigned (SCRUM-30 / W7 #5). The submitting organiser sees it on Events and the dashboard. The Lead sees it on the dashboard and in the unassigned queue, including a Lead who is also a Coordinator. Assigning a Coordinator removes the flag. The event stays visible. A draft is not flagged. Organisers still see their whole organisation, not only their own rows. | Events list; dashboard Coordinator column; `coordinator_id` null while `SUBMITTED` |
| Lead views every Submitted unassigned request (name, organiser, date/time, attendance, venue/equipment) and can open full details (SCRUM-65 / W7 #5) | `GET /api/events/unassigned-queue` → `UnassignedQueue` |
| Lead assigns a Coordinator (SCRUM-71): only a Lead can assign an **active** Coordinator to a **Submitted** event that has none; after that the event has exactly one primary Coordinator and is no longer unassigned; an event that already has a Coordinator cannot be assigned this way (reassignment is SCRUM-31) | `POST /api/events/:id/assign-coordinator` → `assignPrimaryCoordinator`; `GET /api/events/assignable-coordinators` |
| Organiser / Coordinator notices (SCRUM-45 / W7 #5; SCRUM-29 refers here for assignment): Lead assign notifies that event's Organiser and the new Coordinator. Lead reassign notifies the Organiser, the previous Coordinator, and the new Coordinator. A Coordinator request or accept is rejected (SCRUM-33) and sends no notice. Approve/reject, clarification, and important edits keep their existing notices. Submit does not notify (Lead uses the unassigned queue). Notice status is new (`read_at` null) or viewed (`markRead`). | `assignPrimaryCoordinator` / `reassignEventCoordinator` → `notifyUser`; `notifications.service` |
| Assigned Coordinator view and notice (SCRUM-29): the event page People card shows the Coordinator's name to the Organiser and planning roles ("Unassigned" until the Lead assigns); after a reassignment the next load shows the new Coordinator. A Coordinator is told on every Lead assign and every Lead reassign, with no de-duplication, and the previous Coordinator is told they are no longer assigned. In-app only. | `mapEvent` (`coordinatorName`), `EventDetail` People card, `notifyCoordinatorReassigned` |
| A Coordinator sees only events assigned to them (SCRUM-84). Another Coordinator's event, or an unassigned one, is access denied. A Lead, Safety Officer, Venue Staff member, or Technical Support member still sees every event. SCRUM-54 AC6 (view but not edit) is superseded. | `canViewEvent`, `applyVisibility`, Events list, dashboard |
| A Coordinator's home Upcoming list stops at 8 assigned events. **View all** opens Events, which lists only events assigned to them. A Lead who is also a Coordinator still sees the full list, and **Assigned to me** narrows it. | Dashboard **View all** → `/app/events?assigned=me` |
| Lead and Safety Officer are first-class roles (SCRUM-54): login returns every held role; only a Lead can open the unassigned queue or assignment overview; only a Safety Officer can open or record a safety check; a Coordinator who is not assigned cannot edit/approve/reject/confirm (403 with no extra event body). Viewing those events is SCRUM-84, not this row. | `roles.js`, `access.service`, `requireRole`, Event Coordinator assignment checks |
| Lead assignment overview (SCRUM-57 / W7 #5, Week 9 Jin Hong): lists the Coordinators this Lead assigned and the events they hold. An event whose latest assignment or reassignment was by another Lead is left out. Unassigned events stay on the SCRUM-65 queue. Completed, Cancelled, Rejected, and Draft are left out. Opening it again after this Lead assigns or reassigns shows the Coordinator now on the event. | `GET /api/assignments/overview` → `listAssignmentOverview`; Assignments page |
| Lead reassigns an event that already has a Coordinator (SCRUM-31): any status; the new Coordinator must be active; the previous Coordinator is no longer assigned and can no longer edit; choosing the Coordinator already assigned is refused and the event is unchanged. An event with no Coordinator stays on the assign action. | `POST /api/events/:id/reassign-coordinator` → `reassignEventCoordinator` |
| Reassignment audit (SCRUM-32): each confirmed reassignment writes one `audit_logs` row with action `COORDINATOR_REASSIGNED`. Who is the Lead (the reassign action, or a Lead accepting a pending request). When is `created_at`. The old and new Coordinator ids are in metadata. A pending request does not write a row. A refused attempt does not either, including a Coordinator request or accept (SCRUM-33). | `reassignEventCoordinator` and `acceptCoordinatorChange` → `writeAudit` |
| Only a Lead can assign or reassign (SCRUM-33 / W7 #5): the assigned Coordinator, another Coordinator, an Organiser, and any other role are rejected. The event is unchanged and no audit entry is written. The old request and accept routes require the Lead role as well. | `assignPrimaryCoordinator`, `reassignEventCoordinator`, `requestCoordinatorChange`, `acceptCoordinatorChange` |
| Approve / reject (SCRUM-17): only the **assigned** coordinator decides, nobody while unassigned; reject needs a reason of 10–1000 characters; organiser is notified with the reason; reason kept on the event, in status history and in the audit log | `POST /api/events/:id/decision` → `decideEvent` |
| Organisers only see their **organisation** | list visibility |
| Event details (SCRUM-39): the assigned Coordinator, Venue Staff, Technical Support and the owning Organiser see attendance, date/time, venue needs, the booked venue, equipment notes and equipment requests in any stage, including Planning and Confirmed; Attendees get the public view of confirmed events only. A Coordinator who is not assigned is access denied (SCRUM-84). | `GET /api/events/:id`, `/:id/venue-bookings`, `/:id/equipment-requests` → `EventDetail` |
| Multiple roles on one account | `user_roles` + demo users `hybrid@...` and `leadcoord@...` |
| Venue Staff add and update venues. Technical Support maintains equipment. | venue/equipment routes |
| Equipment availability (SCRUM-21): Technical Support checks a catalogue item (type), quantity and date/time; AVAILABLE stock minus overlapping RESERVED qty on other active events; cancelled/rejected events do not hold kit; result is Sufficient, Insufficient or Unavailable. Used on the Equipment request list before reserving. | `GET /api/equipment/availability`, `GET /api/equipment/requests/:id/availability` → `Equipment` |
| Equipment reservation (SCRUM-8): Technical Support reserves a pending request for its event; that writes `equipment_reservations` (available qty falls for overlapping events). Reserve is refused when operational inventory minus overlapping RESERVED qty is below the request, or when the request is already decided. Anyone who is not Tech is 403. Catalogue `quantity` is not decremented. Marking Unavailable is unchanged. | `POST /api/equipment/requests/:id/decision` → `decideRequest` → `Equipment` Reserve |
| Setup and turnaround (SCRUM-59): only Venue Staff set each venue's setup and turnaround minutes ("Teardown" on the form); whole numbers ≥ 0, anything negative, non-numeric or empty is rejected and nothing is saved; new venues start at 30/30. | Update venue form, `setupMinutes` / `teardownMinutes` in `venues.validators.js`, `PATCH /api/venues/:id` |
| Flag clashes from new setup/turnaround (SCRUM-77 / W7 #1): saving a venue's setup or turnaround time marks every confirmed booking and active hold at that venue that now overlaps another (both bookings, using the venue's new times; holds padded too) with `needs_review`. Touching windows, other venues, pending / cancelled / rejected / expired / past bookings are not flagged, flags are never cleared automatically, and nothing is cancelled or changed. Venue Staff see them under Venues → Flagged (heading **Flagged for review**) and in the save message; the event's Coordinator sees **Requires review** on the event page (SCRUM-42). | `flagBookingsClashingUnderVenueTimes` called from `updateVenue`; `listBookings` returns `needs_review`; Venues page |
| Confirmed bookings block overlapping windows, including setup/teardown | `findConflict` |
| Maintenance blocks live in `venue_unavailability` | seed has a Studio 3 outage |
| Tentative holds: a 60-second job expires due holds. A separate 30-second poll warns the assigned Coordinator before expiry and notifies them when a hold has expired. The 60-second job does not send those notices. | `jobs/holdExpiry.job.js`; `HOLD_NOTIFICATION_POLL_MS` in `server.js` |
| Venue availability view (SCRUM-66): confirmed bookings block start − setup to end + turnaround, active tentative holds block their held period (expired holds don't; no expiry = active), recorded unavailability blocks its times; coordinators, venue and tech staff only | `GET /api/venues/:id/availability` → `getVenueAvailability`, page `/app/venues/availability` |
| Existing venue bookings for a period (SCRUM-67): confirmed bookings with their occupied window (start − setup to end + turnaround), active tentative holds marked `TENTATIVE_HOLD` with their held period only, expired holds and pending requests left out, each booking only under its own venue; coordinators, venue staff and the coordinator lead only | `GET /api/venues/:id/bookings` → `listVenueBookingsForPeriod`, "Existing bookings" on `/app/venues/availability` |
| Confirm is only from **Preparation**. Every active venue booking must be approved, requested equipment must be reserved, and flagged arrangements must be cleared. | `isReadyToConfirm` |
| Registration after the event is Confirmed and registration is open. A full event is refused. Withdraw notifies a waitlisted attendee that a place opened and does not move them onto the event. | `registrations.service` |
| Audit log + in-app notifications | `audit.service` |
| Booking decision notice (SCRUM-78): when Venue Staff approve or reject, only the event's assigned Coordinator is notified; the notice names the event and venue, and a rejection includes the reason and suggested alternative if staff gave them (no reason line otherwise); nothing is sent while the request is pending | `decideBooking` → `buildBookingDecisionNotice` → `notifyUser`, reason/alternative boxes on the event page |
| Venue Staff and Attendee notices (SCRUM-46): a new booking request notifies every active Venue Staff member except the sender. An approved booking flagged by a critical change, or an event cancelled while one is still approved, notifies them again. An Attendee is told when their own registration is confirmed or withdrawn. Registered Attendees are told about a date, time or venue change and about cancellation. Notices start unread and are marked read on the Notifications page. | `notifyVenueStaff` / `notifyRegisteredAttendees` in `notifications.service` |

Notification channel is in-app. The same `notifyUser()` helper can later send email without changing every feature.

## Still not built

- Email / reminder scheduler. Notices stay in-app.
- Document uploads. The `event_documents` table exists and no screen uses it.
- Programme / multi-session editor. The `event_sessions` table exists and no screen uses it.
- Export or print of equipment lists.
- Assigning a Coordinator by experience. Submit leaves the request unassigned.
- Attendee self-registration of accounts.
- Automatic cancellation of a booking on every change. Staff review the flagged row, and the Coordinator updates it.

## How to add a feature

1. New table? Add it in `supabase/schema.sql` and re-run that section in the SQL editor.
2. New rule? Service function, and the status machine if it is a lifecycle change.
3. New endpoint? Route → controller → service. Return JSON `{ resource }`.
4. New screen? Page under `frontend/src/pages`, and a link in `Layout.jsx` if a role should see it.
5. Check the other roles. Organiser, coordinator, Lead, venue, tech, and attendee do not all see the same rows.

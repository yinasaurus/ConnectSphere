# What we built (for the team)

This is the starter repo for **ConnectSphere** — the IS212 Event Planning and Venue Booking System. It is scaffolding plus a working slice of the 14-step process, not the whole product.

The customer briefing says not to sprint the full system before Week 4 names the Release 1 core. This boilerplate exists so that when those stories land, we are not still deciding folders, auth, or table names.

## Tech stack

- **Frontend:** React 18, Vite, React Router
- **Backend:** Node.js, Express
- **Database:** Supabase Postgres via `@supabase/supabase-js` (service role)
- **CI:** GitHub Actions (lint + backend tests + frontend build)

Login (SCUM-12) reads the `public.users` table, verifies bcrypt hashes, and sets an httpOnly JWT cookie. We are **not** using Supabase Auth for this release, so roles stay in `user_roles`.

Run everything from the repo root with npm workspaces (`frontend/` and `backend/`).

## How to run it

1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor.
2. Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env`.

```bash
npm install
npm run seed
npm run dev            # API :3001 and web :5173
```

Open http://localhost:5173. Every demo user uses password `Password123!`. The login screen has one-click account buttons.

## Folder map

```
frontend/src/
  api.js                 fetch wrapper (cookies, credentials: include)
  auth.jsx               session context
  pages/                 screens (dashboard, events, venues, …)
  components/            layout, status badge, route guard

backend/src/
  app.js                 Express app (also used by tests)
  server.js              process start
  config/db.js           Supabase client
  routes/                HTTP paths
  controllers/           thin request/response
  services/              business rules
  domain/statusMachine.js  allowed event status transitions
  middleware/auth.js     JWT cookie + role checks
  constants/             roles and statuses

supabase/schema.sql
backend/scripts/seed.js
```

Put new features in **services**, then expose them through a controller/route. Keep React screens dumb: they call `/api/...` and render.

## Domain rules already encoded

These come from the briefing and the G3/G4/G5 Q&A. If a later story disagrees, change the service — do not fork a second copy of the rule in the UI.

| Rule | Where |
| --- | --- |
| Statuses (SCRUM-5): Draft → Submitted → Under Review → Approved → Planning → Awaiting Safety Check → Preparation → Confirmed → Completed, plus Cancelled / Rejected. Anything else is 400 | `constants/statuses.js`, `statusMachine.js` |
| Rejecting (from Submitted / Under Review) needs a reason | `changeStatus` |
| Awaiting Safety Check needs every active venue booking approved and all equipment requests reserved | `isReadyForSafetyCheck` |
| Safety review (SCRUM-55 / SCRUM-56, W7 #6): Safety Officer sees only **Awaiting Safety Check** events whose active venue bookings are approved and requested equipment is reserved; opens attendance, venue capacity/layouts, accessibility and equipment; records approve / reject / request-changes (reject and request-changes need a reason; request-changes needs at least one selected arrangement). Approve → **Preparation**; reject or request-changes → **Planning**. Outcome is visible to the event's Organiser and assigned Coordinator only. Non-SO cannot open or record (403). | `safety_checks`; `GET /api/events/safety-queue`; `GET/POST /api/events/:id/safety-check` → SafetyQueue / SafetyCheck |
| Safety-check notices (SCRUM-81): when the Coordinator successfully sends an event to **Awaiting Safety Check**, every active Safety Officer gets an in-app notice; no readiness notice if arrangements are incomplete. Approve / reject / request-changes notify only that event's Coordinator and Organiser (reject includes the reason; request-changes includes reason and selected arrangements). Sending again after request-changes notifies SOs again. | `notifySafetyOfficersEventReady` / `notifySafetyCheckContacts` → `notifyUser` (`SAFETY_CHECK_READY` / `SAFETY_CHECK_OUTCOME`) |
| Status changes show on the dashboard and event page within 10 s, no reload (team decision for "real time") | `LIVE_REFRESH_MS` polling |
| Moving to Awaiting Safety Check is a coordinator action, not automatic (team decision) | "Send to safety check" button |
| Clarification is **not** its own status (sub-state of under review) | we stay on `UNDER_REVIEW` |
| Rejected requests can be resubmitted | `REJECTED → SUBMITTED` |
| Confirmed can revert to Planning after a major change | `CONFIRMED → PLANNING` |
| Organiser cannot edit after submit; changes go through the coordinator | `events.service` update guard |
| Confirmed fields are locked (date/time/attendance/venue/equipment) | `SIGNIFICANT_FIELDS` |
| Change requests (SCRUM-34 / SCRUM-35 / SCRUM-69): owning Organiser proposes date/time, attendance, venue requirements and/or equipment requirements after a Coordinator is assigned (not Draft/Cancelled/Rejected/Completed; one PENDING per event). Assigned Coordinator approves (every included field is copied onto the event, including Confirmed; status is not moved) or rejects (event unchanged, optional reason). Approve is refused when requested values are invalid (attendance ≤ 0, start in the past, end not after start); the request stays PENDING. Approve audit stores who, when, and each field's previous and new value. Organiser is notified on approve and on reject. Other coordinators 403. | `event_change_requests`; `POST/GET /api/events/:id/change-requests`; `POST /api/events/:id/change-requests/:requestId/decision` → EventDetail |
| Critical changes (SCRUM-41 / SCRUM-42): a real write of date, time, attendance, venue or equipment (including an approved change request) flags affected active venue bookings and equipment requests with `needs_review`. Status is unchanged; nothing is auto-cancelled (W4). One booking's window does not automatically flag another (W7 #3). EventDetail shows **Requires review** next to the existing status. | `criticalChange.service`; `venue_bookings.needs_review`; `equipment_requests.needs_review` |
| Submitted requests go to an **unassigned queue** (no auto-assign); the Lead assigns a Coordinator later (SCRUM-28 / W7 #5) | `submitEvent` → `SUBMITTED`, `coordinator_id` null |
| Lead views every Submitted unassigned request (name, organiser, date/time, attendance, venue/equipment) and can open full details (SCRUM-65 / W7 #5) | `GET /api/events/unassigned-queue` → `UnassignedQueue` |
| Lead assigns a Coordinator (SCRUM-71): only a Lead can assign an **active** Coordinator to a **Submitted** event that has none; after that the event has exactly one primary Coordinator and is no longer unassigned; an event that already has a Coordinator cannot be assigned this way (reassignment is SCRUM-31) | `POST /api/events/:id/assign-coordinator` → `assignPrimaryCoordinator`; `GET /api/events/assignable-coordinators` |
| Coordinators can **view** other events but only **edit** assigned ones | list vs update |
| Lead and Safety Officer are first-class roles (SCRUM-54): login returns every held role; only a Lead can open the unassigned queue or assignment overview; only a Safety Officer can open or record a safety check; a Coordinator who is not assigned cannot edit/approve/reject/confirm (403 with no extra event body) | `roles.js`, `access.service`, `requireRole`, Event Coordinator assignment checks |
| Reassignment: current coordinator requests, new coordinator accepts | `/reassign` endpoints |
| Approve / reject (SCRUM-17): only the **assigned** coordinator decides, nobody while unassigned; reject needs a reason of 10–1000 characters; organiser is notified with the reason; reason kept on the event, in status history and in the audit log | `POST /api/events/:id/decision` → `decideEvent` |
| Organisers only see their **organisation** | list visibility |
| Event details (SCRUM-39): Coordinators, Venue Staff, Technical Support and the owning Organiser see attendance, date/time, venue needs, the booked venue, equipment notes and equipment requests in any stage, including Planning and Confirmed; Attendees get the public view of confirmed events only | `GET /api/events/:id`, `/:id/venue-bookings`, `/:id/equipment-requests` → `EventDetail` |
| Multiple roles on one account | `user_roles` + demo user `hybrid@...` |
| Venue staff CRUD venues; tech staff maintain equipment | venue/equipment routes |
| Equipment availability (SCRUM-21): Technical Support checks a catalogue item (type), quantity and date/time; AVAILABLE stock minus overlapping RESERVED qty on other active events; cancelled/rejected events do not hold kit; result is Sufficient, Insufficient or Unavailable. Used on the Equipment request list before reserving. | `GET /api/equipment/availability`, `GET /api/equipment/requests/:id/availability` → `Equipment` |
| Equipment reservation (SCRUM-8): Technical Support reserves a pending request for its event; that writes `equipment_reservations` (available qty falls for overlapping events). Reserve is refused when operational inventory minus overlapping RESERVED qty is below the request, or when the request is already decided. Anyone who is not Tech is 403. Catalogue `quantity` is not decremented. Marking Unavailable is unchanged. | `POST /api/equipment/requests/:id/decision` → `decideRequest` → `Equipment` Reserve |
| Setup and turnaround (SCRUM-59): only Venue Staff set each venue's setup and turnaround minutes ("Teardown" on the form); whole numbers ≥ 0, anything negative, non-numeric or empty is rejected and nothing is saved; new venues start at 30/30. Customer to confirm 0 and "optional" | Update venue form, `setupMinutes` / `teardownMinutes` in `venues.validators.js`, `PATCH /api/venues/:id` |
| Flag clashes from new setup/turnaround (SCRUM-77 / W7 #1): saving a venue's setup or turnaround time marks every confirmed booking and active hold at that venue that now overlaps another (both bookings, using the venue's new times; holds padded too) with `needs_review`. Touching windows, other venues, pending / cancelled / rejected / expired / past bookings are not flagged, flags are never cleared automatically, and nothing is cancelled or changed. Venue Staff see them under Venues → "Flagged for review" and in the save message; the event's Coordinator sees "Requires review" on the event page (SCRUM-42). Customer to confirm: only confirmed bookings and active holds count | `flagBookingsClashingUnderVenueTimes` called from `updateVenue`; `listBookings` returns `needs_review`; Venues page |
| Confirmed bookings block overlapping windows, including setup/teardown | `findConflict` |
| Maintenance blocks live in `venue_unavailability` | seed has a Studio 3 outage |
| Venue availability view (SCRUM-66): confirmed bookings block start − setup to end + turnaround, active tentative holds block their held period (expired holds don't; no expiry = active), recorded unavailability blocks its times; coordinators, venue and tech staff only | `GET /api/venues/:id/availability` → `getVenueAvailability`, page `/app/venues/availability` |
| Existing venue bookings for a period (SCRUM-67): confirmed bookings with their occupied window (start − setup to end + turnaround), active tentative holds marked `TENTATIVE_HOLD` with their held period only, expired holds and pending requests left out, each booking only under its own venue; coordinators, venue staff and the coordinator lead only | `GET /api/venues/:id/bookings` → `listVenueBookingsForPeriod`, "Existing bookings" on `/app/venues/availability` |
| Confirm requires an approved venue booking | `isReadyToConfirm` |
| Registration after confirmed; FCFS + waitlist notify on withdraw | `registrations.service` |
| Audit log + in-app notifications | `audit.service` |
| Booking decision notice (SCRUM-78): when Venue Staff approve or reject, only the event's assigned Coordinator is notified; the notice names the event and venue, and a rejection includes the reason and suggested alternative if staff gave them (no reason line otherwise); nothing is sent while the request is pending | `decideBooking` → `buildBookingDecisionNotice` → `notifyUser`, reason/alternative boxes on the event page |
| Accounts are **not** self-serve signup | login only; seed users stand in for the future identity integration |

Notification channel is in-app for now. The same `notifyUser()` helper can later send email without changing every feature.

## What is intentionally unfinished

Do not treat missing screens as forgotten requirements. They are waiting for Week 4 scope / sprint planning:

- Email / reminder scheduler
- Document uploads (table exists: `event_documents`)
- Programme / multi-session editor (table exists: `event_sessions`)
- Email of change-request decisions (in-app notify skipped for SCRUM-34/35)
- Export/print of equipment lists (explicitly not core)
- Complex coordinator routing by experience (not required)
- Attendee self-registration of accounts
- Hard automatic un-booking on every change (staff review, coordinator updates)

The extra tables are there so later stories are `INSERT`s, not emergency redesigns.

## Suggested first stories after Week 4

Once the customer names Release 1, likely extensions:

1. Coordinator “needs clarification” note without changing status
2. Equipment request from the event page (API already exists)
3. Tentative venue holds vs confirmed bookings
4. Registration open/close controls for the organiser
5. Richer calendar (per-venue toggle)

## How to add a feature without making a mess

1. New table? Add it in `supabase/schema.sql` and re-run that section in the SQL editor
2. New rule? Service function + status machine if it is a lifecycle change
3. New endpoint? Route → controller → service. Return JSON `{ resource }`
4. New screen? Page under `frontend/src/pages`, link it in `Layout.jsx` if a role should see it
5. Check the other roles. Organiser, coordinator, Lead, venue, tech, attendee all have different visibility

## Demo path (5 minutes)

1. Sign in as **Aisha** (`organiser@acme.example`)
2. Create an event and submit it — it stays **Submitted** with no Coordinator
3. Sign in as **Ivy** (`lead@connectsphere.sg`) — open **Unassigned queue**, read the basic fields, then open the request and assign a Coordinator
4. Sign in as **Chloe** — approve, start planning, send a venue booking
5. Sign in as **Elena** — approve the venue
6. Back to Chloe — send to safety check (preparation and confirmation wait for the Safety Officer, SCRUM-55/56)
7. Sign in as **Hari** — register

Acme vs Apex organisers are seeded so you can show that client data is isolated.

If login fails locally: schema not applied, `.env` missing the service role key, or seed not run.

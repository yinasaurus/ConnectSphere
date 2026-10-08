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
| Preparation only after the Safety Officer approves the safety check (W7 #6) | `changeStatus` refuses it until SCRUM-55/56 |
| Status changes show on the dashboard and event page within 10 s, no reload (team decision for "real time") | `LIVE_REFRESH_MS` polling |
| Moving to Awaiting Safety Check is a coordinator action, not automatic (team decision) | "Send to safety check" button |
| Clarification is **not** its own status (sub-state of under review) | we stay on `UNDER_REVIEW` |
| Rejected requests can be resubmitted | `REJECTED → SUBMITTED` |
| Confirmed can revert to Planning after a major change | `CONFIRMED → PLANNING` |
| Organiser cannot edit after submit; changes go through the coordinator | `events.service` update guard |
| Confirmed fields are locked (date/time/attendance/venue/equipment) | `SIGNIFICANT_FIELDS` |
| Coordinators are **auto-assigned**, one per event, fair load | least active events on submit |
| Coordinators can **view** other events but only **edit** assigned ones | list vs update |
| Reassignment: current coordinator requests, new coordinator accepts | `/reassign` endpoints |
| Approve / reject (SCRUM-17): only the **assigned** coordinator decides, nobody while unassigned; reject needs a reason of 10–1000 characters; organiser is notified with the reason; reason kept on the event, in status history and in the audit log | `POST /api/events/:id/decision` → `decideEvent` |
| Organisers only see their **organisation** | list visibility |
| Multiple roles on one account | `user_roles` + demo user `hybrid@...` |
| Venue staff CRUD venues; tech staff maintain equipment | venue/equipment routes |
| Confirmed bookings block overlapping windows, including setup/teardown | `findConflict` |
| Maintenance blocks live in `venue_unavailability` | seed has a Studio 3 outage |
| Confirm requires an approved venue booking | `hasApprovedVenueBooking` |
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
- Full change-request workflow UI
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
5. Change-request record instead of editing confirmed events
6. Richer calendar (per-venue toggle)

## How to add a feature without making a mess

1. New table? Add it in `supabase/schema.sql` and re-run that section in the SQL editor
2. New rule? Service function + status machine if it is a lifecycle change
3. New endpoint? Route → controller → service. Return JSON `{ resource }`
4. New screen? Page under `frontend/src/pages`, link it in `Layout.jsx` if a role should see it
5. Check the other roles. Organiser, coordinator, venue, tech, attendee all have different visibility

## Demo path (5 minutes)

1. Sign in as **Aisha** (`organiser@acme.example`)
2. Create an event, submit it — Chloe should be assigned
3. Sign in as **Chloe** — approve, start planning, send a venue booking
4. Sign in as **Elena** — approve the venue
5. Back to Chloe — send to safety check (preparation and confirmation wait for the Safety Officer, SCRUM-55/56)
6. Sign in as **Hari** — register

Acme vs Apex organisers are seeded so you can show that client data is isolated.

If login fails locally: schema not applied, `.env` missing the service role key, or seed not run.

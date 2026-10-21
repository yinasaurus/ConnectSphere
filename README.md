# ConnectSphere Event Planning

Boilerplate for the IS212 Event Planning and Venue Booking System.

| Layer | Choice |
| --- | --- |
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| Database | Supabase (Postgres) |
| CI | GitHub Actions |

This is a **foundation plus a thin vertical slice**, not the full product. Core Release 1 stories should still wait for the Week 4 customer scope.

## Quick start

Prerequisites: Node 20+ and a Supabase project.

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/schema.sql`.
3. Copy `backend/.env.example` to `backend/.env`.
4. Paste **Project URL** into `SUPABASE_URL` and the **service role** key into `SUPABASE_SERVICE_ROLE_KEY` (Settings → API). Never put the service role key in the React app.

```bash
npm install
npm run seed
npm run dev
```

- Web: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:3001/api/health](http://localhost:3001/api/health)

All demo passwords: `Password123!`

| Email | Roles |
| --- | --- |
| organiser@acme.example | Event Organiser (Acme) |
| organiser@apex.example | Event Organiser (Apex) — cannot see Acme events |
| coordinator@connectsphere.sg | Event Coordinator |
| coordinator2@connectsphere.sg | Event Coordinator (for load-balanced assignment) |
| lead@connectsphere.sg | Event Coordinator Lead |
| leadcoord@connectsphere.sg | Event Coordinator **and** Lead |
| safety@connectsphere.sg | Safety Officer |
| venue@connectsphere.sg | Venue Staff |
| tech@connectsphere.sg | Technical Support |
| hybrid@connectsphere.sg | Coordinator **and** Venue Staff |
| attendee@example.com | Attendee |

Login looks up the `users` table in Supabase and issues an httpOnly JWT cookie. This is **not** Supabase Auth (`auth.users`); accounts are app-managed so we can attach ConnectSphere roles.

## What you can already click through

1. Organiser saves a draft and submits it.
2. The request is placed in the unassigned queue with status **Submitted** (no Coordinator is assigned automatically). The Event Coordinator Lead (`lead@connectsphere.sg`) can open **Unassigned queue** to see event name, organiser, date/time, attendance, and venue/equipment needs, then open the full request and assign a Coordinator. Once assigned, the event page and dashboard show the Coordinator's name to the Organiser (**Unassigned** until then), and the Coordinator gets an in-app notice every time they are assigned or asked to take over. When the Coordinator changes, the Organiser sees the new name and the previous Coordinator is told they are no longer assigned.
3. Coordinator approves (**Approved**), starts planning (**Planning**) and requests a venue, or rejects with a required reason (rejection is not final — resubmit is allowed).
4. Venue staff approve/reject the booking, optionally giving a reason and a suggested alternative. The event's assigned Coordinator gets an in-app notice naming the event and venue (with the reason and alternative on a rejection). Confirmed bookings block overlapping windows, including setup/teardown.
5. Venue staff set each venue's setup and turnaround times in minutes ("Teardown" on the Update venue form). Negative or non-numeric values are rejected and the saved values stay.
6. After Planning, the Coordinator sends the event to **Awaiting Safety Check** (all venue bookings approved and requested equipment reserved). Active Safety Officers are notified that the event is ready. The Safety Officer (`safety@connectsphere.sg`) opens **Safety queue**, reviews attendance / venues / equipment, and records approve (→ **Preparation**), reject, or request changes (both return to **Planning**). The Organiser and assigned Coordinator are notified of the outcome (reject/request-changes include the reason; request-changes also lists the arrangements) and see it on the event page.
7. Coordinator can confirm from **Preparation** once arrangements are ready. Throughout Planning and Confirmed, internal staff and the Organiser can open the event to see its attendance, date/time, venue (needs and booking) and equipment (notes and requests).
8. Coordinators, venue staff and technical support can check a venue's availability for any date/time range under **Venue availability** (confirmed bookings incl. setup/turnaround, active tentative holds and maintenance blocks are shown as unavailable). Coordinators and venue staff also get an **Existing bookings** list for the same period, showing each confirmed booking's occupied window and each active tentative hold.
9. Attendees can register / withdraw once the event is confirmed.
10. After a Coordinator is assigned, the Organiser can request a change to date/time, attendance, venue requirements or equipment requirements. The assigned Coordinator approves (those fields are applied; Confirmed stays Confirmed; invalid values refuse the approve) or rejects. The Organiser is notified either way. A critical change (date, time, attendance, venue, equipment) flags affected venue bookings and equipment requests as **Requires review** — booking status is not changed and nothing is cancelled. Draft / cancelled / rejected / completed events cannot use this path.
11. Technical Support (`tech@connectsphere.sg`) can open **Equipment**, see whether each pending request is Sufficient / Insufficient / Unavailable for the event date/time, then reserve (blocked if leftover stock is short) or mark unavailable.
12. In-app notifications and status history are written along the way.

## Project layout

```
frontend/           React UI
backend/            Express API, tests, seed script
supabase/schema.sql Postgres tables for the SQL editor
.github/workflows/ci.yml
```

Backend pattern: `routes → controllers → services → Supabase`.

Do not put business rules in React. The status machine lives in `backend/src/domain/statusMachine.js`.

## Common commands

```bash
npm run dev                 # API + web together
npm run seed                # demo users/venues into Supabase
npm test
npm run lint
npm run build
```

## Team notes

See [WHAT_WE_BUILT.md](./WHAT_WE_BUILT.md) for why the boilerplate is shaped this way, which customer Q&A rules are already encoded, and where to extend it.

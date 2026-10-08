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
| venue@connectsphere.sg | Venue Staff |
| tech@connectsphere.sg | Technical Support |
| hybrid@connectsphere.sg | Coordinator **and** Venue Staff |
| attendee@example.com | Attendee |

Login looks up the `users` table in Supabase and issues an httpOnly JWT cookie. This is **not** Supabase Auth (`auth.users`); accounts are app-managed so we can attach ConnectSphere roles.

## What you can already click through

1. Organiser saves a draft and submits it.
2. The request is placed in the unassigned queue with status **Submitted** (no Coordinator is assigned automatically). The Event Coordinator Lead (`lead@connectsphere.sg`) can open **Unassigned queue** to see event name, organiser, date/time, attendance, and venue/equipment needs, then open the full request. Assigning a Coordinator is a later story.
3. Coordinator approves into **Planning**, requests a venue, or rejects with a reason (rejection is not final — resubmit is allowed).
4. Venue staff approve/reject the booking, optionally giving a reason and a suggested alternative. The event's assigned Coordinator gets an in-app notice naming the event and venue (with the reason and alternative on a rejection). Confirmed bookings block overlapping windows, including setup/teardown.
5. Coordinator can confirm only after an approved venue booking.
6. Attendees can register / withdraw once the event is confirmed.
7. In-app notifications and status history are written along the way.

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

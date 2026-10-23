#!/usr/bin/env python3
"""
Self-contained apply script. Run from the ConnectSphere repo root:
    python3 apply_scrum_test_cases_and_labels.py

What it does (no git commands - you commit/push yourself):
  1. Adds 2 new regression tests to backend/tests/events.validation.test.js
     (toSqlDateTime / SCUM-14-15 datetime-insert bug - currently untested).
  2. Adds 1 new route-level test to backend/tests/events.editLock.test.js
     (SCRUM-38's 409 EDIT_LOCKED through a real HTTP request - currently only
     tested at the service-function level).
  3. Creates frontend/src/pages/NewEvent.test.jsx (SCRUM-14 compulsory-field
     validation on submit - currently untested; draft-saving itself is already
     covered by Drafts.test.jsx, written by a teammate).
  4. Inserts a "// SCRUM-XX-TCnn" comment line above each of your existing test
     cases, across 8 files, as a label for your team's spreadsheet-merge script.

Safety:
  - Every insertion matches an exact, unique snippet of your current file first.
    If a snippet isn't found (or isn't unique), that one insertion is skipped
    and reported - nothing else in the file is touched.
  - Re-running this script is safe: anything already applied is detected and
    skipped (checked by a marker string / existing label comment).
  - Only the 8 files listed below are touched. Nothing is deleted.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# If this script was copied into the repo root itself, ROOT is the repo root.
# If it's still sitting in your scratch/Downloads folder, point BACKEND/FRONTEND
# at your actual ConnectSphere checkout below.
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
if not BACKEND.exists():
    print("ERROR: could not find a 'backend' folder next to this script.")
    print("Move this script into your ConnectSphere repo root and run it from there.")
    sys.exit(1)

report = []  # (file, label_or_desc, status)


def insert_before(path: Path, anchor: str, insertion: str, label: str):
    """Insert `insertion` immediately before the first (and only) occurrence of `anchor`."""
    text = path.read_text(encoding="utf-8")
    if insertion.strip() in text:
        report.append((str(path.relative_to(ROOT)), label, "already applied, skipped"))
        return
    count = text.count(anchor)
    if count != 1:
        report.append((str(path.relative_to(ROOT)), label, f"SKIPPED - anchor found {count} times (expected 1)"))
        return
    text = text.replace(anchor, insertion + anchor, 1)
    path.write_text(text, encoding="utf-8")
    report.append((str(path.relative_to(ROOT)), label, "inserted"))


def append_block(path: Path, marker: str, block: str, label: str):
    """Append `block` at end of file, unless `marker` already present."""
    text = path.read_text(encoding="utf-8")
    if marker in text:
        report.append((str(path.relative_to(ROOT)), label, "already applied, skipped"))
        return
    path.write_text(text.rstrip("\n") + "\n\n" + block.strip("\n") + "\n", encoding="utf-8")
    report.append((str(path.relative_to(ROOT)), label, "appended"))


# ============================================================
# 1. New tests: events.validation.test.js (toSqlDateTime regression)
# ============================================================
VALIDATION_FILE = BACKEND / "tests" / "events.validation.test.js"
VALIDATION_BLOCK = """
// Regression guard for the actual bug SCUM-14/15 fixed (PR #1): start_at/end_at were
// once passed to insertOne as raw strings, which caused MySQL/Supabase datetime insert
// errors. toSqlDateTime() converts them to real Date objects first - this was never
// directly asserted anywhere until now.
describe('SCUM-14/15 regression: dates are converted to real Date objects before insert', () => {
  const organiser = { id: 1, organisationId: 10, roles: [ROLES.EVENT_ORGANISER] };

  beforeEach(() => {
    jest.clearAllMocks();
    db.supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    });
    db.fetchMany.mockResolvedValue([]);
    db.fetchOne.mockImplementation(async () => ({ id: 99, organiser_id: 1, organisation_id: 10, status: 'DRAFT', name: 'Event' }));
    db.insertOne.mockImplementation(async () => ({ id: 99 }));
  });

  // SCRUM-14-TC12
  it('passes start_at/end_at to insertOne as real Date instances, not raw strings', async () => {
    await service.createEvent(organiser, {
      name: 'Date conversion check',
      startAt: '2026-10-05T10:00:00Z',
      endAt: '2026-10-06T10:00:00Z',
    });

    const [, patch] = db.insertOne.mock.calls[0];
    expect(patch.start_at).toBeInstanceOf(Date);
    expect(patch.end_at).toBeInstanceOf(Date);
  });

  // SCRUM-14-TC13
  it('passes null through for start_at/end_at when no date is given (SCUM-15 draft), not an invalid value', async () => {
    await service.createEvent(organiser, { name: 'No dates yet' });

    const [, patch] = db.insertOne.mock.calls[0];
    expect(patch.start_at).toBeNull();
    expect(patch.end_at).toBeNull();
  });
});
"""
if VALIDATION_FILE.exists():
    append_block(VALIDATION_FILE, "SCUM-14/15 regression: dates are converted", VALIDATION_BLOCK, "new toSqlDateTime tests")
else:
    report.append((str(VALIDATION_FILE), "new toSqlDateTime tests", "SKIPPED - file not found"))


# ============================================================
# 2. New test: events.editLock.test.js (route-level EDIT_LOCKED)
# ============================================================
EDITLOCK_FILE = BACKEND / "tests" / "events.editLock.test.js"
EDITLOCK_BLOCK = """
// SCRUM-38-TC08
// Regression guard: the tests above all call service.updateEvent() directly. This one
// confirms the 409/EDIT_LOCKED response actually survives the real route + auth
// middleware + error handler, not just the service function in isolation.
describe('SCRUM-38 EDIT_LOCKED through the real HTTP route', () => {
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  const { createApp } = require('../src/app');
  const { env } = require('../src/config/env');
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    db.supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    });
    db.fetchMany.mockResolvedValue([]);
  });

  it('PATCH /api/events/:id returns 409 EDIT_LOCKED when the owning organiser edits a submitted request directly', async () => {
    db.fetchOne.mockResolvedValueOnce({ id: 1, is_active: true }); // auth: signed-in user
    db.fetchMany.mockResolvedValueOnce([{ role: ROLES.EVENT_ORGANISER }]); // auth: their roles
    db.fetchOne.mockResolvedValueOnce({ // service: the event being patched
      id: 3, organiser_id: 1, organisation_id: 10, coordinator_id: 2, status: EVENT_STATUS.SUBMITTED, name: 'Workshop',
    });

    const token = jwt.sign({ sub: 1 }, env.jwtSecret);
    const res = await request(app)
      .patch('/api/events/3')
      .set('Cookie', `${env.sessionCookieName}=${token}`)
      .send({ name: 'Sneaky edit' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EDIT_LOCKED');
    expect(db.updateById).not.toHaveBeenCalled();
  });
});
"""
if EDITLOCK_FILE.exists():
    append_block(EDITLOCK_FILE, "EDIT_LOCKED through the real HTTP route", EDITLOCK_BLOCK, "new SCRUM-38 route test")
else:
    report.append((str(EDITLOCK_FILE), "new SCRUM-38 route test", "SKIPPED - file not found"))


# ============================================================
# 3. New file: frontend/src/pages/NewEvent.test.jsx
# ============================================================
NEWEVENT_TEST_FILE = FRONTEND / "src" / "pages" / "NewEvent.test.jsx"
NEWEVENT_TEST_CONTENT = """import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth';
import { api } from '../api';
import NewEvent from './NewEvent';

jest.mock('../api', () => ({
  api: jest.fn(),
}));

const mockUser = {
  id: 1,
  fullName: 'Aisha Rahman',
  email: 'organiser@acme.example',
  roles: ['EVENT_ORGANISER'],
  organisationId: 10,
};

function setupAuth() {
  return Promise.resolve({ user: mockUser });
}

function renderNewEvent() {
  return render(
    <MemoryRouter initialEntries={['/app/events/new']}>
      <AuthProvider>
        <Routes>
          <Route path="/app/events/new" element={<NewEvent />} />
          <Route path="/app/events/:id" element={<div>Event Detail Page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

/**
 * SCRUM-14: compulsory fields are enforced client-side before a request can be submitted
 * for review. Draft-saving itself (which deliberately skips this check, SCRUM-15) is
 * already covered by Drafts.test.jsx - this file covers the submit-validation path only,
 * which had no test coverage at all before this.
 */
describe('SCRUM-14 NewEvent compulsory-field validation on submit', () => {
  beforeEach(() => {
    api.mockReset();
    api.mockImplementation((path, options = {}) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/events' && !options.method) return Promise.resolve({ events: [] });
      return Promise.reject(new Error(`Unhandled api call: ${path} ${options.method || 'GET'}`));
    });
  });

  // SCRUM-14-TC14
  it('blocks submission and shows every missing required field, without calling the API', async () => {
    const user = userEvent.setup();
    renderNewEvent();
    expect(await screen.findByRole('heading', { name: /new event request/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /submit for review/i }));

    expect(screen.getByText('Event name is required.')).toBeInTheDocument();
    expect(screen.getByText('Purpose is required.')).toBeInTheDocument();
    expect(screen.getByText('Description is required.')).toBeInTheDocument();
    expect(screen.getByText('Start date/time is required.')).toBeInTheDocument();
    expect(screen.getByText('End date/time is required.')).toBeInTheDocument();
    expect(screen.getByText('Venue requirements is required.')).toBeInTheDocument();
    expect(screen.getByText(/Accessibility requirements is required/)).toBeInTheDocument();

    expect(api).not.toHaveBeenCalledWith('/api/events', expect.objectContaining({ method: 'POST' }));
  });

  // SCRUM-14-TC15
  it("fixing one field clears only that field's error, leaving the others", async () => {
    const user = userEvent.setup();
    renderNewEvent();
    await user.click(await screen.findByRole('button', { name: /submit for review/i }));
    expect(screen.getByText('Event name is required.')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/event name \\*/i), 'Town Hall');

    expect(screen.queryByText('Event name is required.')).not.toBeInTheDocument();
    expect(screen.getByText('Purpose is required.')).toBeInTheDocument();
  });

  // SCRUM-14-TC16
  it('submitting with every compulsory field filled in saves, submits, and navigates to the event', async () => {
    const user = userEvent.setup();
    let postPayload = null;
    let submitCalled = false;
    api.mockImplementation((path, options = {}) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/events' && !options.method) return Promise.resolve({ events: [] });
      if (path === '/api/events' && options.method === 'POST') {
        postPayload = options.body;
        return Promise.resolve({ event: { id: 77, name: options.body.name, organiserId: 1, status: 'DRAFT' } });
      }
      if (path === '/api/events/77/submit' && options.method === 'POST') {
        submitCalled = true;
        return Promise.resolve({ event: { id: 77, status: 'SUBMITTED' } });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path} ${options.method || 'GET'}`));
    });

    renderNewEvent();
    await user.type(await screen.findByLabelText(/event name \\*/i), 'Town Hall');
    await user.type(screen.getByLabelText(/purpose \\*/i), 'Quarterly update');
    await user.type(screen.getByLabelText(/description \\*/i), 'All-hands meeting for the team.');
    fireEvent.change(screen.getByLabelText(/start \\*/i), { target: { value: '2026-12-01T09:00' } });
    fireEvent.change(screen.getByLabelText(/end \\*/i), { target: { value: '2026-12-01T11:00' } });
    await user.type(screen.getByLabelText(/venue requirements \\*/i), 'Projector and stage');
    await user.type(screen.getByLabelText(/accessibility needs \\*/i), 'None');

    await user.click(screen.getByRole('button', { name: /submit for review/i }));

    await waitFor(() => expect(postPayload).toBeTruthy());
    expect(postPayload.name).toBe('Town Hall');
    expect(postPayload.startAt).toBe(new Date('2026-12-01T09:00').toISOString());
    await waitFor(() => expect(submitCalled).toBe(true));
    expect(await screen.findByText('Event Detail Page')).toBeInTheDocument();
  });
});
"""
if NEWEVENT_TEST_FILE.exists():
    report.append((str(NEWEVENT_TEST_FILE.relative_to(ROOT)), "new NewEvent.test.jsx", "SKIPPED - file already exists, not overwritten"))
else:
    NEWEVENT_TEST_FILE.write_text(NEWEVENT_TEST_CONTENT, encoding="utf-8")
    report.append((str(NEWEVENT_TEST_FILE.relative_to(ROOT)), "new NewEvent.test.jsx", "created"))


# ============================================================
# 4. Labels: "// SCRUM-XX-TCnn" above each existing test case
# ============================================================

# (file path relative to ROOT, [(anchor_text, label_comment), ...])
LABEL_TARGETS = [
    (BACKEND / "tests" / "events.validation.test.js", [
        ("  it('passes when every compulsory field is filled in', () => {", "  // SCRUM-14-TC01\n"),
        ("  it('flags missing compulsory fields by name', () => {", "  // SCRUM-14-TC02\n"),
        ("  it('treats zero or missing attendance as incomplete', () => {", "  // SCRUM-14-TC03\n"),
        ("  it('does not enforce these fields when only a draft is being saved (SCUM-15)', () => {", "  // SCRUM-15-TC01\n"),
        ("    it('rejects an end date before the start date (e.g. start 6 Oct, end 5 Oct)', async () => {", "    // SCRUM-14-TC04 (originally PR #12, no Jira number on the PR itself - folded under SCRUM-14)\n"),
        ("    it('rejects a start date equal to the end date (zero duration)', async () => {", "    // SCRUM-14-TC05\n"),
        ("    it('allows a start date before the end date', async () => {", "    // SCRUM-14-TC06\n"),
        ("    it('allows creating a draft with no dates yet (SCUM-15: only name is required)', async () => {", "    // SCRUM-15-TC02\n"),
        ("    it('allows creating a draft with only one of the two dates set', async () => {", "    // SCRUM-15-TC03\n"),
        ("    it('rejects moving the start date past the existing end date', async () => {", "    // SCRUM-14-TC07\n"),
        ("    it('rejects moving the end date before the existing start date', async () => {", "    // SCRUM-14-TC08\n"),
        ("    it('rejects an invalid combination when both dates change in one patch', async () => {", "    // SCRUM-14-TC09\n"),
        ("    it('allows a valid date change', async () => {", "    // SCRUM-14-TC10\n"),
        ("    it('leaves unrelated edits unaffected when dates are untouched', async () => {", "    // SCRUM-14-TC11\n"),
    ]),
    (BACKEND / "tests" / "events.editLock.test.js", [
        ("  it('allows the organiser to edit their own request while it is still Draft', async () => {", "  // SCRUM-38-TC01\n"),
        ("  it.each(\n    Object.values(EVENT_STATUS).filter((status) => status !== EVENT_STATUS.DRAFT)\n  )", "  // SCRUM-38-TC02 (parametrized - one test per non-Draft status, currently 10 statuses)\n"),
        ("  it('blocks even a single-field direct edit once submitted', async () => {", "  // SCRUM-38-TC03\n"),
        ("  it('lets the assigned coordinator edit the event after submission', async () => {", "  // SCRUM-38-TC04\n"),
        ("  it('lets a hybrid organiser/coordinator user who is the assigned coordinator for their own request edit it after submission', async () => {", "  // SCRUM-38-TC05\n"),
        ("  it('rejects an unrelated role (Venue Staff) from editing a submitted request', async () => {", "  // SCRUM-38-TC06\n"),
        ("  it('rejects an organiser from a different organisation, distinct from the EDIT_LOCKED case', async () => {", "  // SCRUM-38-TC07\n"),
    ]),
    (BACKEND / "tests" / "events.permissions.test.js", [
        ("    it('AC1: lets the assigned coordinator open a submitted request, moving it to Under Review', async () => {", "    // SCRUM-64-TC01\n"),
        ("    it('AC2: rejects opening a request still in the unassigned queue (no coordinator assigned)', async () => {", "    // SCRUM-64-TC02\n"),
        ("    it('AC3: rejects opening a request assigned to a different coordinator', async () => {", "    // SCRUM-64-TC03\n"),
        ("    it('AC4: a Draft request cannot be opened for review (never reachable from the reviewable queue)', async () => {", "    // SCRUM-64-TC04\n"),
        ("    it('AC4: a Draft request is excluded when listing by Submitted status', async () => {", "    // SCRUM-64-TC05\n"),
        ("    it('AC5: opening an already Under Review request is idempotent (no error, no re-trigger)', async () => {", "    // SCRUM-64-TC06\n"),
        ("    it('AC6: rejects an organiser attempting to open a request for review', async () => {", "    // SCRUM-64-TC07\n"),
        ("    it('rejects opening a request that does not exist', async () => {", "    // SCRUM-64-TC08\n"),
    ]),
    (BACKEND / "tests" / "rbac.routes.test.js", [
        ("    ['post', '/api/events/3/review', events.openForReview, [ROLES.EVENT_COORDINATOR], 200],",
         "    // SCRUM-64-TC09 (data row - drives the shared it.each role-matrix loop below, not a standalone test)\n"),
    ]),
    (FRONTEND / "src" / "pages" / "EventDetail.test.jsx", [
        ("it('US64-F01: the assigned coordinator opens a submitted request for review', async () => {", "// SCRUM-64-TC10\n"),
        ("it('US64-F02: an unrelated coordinator does not see the Open for review button', async () => {", "// SCRUM-64-TC11\n"),
        ("it('US64-F03: the organiser does not see the Open for review button', async () => {", "// SCRUM-64-TC12\n"),
    ]),
    (BACKEND / "tests" / "registrations.withdraw.test.js", [
        ("  it('US53-B01: an Attendee can withdraw their own registration', async () => {", "  // SCRUM-53-TC01\n"),
        ("  it('US53-B02: withdrawing only ever targets the caller\\'s own active registration for this event', async () => {", "  // SCRUM-53-TC02\n"),
        ("  it('US53-B03: withdrawing with no active registration is 404', async () => {", "  // SCRUM-53-TC03\n"),
        ("  it('US53-B04: withdrawing a REGISTERED place notifies the oldest waitlisted attendee', async () => {", "  // SCRUM-53-TC04\n"),
        ("  it('US53-B05: withdrawing a WAITLISTED place does not open a place for anyone else', async () => {", "  // SCRUM-53-TC05\n"),
        ("  it('US53-R01: an Attendee can withdraw through the API', async () => {", "  // SCRUM-53-TC06\n"),
        ("  it('US53-R02: the route needs a signed-in user', async () => {", "  // SCRUM-53-TC07\n"),
    ]),
    (BACKEND / "tests" / "registrations.list.test.js", [
        ("  it('US74-B01: the Organiser sees every registration plus the active count against capacity', async () => {", "  // SCRUM-74-TC01\n"),
        ("  it('US74-B02: the assigned Coordinator sees the same registrations as the Organiser', async () => {", "  // SCRUM-74-TC02\n"),
        ("  it('US74-B03: an event with no registrations shows a count of zero', async () => {", "  // SCRUM-74-TC03\n"),
        ("  it('US74-B03b: capacity is null, not zero, when registration was never enabled', async () => {", "  // SCRUM-74-TC04\n"),
        ("  it('US74-B04: an Organiser who does not manage this event is rejected', async () => {", "  // SCRUM-74-TC05\n"),
        ("  it('US74-B05: a Coordinator who is not assigned to this event is rejected', async () => {", "  // SCRUM-74-TC06\n"),
        ("  it('US74-B06: an Attendee only ever sees their own registration, never a summary', async () => {", "  // SCRUM-74-TC07\n"),
        ("  it('US74-B07: a missing event is 404', async () => {", "  // SCRUM-74-TC08\n"),
        ("  it('US74-R01: the Organiser reads registrations through the API', async () => {", "  // SCRUM-74-TC09\n"),
        ("  it('US74-R02: an unrelated Organiser gets 403 through the API', async () => {", "  // SCRUM-74-TC10\n"),
        ("  it('US74-R03: the route needs a signed-in user', async () => {", "  // SCRUM-74-TC11\n"),
    ]),
    (FRONTEND / "src" / "components" / "EventRegistrationsCard.test.jsx", [
        ("  it('US74-F01: lists every attendee with their status and the active count against capacity', () => {", "  // SCRUM-74-TC12\n"),
        ("  it('US74-F02: shows a count of zero when nobody has registered', () => {", "  // SCRUM-74-TC13\n"),
        ("  it('US74-F03: explains when registration has not been enabled yet, instead of showing 0 capacity', () => {", "  // SCRUM-74-TC14\n"),
        ("  it('US74-F04: says so when registration details cannot be loaded', () => {", "  // SCRUM-74-TC15\n"),
        ('  it(\'US74-F05: falls back to "Unnamed attendee" when the name is missing\', () => {', "  // SCRUM-74-TC16\n"),
    ]),
]

for path, targets in LABEL_TARGETS:
    if not path.exists():
        report.append((str(path), "(all labels)", "SKIPPED - file not found"))
        continue
    for anchor, comment in targets:
        label = comment.strip().lstrip('/ ').split(' ')[0]
        insert_before(path, anchor, comment, label)


# ============================================================
# Report
# ============================================================
print(f"\n{'='*70}\nDone. {len(report)} actions attempted.\n{'='*70}")
ok = [r for r in report if r[2] in ("inserted", "appended", "created")]
skipped_dup = [r for r in report if "already applied" in r[2]]
failed = [r for r in report if r not in ok and r not in skipped_dup]

print(f"\nApplied: {len(ok)}")
for f, l, s in ok:
    print(f"  [OK] {f} :: {l} -> {s}")

if skipped_dup:
    print(f"\nAlready applied (skipped, safe to ignore): {len(skipped_dup)}")

if failed:
    print(f"\n*** NEEDS YOUR ATTENTION: {len(failed)} ***")
    for f, l, s in failed:
        print(f"  [!!] {f} :: {l} -> {s}")
    print("\nThese likely mean your local file differs slightly from what this script expected")
    print("(e.g. you already edited it). Add those labels by hand using the pattern shown above.")
else:
    print("\nEverything matched cleanly. Now run your test suites to confirm nothing broke:")
    print("  cd backend && npm test")
    print("  cd ../frontend && npm test")

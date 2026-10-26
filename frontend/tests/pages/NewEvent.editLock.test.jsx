/**
 * SCRUM-40: NewEvent edit route.
 *   - Confirmed (and closed) events are refused for the assigned Coordinator (2A).
 *   - The assigned Coordinator can edit and save before Confirmed (1C), without the draft /
 *     submit flow and without sending the registration fields the backend refuses (SCRUM-63).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import NewEvent from '../../src/pages/NewEvent';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

// Shaped like GET /api/events/:id, including the registration fields the real API returns.
const EVENT = {
  id: 3,
  name: 'Planning workshop',
  status: 'PLANNING',
  organiserId: 1,
  coordinatorId: 2,
  purpose: 'Learn',
  description: 'A workshop',
  category: 'WORKSHOP',
  startAt: '2026-11-20T10:00:00Z',
  endAt: '2026-11-20T12:00:00Z',
  expectedAttendance: 40,
  accessibilityNeeds: 'None',
  layoutPreference: 'THEATRE',
  venueRequirements: 'Room',
  registrationRequired: true,
  registrationOpen: false,
  registrationOpensAt: null,
  registrationClosesAt: null,
  registrationCapacity: 40,
};

function mockApi(event) {
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/api/events' && !options.method) return { events: [] };
    if (path === '/api/events/3' && options.method === 'PATCH') return { event: { ...event, ...options.body } };
    if (path === '/api/events/3') return { event };
    throw new Error(`Unexpected ${path}`);
  });
}

function renderEdit(user) {
  useAuth.mockReturnValue({
    user,
    hasRole: (...roles) => roles.some((role) => user.roles.includes(role)),
  });
  render(
    <MemoryRouter
      initialEntries={['/app/events/3/edit']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/app/events/:id/edit" element={<NewEvent />} />
        <Route path="/app/events/:id" element={<div>Event page</div>} />
        <Route path="/app/drafts" element={<div>Drafts page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const COORDINATOR = { id: 2, roles: ['EVENT_COORDINATOR'] };

beforeEach(() => jest.clearAllMocks());

/*
 * AC:       SCRUM-40 AC3 / product 2A
 * Scenario: Assigned Coordinator opens /app/events/:id/edit on a Confirmed event.
 * Setup:    coordinatorId matches session; status CONFIRMED.
 * Expected: Form is not shown; locked message mentions change requests.
 * Type:     error / UI lock
 */
// SCRUM-40-TC11
it('US40-F03 (AC3/2A): Confirmed edit URL shows the locked message instead of the form', async () => {
  mockApi({ ...EVENT, status: 'CONFIRMED' });
  renderEdit(COORDINATOR);

  expect(
    await screen.findByText(/confirmed and closed events cannot be edited directly/i)
  ).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /edit event details/i })).not.toBeInTheDocument();
});

/*
 * AC:       SCRUM-40 AC1 / product 1C
 * Scenario: Assigned Coordinator opens the edit page for a Planning event.
 * Setup:    status PLANNING; coordinatorId matches session.
 * Expected: Coordinator edit layout — a "Save changes" button; no "Save as draft" and no
 *           "Submit for review" (those belong to the organiser's draft flow).
 * Type:     normal
 */
// SCRUM-40-TC12
it('US40-F04 (AC1/1C): Coordinator sees Save changes, not the draft / submit buttons', async () => {
  mockApi(EVENT);
  renderEdit(COORDINATOR);

  expect(await screen.findByRole('heading', { name: /edit event details/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /save as draft/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /submit for review/i })).not.toBeInTheDocument();
});

/*
 * AC:       SCRUM-40 AC1 / AC4 (valid edit is saved); SCRUM-63 (registration settings locked)
 * Scenario: Coordinator changes the purpose on a Planning event and saves.
 * Setup:    The loaded event carries registrationOpen / registrationOpensAt /
 *           registrationClosesAt, exactly as the real API returns it. Sending those back is
 *           what made every Coordinator edit fail with REGISTRATION_SETTINGS_LOCKED.
 * Expected: PATCH contains the edited purpose and none of the registration fields; the user
 *           lands back on the event page, not the drafts list; /submit is never called.
 * Type:     normal / regression
 */
// SCRUM-40-TC13
it('US40-F05 (AC1+AC4): saving sends editable fields only and returns to the event page', async () => {
  mockApi(EVENT);
  renderEdit(COORDINATOR);
  const user = userEvent.setup();

  const purpose = await screen.findByLabelText(/purpose/i);
  await user.clear(purpose);
  await user.type(purpose, 'Updated purpose');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(await screen.findByText('Event page')).toBeInTheDocument();
  const patch = api.mock.calls.find(([path, options]) => path === '/api/events/3' && options?.method === 'PATCH');
  expect(patch[1].body).toMatchObject({ purpose: 'Updated purpose', name: 'Planning workshop' });
  ['registrationOpen', 'registrationOpensAt', 'registrationClosesAt', 'registrationCapacity'].forEach((field) => {
    expect(patch[1].body).not.toHaveProperty(field);
  });
  expect(api).not.toHaveBeenCalledWith('/api/events/3/submit', expect.anything());
  expect(screen.queryByText('Drafts page')).not.toBeInTheDocument();
});

/*
 * AC:       SCRUM-38 / SCRUM-63 (regression)
 * Scenario: Organiser amends a clarification request and saves.
 * Setup:    UNDER_REVIEW + ACTION_REQUIRED with the same registration fields on the event.
 * Expected: PATCH again omits the registration fields, so the amend is not refused.
 * Type:     regression
 */
it('US38-F01 (SCRUM-63 regression): organiser clarification amend also omits the registration fields', async () => {
  mockApi({ ...EVENT, status: 'UNDER_REVIEW', subState: 'ACTION_REQUIRED', reviewRemarks: 'Add detail' });
  renderEdit({ id: 1, roles: ['EVENT_ORGANISER'] });
  const user = userEvent.setup();

  await user.click(await screen.findByRole('button', { name: 'Save changes' }));

  await screen.findByText('Event page');
  const patch = api.mock.calls.find(([path, options]) => path === '/api/events/3' && options?.method === 'PATCH');
  expect(patch[1].body).not.toHaveProperty('registrationOpen');
  expect(patch[1].body).not.toHaveProperty('registrationOpensAt');
});

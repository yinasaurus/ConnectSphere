import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import { useAuth } from '../auth';

jest.mock('../auth', () => ({ useAuth: jest.fn() }));

function mount(roles, { loading = false, loggedIn = true, allowedRoles = ['EVENT_COORDINATOR', 'VENUE_STAFF'] } = {}) {
  useAuth.mockReturnValue({
    loading, user: loggedIn ? { roles } : null,
    hasRole: (...allowed) => roles.some((role) => allowed.includes(role)),
  });
  render(
    <MemoryRouter initialEntries={['/restricted']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<p>Login destination</p>} />
        <Route path="/app" element={<p>Home destination</p>} />
        <Route path="/restricted" element={<ProtectedRoute allowedRoles={allowedRoles}><p>Protected content</p></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>
  );
}

it.each([['EVENT_ORGANISER'], ['ATTENDEE'], ['TECHNICAL_SUPPORT'], ['UNKNOWN']])('denies role %s', async (role) => {
  mount([role]);
  expect(await screen.findByText('Home destination')).toBeInTheDocument();
  expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
});

it.each([['EVENT_COORDINATOR'], ['VENUE_STAFF']])('allows role %s', (role) => {
  mount([role]);
  expect(screen.getByText('Protected content')).toBeInTheDocument();
});

it('accepts any matching role, including a second role on a hybrid account', () => {
  mount(['EVENT_COORDINATOR', 'VENUE_STAFF'], { allowedRoles: ['VENUE_STAFF'] });
  expect(screen.getByText('Protected content')).toBeInTheDocument();
});

it('redirects logged-out users to login', async () => {
  mount([], { loggedIn: false });
  expect(await screen.findByText('Login destination')).toBeInTheDocument();
});

it('waits for session restoration without rendering protected content', () => {
  mount([], { loading: true, loggedIn: false });
  expect(screen.getByText('Restoring your session…')).toBeInTheDocument();
  expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
});

it('preserves login-only routes without a role restriction', () => {
  mount(['ATTENDEE'], { allowedRoles: [] });
  expect(screen.getByText('Protected content')).toBeInTheDocument();
});

describe('SCRUM-54 role-limited screens', () => {
  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Lead opens a Lead-only screen.
   * Setup: allowedRoles is EVENT_COORDINATOR_LEAD; session is a Lead.
   * Expected: The protected content is shown.
   * Type: normal
   */
  it('lets a Lead open a Lead-only route', () => {
    mount(['EVENT_COORDINATOR_LEAD'], { allowedRoles: ['EVENT_COORDINATOR_LEAD'] });
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Coordinator who is not a Lead opens the unassigned queue route.
   * Setup: allowedRoles is EVENT_COORDINATOR_LEAD; session is EVENT_COORDINATOR.
   * Expected: Redirect to home; the Lead-only page is not rendered.
   * Type: error
   */
  it('blocks a Coordinator who is not a Lead from a Lead-only route', async () => {
    mount(['EVENT_COORDINATOR'], { allowedRoles: ['EVENT_COORDINATOR_LEAD'] });
    expect(await screen.findByText('Home destination')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: A Safety Officer opens a safety-check route.
   * Setup: allowedRoles is SAFETY_OFFICER.
   * Expected: The page is shown.
   * Type: normal
   */
  it('lets a Safety Officer open a safety-check route', () => {
    mount(['SAFETY_OFFICER'], { allowedRoles: ['SAFETY_OFFICER'] });
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: A Coordinator opens a safety-check route.
   * Setup: allowedRoles is SAFETY_OFFICER; session is EVENT_COORDINATOR.
   * Expected: Redirect to home; the safety check is not rendered.
   * Type: error
   */
  it('blocks a Coordinator from a Safety Officer-only route', async () => {
    mount(['EVENT_COORDINATOR'], { allowedRoles: ['SAFETY_OFFICER'] });
    expect(await screen.findByText('Home destination')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC2
   * Scenario: A hybrid Coordinator + Lead opens a Lead-only route in the same session.
   * Setup: Both roles; allowedRoles is Lead only.
   * Expected: They can use the Lead function because they hold Lead.
   * Type: normal
   */
  it('lets a Coordinator + Lead hybrid open a Lead-only route', () => {
    mount(['EVENT_COORDINATOR', 'EVENT_COORDINATOR_LEAD'], { allowedRoles: ['EVENT_COORDINATOR_LEAD'] });
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });
});

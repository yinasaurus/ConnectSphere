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

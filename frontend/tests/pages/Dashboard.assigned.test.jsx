/**
 * View all on a Coordinator's home page opens Assigned to me, not the full Events list.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../../src/pages/Dashboard';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

function renderDashboard(roles) {
  api.mockImplementation(async (path) => (path === '/api/events' ? { events: [] } : { unread: 0 }));
  useAuth.mockReturnValue({
    user: { id: 2, fullName: 'Chloe Lim', roles },
    hasRole: (...wanted) => wanted.some((role) => roles.includes(role)),
  });
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Dashboard />
    </MemoryRouter>
  );
}

/*
 * Scenario: A Coordinator is on the home page, where Upcoming shows at most 8 assigned events.
 * Setup: The user is only a Coordinator.
 * Expected: View all goes to Events with Assigned to me already on.
 * Type: normal
 */
it('sends a Coordinator View all to the assigned filter', async () => {
  renderDashboard(['EVENT_COORDINATOR']);

  expect(await screen.findByRole('link', { name: 'View all' })).toHaveAttribute('href', '/app/events?assigned=me');
});

/*
 * Scenario: An Organiser is on the home page.
 * Setup: The user is only an Organiser.
 * Expected: View all still opens the full Events list.
 * Type: boundary
 */
it('sends an Organiser View all to the full events list', async () => {
  renderDashboard(['EVENT_ORGANISER']);

  expect(await screen.findByRole('link', { name: 'View all' })).toHaveAttribute('href', '/app/events');
});

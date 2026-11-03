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

function renderDashboard(roles, events = []) {
  api.mockImplementation(async (path) => (path === '/api/events' ? { events } : { unread: 0 }));
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
// SCRUM-83-TC01
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
// SCRUM-83-TC02
it('sends an Organiser View all to the full events list', async () => {
  renderDashboard(['EVENT_ORGANISER']);

  expect(await screen.findByRole('link', { name: 'View all' })).toHaveAttribute('href', '/app/events');
});

/*
 * Scenario: A Coordinator has nine events assigned to them.
 * Setup: Events 1 to 9, all with coordinatorId 2, returned in start order.
 * Expected: Upcoming lists the first 8. The ninth is left for View all.
 * Type: boundary
 */
// SCRUM-83-TC07
it('lists at most 8 assigned events in Upcoming', async () => {
  const nine = Array.from({ length: 9 }, (_, index) => ({
    id: index + 1, name: `Assigned ${index + 1}`, status: 'PLANNING', coordinatorId: 2,
  }));
  renderDashboard(['EVENT_COORDINATOR'], nine);

  expect(await screen.findByRole('link', { name: 'Assigned 8' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Assigned 1' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Assigned 9' })).not.toBeInTheDocument();
});

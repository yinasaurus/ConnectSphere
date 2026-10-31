/**
 * SCRUM-29 AC1: the Organiser's dashboard "Upcoming" list shows each event's assigned
 * Coordinator, or "Unassigned" before the Lead assigns one.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../../src/pages/Dashboard';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

/*
 * AC:       SCRUM-29 AC1
 * Scenario: An Organiser opens the dashboard with one assigned and one unassigned event.
 * Setup:    Event A has coordinatorName "Chloe Lim"; event B has none (still Submitted).
 * Expected: Row A shows "Chloe Lim"; row B shows "Unassigned".
 * Type:     normal
 */
// SCRUM-29-TC18
it('US29-F04: dashboard shows the assigned Coordinator or Unassigned per event', async () => {
  const events = [
    { id: 1, name: 'Assigned event', status: 'PLANNING', coordinatorId: 2, coordinatorName: 'Chloe Lim' },
    { id: 2, name: 'Waiting event', status: 'SUBMITTED', coordinatorId: null, coordinatorName: null },
  ];
  api.mockImplementation(async (path) => (path === '/api/events' ? { events } : { unread: 0 }));
  useAuth.mockReturnValue({
    user: { id: 20, fullName: 'Aisha Rahman' },
    hasRole: (...roles) => roles.includes('EVENT_ORGANISER'),
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Dashboard />
    </MemoryRouter>
  );

  const assignedRow = (await screen.findByText('Assigned event')).closest('tr');
  const waitingRow = screen.getByText('Waiting event').closest('tr');
  expect(assignedRow).toHaveTextContent('Chloe Lim');
  expect(waitingRow).toHaveTextContent('Unassigned');
});

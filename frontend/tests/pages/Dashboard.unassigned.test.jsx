/**
 * SCRUM-30: the organiser's dashboard keeps a submitted request visible and flagged Unassigned.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../../src/pages/Dashboard';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

function renderDashboard(user, hasRole, events) {
  api.mockImplementation(async (path) => (
    path === '/api/events' ? { events } : { unread: 0 }
  ));
  useAuth.mockReturnValue({ user, hasRole });
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Dashboard />
    </MemoryRouter>
  );
}

const townHall = {
  id: 3,
  name: 'Town Hall',
  status: 'SUBMITTED',
  coordinatorId: null,
  coordinatorName: null,
  organiserId: 1,
};

describe('SCRUM-30 Unassigned flag on the dashboard', () => {
  /*
   * AC: SCRUM-30 AC1, AC2
   * Scenario: The organiser who submitted the request opens the dashboard.
   * Setup: Town Hall is SUBMITTED with no coordinator name. The user is that organiser.
   * Expected: The event is in Upcoming and the Coordinator cell says Unassigned.
   * Type: normal
   */
  it('US30-F04: the submitting organiser sees the event flagged Unassigned', async () => {
    renderDashboard(
      { id: 1, fullName: 'Aisha Rahman' },
      (...roles) => roles.includes('EVENT_ORGANISER'),
      [townHall]
    );

    expect(await screen.findByRole('link', { name: 'Town Hall' })).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-30 AC2
   * Scenario: The Lead opens the dashboard before assigning anyone.
   * Setup: The Lead is not also a Coordinator, so Upcoming is not limited to their own assignments.
   *         Town Hall is SUBMITTED with no coordinator name.
   * Expected: The Lead can see the event, flagged Unassigned.
   * Type: normal
   */
  it('US30-F05: the Lead sees the unassigned event on the dashboard', async () => {
    renderDashboard(
      { id: 11, fullName: 'Ivy Chen' },
      (...roles) => roles.includes('EVENT_COORDINATOR_LEAD'),
      [townHall]
    );

    expect(await screen.findByRole('link', { name: 'Town Hall' })).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-30 AC3
   * Scenario: A Coordinator has been assigned and the organiser comes back to the dashboard.
   * Setup: Town Hall is UNDER_REVIEW and coordinatorName is Chloe Lim.
   * Expected: The event is still listed under that name. Unassigned is not shown.
   * Type: normal
   */
  it('US30-F06: after assignment the dashboard shows the Coordinator and not Unassigned', async () => {
    renderDashboard(
      { id: 1, fullName: 'Aisha Rahman' },
      (...roles) => roles.includes('EVENT_ORGANISER'),
      [{
        ...townHall,
        status: 'UNDER_REVIEW',
        coordinatorId: 2,
        coordinatorName: 'Chloe Lim',
      }]
    );

    expect(await screen.findByRole('link', { name: 'Town Hall' })).toBeInTheDocument();
    expect(screen.getByText('Chloe Lim')).toBeInTheDocument();
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-30 AC2
   * Scenario: The signed-in person is both a Lead and a Coordinator.
   * Setup: Town Hall is SUBMITTED with no Coordinator. hasRole is true for both roles.
   * Expected: Upcoming still shows the event, flagged Unassigned. The Coordinator
   *           "assigned to me" filter does not hide it.
   * Type: boundary
   */
  it('US30-F08: a Lead who is also a Coordinator still sees the unassigned event', async () => {
    renderDashboard(
      { id: 11, fullName: 'Ivy Chen' },
      (...roles) => roles.some((role) => role === 'EVENT_COORDINATOR' || role === 'EVENT_COORDINATOR_LEAD'),
      [townHall]
    );

    expect(await screen.findByRole('link', { name: 'Town Hall' })).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-30 AC2. SCRUM-84 AC3 — the visible count is assigned events only.
   * Scenario: A Coordinator who is not a Lead opens the dashboard.
   * Setup: Town Hall is SUBMITTED and coordinatorId is null, so it is not assigned to user 2.
   * Expected: It is not in Upcoming. Visible events is 0.
   * Type: boundary
   */
  it('US30-F09: a Coordinator who is not a Lead does not see an unassigned event', async () => {
    renderDashboard(
      { id: 2, fullName: 'Chloe Lim' },
      (...roles) => roles.includes('EVENT_COORDINATOR'),
      [townHall]
    );

    await waitFor(() => {
      const count = screen.getByText('Visible events').closest('.card').querySelector('h2');
      expect(count.textContent).toBe('0');
    });
    expect(screen.queryByRole('link', { name: 'Town Hall' })).not.toBeInTheDocument();
    expect(screen.getByText('Nothing to show for this role yet.')).toBeInTheDocument();
  });
});

/**
 * SCRUM-84 AC3: a Coordinator's event list is only the events assigned to them.
 * A Lead who is also a Coordinator still sees the full list.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Events from '../../src/pages/Events';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

const rows = [
  {
    id: 1, name: 'Mine', status: 'PLANNING', coordinatorId: 2,
    organisationName: 'Acme', category: 'MEETING', startAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 2, name: 'Theirs', status: 'SUBMITTED', coordinatorId: null,
    organisationName: 'Acme', category: 'MEETING', startAt: '2026-12-01T00:00:00Z',
  },
];

function renderEvents(user, entry) {
  api.mockResolvedValue({ events: rows });
  useAuth.mockReturnValue({
    user,
    hasRole: (...roles) => roles.some((role) => user.roles.includes(role)),
  });
  render(
    <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Events />
    </MemoryRouter>
  );
}

const chloe = { id: 2, fullName: 'Chloe Lim', roles: ['EVENT_COORDINATOR'] };
const jordan = { id: 2, fullName: 'Jordan Ng', roles: ['EVENT_COORDINATOR', 'EVENT_COORDINATOR_LEAD'] };
const organiser = { id: 1, fullName: 'Aisha Rahman', roles: ['EVENT_ORGANISER'] };

describe('SCRUM-84 coordinator event list', () => {
  /*
   * AC: SCRUM-84 AC3
   * Scenario: A Coordinator opens Events from the left menu.
   * Setup: One event assigned to them, one with no Coordinator. Address is /app/events.
   * Expected: Only their event is listed. There is no Assigned to me checkbox.
   * Type: normal
   */
  it('AC3: shows only events assigned to the Coordinator', async () => {
    renderEvents(chloe, '/app/events');

    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Theirs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Assigned to me' })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-84 AC3
   * Scenario: The Coordinator opens View all from the home page.
   * Setup: The address is /app/events?assigned=me. Same two events.
   * Expected: Only the event assigned to them is listed.
   * Type: normal
   */
  it('AC3: View all still lists only assigned events', async () => {
    renderEvents(chloe, '/app/events?assigned=me');

    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Theirs' })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-84 AC3
   * Scenario: A Lead who is also a Coordinator opens Events.
   * Setup: Same two events. The signed-in user holds both roles.
   * Expected: Both events are listed. Assigned to me is available and off.
   * Type: boundary
   */
  it('AC3: a Lead who is also a Coordinator still sees the full list', async () => {
    renderEvents(jordan, '/app/events');

    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Theirs' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Assigned to me' })).not.toBeChecked();
  });

  /*
   * AC: SCRUM-84 AC3
   * Scenario: That Lead turns Assigned to me on.
   * Setup: The full list is showing.
   * Expected: Only the event assigned to them remains.
   * Type: normal
   */
  it('AC3: a Lead can still narrow the list to events assigned to them', async () => {
    renderEvents(jordan, '/app/events');
    await screen.findByRole('heading', { name: 'Theirs' });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Assigned to me' }));

    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Theirs' })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-39 AC1
   * Scenario: An Organiser opens Events, including with ?assigned=me in the address.
   * Setup: Organiser is not a Coordinator.
   * Expected: No Assigned to me checkbox. Both events stay listed.
   * Type: boundary
   */
  it('does not filter the list for an organiser', async () => {
    renderEvents(organiser, '/app/events?assigned=me');

    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Theirs' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Assigned to me' })).not.toBeInTheDocument();
  });
});

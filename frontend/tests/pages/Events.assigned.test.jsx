/**
 * A Coordinator can list every event assigned to them. The Events page stays the full list
 * until Assigned to me is on.
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

function renderEvents(user, entry, events = rows) {
  api.mockResolvedValue({ events });
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
const organiser = { id: 1, fullName: 'Aisha Rahman', roles: ['EVENT_ORGANISER'] };

describe('Assigned to me on the events list', () => {
  /*
   * Scenario: A Coordinator opens Events from the left menu.
   * Setup: One event assigned to them, one with no Coordinator.
   * Expected: Both are listed. Assigned to me is available and off.
   * Type: normal
   */
  // SCRUM-83-TC03
  it('shows the full list when Assigned to me is off', async () => {
    renderEvents(chloe, '/app/events');

    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Theirs' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Assigned to me' })).not.toBeChecked();
  });

  /*
   * Scenario: The Coordinator opens View all from the home page.
   * Setup: The address is /app/events?assigned=me. Same two events.
   * Expected: Only the event assigned to them is listed. The checkbox is on.
   * Type: normal
   */
  // SCRUM-83-TC04
  it('shows only events assigned to the Coordinator when the filter is on', async () => {
    renderEvents(chloe, '/app/events?assigned=me');

    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Theirs' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Assigned to me' })).toBeChecked();
  });

  /*
   * Scenario: The Coordinator turns the filter off again.
   * Setup: The page opened with ?assigned=me.
   * Expected: The other event comes back. The full list is still there.
   * Type: normal
   */
  // SCRUM-83-TC05
  it('returns to the full list when Assigned to me is cleared', async () => {
    renderEvents(chloe, '/app/events?assigned=me');
    await screen.findByRole('heading', { name: 'Mine' });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Assigned to me' }));

    expect(await screen.findByRole('heading', { name: 'Theirs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mine' })).toBeInTheDocument();
  });

  /*
   * Scenario: An Organiser opens Events, including with ?assigned=me in the address.
   * Setup: Organiser is not a Coordinator.
   * Expected: No Assigned to me checkbox. Both events stay listed.
   * Type: boundary
   */
  // SCRUM-83-TC06
  it('does not filter the list for an organiser', async () => {
    renderEvents(organiser, '/app/events?assigned=me');

    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Theirs' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Assigned to me' })).not.toBeInTheDocument();
  });

  /*
   * Scenario: The Coordinator has more assigned events than the home page shows.
   * Setup: The address is /app/events?assigned=me. Events 1 to 9 all have coordinatorId 2.
   * Expected: All nine are listed, including the ninth that Upcoming leaves out.
   * Type: boundary
   */
  // SCRUM-83-TC08
  it('lists every assigned event, past the 8 on the home page', async () => {
    const nine = Array.from({ length: 9 }, (_, index) => ({
      id: index + 1, name: `Assigned ${index + 1}`, status: 'PLANNING', coordinatorId: 2,
      organisationName: 'Acme', category: 'MEETING', startAt: '2026-11-01T00:00:00Z',
    }));
    renderEvents(chloe, '/app/events?assigned=me', nine);

    expect(await screen.findByRole('heading', { name: 'Assigned 9' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: /^Assigned \d$/ })).toHaveLength(9);
  });

  /*
   * Scenario: Another Coordinator's event is in the list the API returns.
   * Setup: The address is /app/events?assigned=me. Mine has coordinatorId 2.
   *        Daniel's has coordinatorId 3.
   * Expected: Only Mine is listed. Daniel's event is hidden.
   * Type: normal
   */
  // SCRUM-83-TC09
  it('hides an event assigned to another Coordinator when the filter is on', async () => {
    const daniels = {
      id: 3, name: "Daniel's", status: 'PLANNING', coordinatorId: 3,
      organisationName: 'Acme', category: 'MEETING', startAt: '2026-11-15T00:00:00Z',
    };
    renderEvents(chloe, '/app/events?assigned=me', [rows[0], daniels]);

    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "Daniel's" })).not.toBeInTheDocument();
  });
});

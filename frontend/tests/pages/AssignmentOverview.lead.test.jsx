import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../src/api';
import AssignmentOverview from '../../src/pages/AssignmentOverview';

jest.mock('../../src/api', () => ({ api: jest.fn() }));

function renderOverview() {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AssignmentOverview />
    </MemoryRouter>
  );
}

describe('SCRUM-57 assignment overview page', () => {
  beforeEach(() => {
    api.mockReset();
  });

  /*
   * AC: SCRUM-57 AC1
   * Scenario: A Lead opens the overview and the API returns two of their allocations.
   * Setup: Chloe holds Leadership Forum. Daniel holds the Workshop. The API has already
   *   limited the list to this Lead, which is what the page renders.
   * Expected: Both event names and both Coordinator names are on the page.
   * Type: normal
   */
  it('US57-F01: the page lists the Coordinators and the events they were assigned', async () => {
    api.mockResolvedValue({
      assignments: [
        { eventId: 3, eventName: 'Leadership Forum', coordinatorName: 'Chloe Lim', status: 'PLANNING' },
        { eventId: 8, eventName: 'Workshop', coordinatorName: 'Daniel Ong', status: 'UNDER_REVIEW' },
      ],
    });
    renderOverview();

    expect(await screen.findByText('Leadership Forum')).toBeInTheDocument();
    expect(screen.getByText('Workshop')).toBeInTheDocument();
    expect(screen.getByText('Chloe Lim')).toBeInTheDocument();
    expect(screen.getByText('Daniel Ong')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-57 AC4
   * Scenario: The page is given the overview from a later read, after the Coordinator changed.
   * Setup: The API payload lists Daniel Ong on Leadership Forum. Chloe Lim is absent from this payload.
   *   The assign and reassign writes are checked in US57-B05.
   * Expected: The page shows Daniel Ong. Chloe Lim is absent.
   * Type: normal
   */
  it('US57-F02: the next open shows the Coordinator from the latest read', async () => {
    api.mockResolvedValue({
      assignments: [
        { eventId: 3, eventName: 'Leadership Forum', coordinatorName: 'Daniel Ong', status: 'PLANNING' },
      ],
    });
    renderOverview();

    expect(await screen.findByText('Daniel Ong')).toBeInTheDocument();
    expect(screen.queryByText('Chloe Lim')).not.toBeInTheDocument();
  });
});

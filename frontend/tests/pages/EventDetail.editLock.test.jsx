/**
 * SCRUM-40: assigned Coordinator edit affordances on the event page.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from '../../src/pages/EventDetail';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

function mockEvent(status) {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') {
      return {
        event: {
          id: 3,
          name: 'Edit lock event',
          status,
          coordinatorId: 2,
          organiserId: 1,
        },
      };
    }
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [] };
    if (path === '/api/events/3/equipment-requests') return { requests: [] };
    if (path === '/api/events/3/change-requests') return { changeRequests: [] };
    throw new Error(`Unexpected ${path}`);
  });
}

async function renderAsAssignedCoordinator() {
  useAuth.mockReturnValue({
    user: { id: 2, roles: ['EVENT_COORDINATOR'] },
    hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
  });
  render(
    <MemoryRouter
      initialEntries={['/app/events/3']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/app/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByText('Edit lock event');
}

beforeEach(() => jest.clearAllMocks());

describe('SCRUM-40 EventDetail edit affordances', () => {
  /*
   * AC:       SCRUM-40 AC1 / product 1C
   * Scenario: Assigned Coordinator opens a Planning event.
   * Setup:    coordinatorId matches session user; status PLANNING.
   * Expected: "Edit event details" links to /app/events/3/edit.
   * Type:     normal
   */
  // SCRUM-40-TC08
  it('US40-F01 (AC1/1C): Planning shows Edit event details for the assigned Coordinator', async () => {
    mockEvent('PLANNING');
    await renderAsAssignedCoordinator();
    const link = screen.getByRole('link', { name: /edit event details/i });
    expect(link).toHaveAttribute('href', '/app/events/3/edit');
  });

  /*
   * AC:       SCRUM-40 AC3 / product 2A
   * Scenario: Assigned Coordinator opens a Confirmed event.
   * Setup:    Same assignment; status CONFIRMED.
   * Expected: No edit link; Confirmed note points at change requests.
   * Type:     error / UI lock
   */
  // SCRUM-40-TC09
  it('US40-F02 (AC3/2A): Confirmed hides Edit event details and shows the change-request note', async () => {
    mockEvent('CONFIRMED');
    await renderAsAssignedCoordinator();
    expect(screen.queryByRole('link', { name: /edit event details/i })).not.toBeInTheDocument();
    expect(screen.getByText(/confirmed events cannot be edited directly/i)).toBeInTheDocument();
  });
});

/**
 * SCRUM-29 (AC1, AC3): the event page shows the assigned Coordinator to the Organiser,
 * and shows the new Coordinator after a reassignment.
 * Notification delivery is tested once in backend/tests/events.assignmentNotice.test.js
 * (SCRUM-45) and backend/tests/events.assignedCoordinator.test.js; not repeated here.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../../src/auth';
import { api } from '../../src/api';
import EventDetail from '../../src/pages/EventDetail';

jest.mock('../../src/api', () => ({
  api: jest.fn(),
}));

jest.mock('../../src/auth', () => {
  const original = jest.requireActual('../../src/auth');
  return { ...original, useAuth: jest.fn() };
});

const organiserUser = {
  id: 20,
  fullName: 'Aisha Rahman',
  email: 'organiser@acme.example',
  roles: ['EVENT_ORGANISER'],
  organisationId: 1,
};

function baseEvent(overrides = {}) {
  return {
    id: 5,
    name: 'Global AI Summit',
    purpose: 'Tech showcase',
    description: 'Annual gathering',
    status: 'PLANNING',
    subState: null,
    organiserId: 20,
    organiserName: 'Aisha Rahman',
    organisationName: 'Acme Corp',
    coordinatorId: 10,
    coordinatorName: 'Chloe Lim',
    ...overrides,
  };
}

function renderAsOrganiser(event) {
  useAuth.mockReturnValue({
    user: organiserUser,
    hasRole: (...roles) => roles.some((r) => organiserUser.roles.includes(r)),
  });
  api.mockImplementation((path) => {
    if (path === '/api/auth/me') return Promise.resolve({ user: organiserUser });
    if (path === '/api/events/5') return Promise.resolve({ event });
    if (path === '/api/events/5/history') return Promise.resolve({ history: [] });
    if (path === '/api/comments/5') return Promise.resolve({ comments: [] });
    if (path === '/api/events/5/venue-bookings') return Promise.resolve({ bookings: [] });
    if (path === '/api/venues') return Promise.resolve({ venues: [] });
    return Promise.resolve({});
  });
  return render(
    <MemoryRouter initialEntries={['/app/events/5']}>
      <AuthProvider>
        <Routes>
          <Route path="/app/events/:id" element={<EventDetail />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('SCRUM-29 assigned Coordinator on the event page', () => {
  beforeEach(() => {
    api.mockReset();
  });

  /*
   * AC:       SCRUM-29 AC1
   * Scenario: Organiser opens an event that has an assigned Coordinator.
   * Setup:    coordinatorName "Chloe Lim" on the event.
   * Expected: The People card shows "Coordinator: Chloe Lim".
   * Type:     normal
   */
  // SCRUM-29-TC17
  it('US29-F01: shows the assigned Coordinator name to the Organiser', async () => {
    renderAsOrganiser(baseEvent());
    expect(await screen.findByText('Global AI Summit')).toBeInTheDocument();
    const line = screen.getByText('Coordinator:').closest('p');
    expect(line).toHaveTextContent('Coordinator: Chloe Lim');
  });

  /*
   * AC:       SCRUM-29 AC1
   * Scenario: Organiser opens an event the Lead has not assigned yet.
   * Setup:    coordinatorId and coordinatorName null.
   * Expected: The People card shows "Coordinator: Unassigned".
   * Type:     boundary
   */
  // SCRUM-29-TC18
  it('US29-F02: shows Unassigned when no Coordinator is assigned', async () => {
    renderAsOrganiser(baseEvent({ status: 'SUBMITTED', coordinatorId: null, coordinatorName: null }));
    expect(await screen.findByText('Global AI Summit')).toBeInTheDocument();
    const line = screen.getByText('Coordinator:').closest('p');
    expect(line).toHaveTextContent('Coordinator: Unassigned');
  });

  /*
   * AC:       SCRUM-29 AC3
   * Scenario: The Coordinator was changed; the Organiser opens the event afterwards.
   * Setup:    The API now returns coordinatorName "Dan Ong" (was Chloe Lim).
   * Expected: "Dan Ong" is shown and "Chloe Lim" is not.
   * Type:     normal
   */
  // SCRUM-29-TC19
  it('US29-F03: after reassignment the Organiser sees the new Coordinator, not the old one', async () => {
    renderAsOrganiser(baseEvent({ coordinatorId: 12, coordinatorName: 'Dan Ong' }));
    expect(await screen.findByText('Global AI Summit')).toBeInTheDocument();
    const line = screen.getByText('Coordinator:').closest('p');
    expect(line).toHaveTextContent('Coordinator: Dan Ong');
    expect(screen.queryByText(/Chloe Lim/)).not.toBeInTheDocument();
  });
});

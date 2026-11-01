import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../../src/auth';
import { api } from '../../src/api';
import EventDetail from '../../src/pages/EventDetail';

jest.mock('../../src/api', () => ({
  api: jest.fn(),
}));

jest.mock('../../src/auth', () => {
  const original = jest.requireActual('../../src/auth');
  return {
    ...original,
    useAuth: jest.fn(),
  };
});

/**
 * SCRUM-63: who sees the registration card on the event page, and that it calls the API.
 * The card's own form is tested in RegistrationSettingsCard.test.jsx.
 */
const assignedCoordinator = { id: 2, fullName: 'Chloe Lim', roles: ['EVENT_COORDINATOR'] };
const otherCoordinator = { id: 7, fullName: 'Daniel Ong', roles: ['EVENT_COORDINATOR'] };

function mockAuth(sessionUser) {
  useAuth.mockReturnValue({
    user: sessionUser,
    hasRole: (...roles) => roles.some((role) => sessionUser.roles.includes(role)),
  });
}

function eventWith(overrides = {}) {
  return {
    id: 3,
    name: 'Workshop',
    status: 'CONFIRMED',
    coordinatorId: 2,
    organiserId: 1,
    registrationOpen: false,
    ...overrides,
  };
}

function stubApi(sessionUser, eventData, calls = []) {
  api.mockImplementation((path, options = {}) => {
    calls.push({ path, ...options });
    if (path === '/api/auth/me') return Promise.resolve({ user: sessionUser });
    if (path === '/api/events/3') return Promise.resolve({ event: eventData });
    if (path === '/api/events/3/history') return Promise.resolve({ history: [] });
    if (path === '/api/comments/3') return Promise.resolve({ comments: [] });
    if (path === '/api/venues') return Promise.resolve({ venues: [] });
    if (path === '/api/events/3/venue-bookings') return Promise.resolve({ bookings: [] });
    if (path === '/api/events/3/equipment-requests') return Promise.resolve({ requests: [] });
    if (path === '/api/events/3/registration/enable') return Promise.resolve({ settings: {} });
    return Promise.reject(new Error(`Unhandled api: ${path}`));
  });
}

function renderEvent() {
  return render(
    <MemoryRouter initialEntries={['/app/events/3']}>
      <AuthProvider>
        <Routes>
          <Route path="/app/events/:id" element={<EventDetail />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('SCRUM-63 registration card (event page)', () => {
  beforeEach(() => {
    api.mockReset();
  });

  /*
   * AC: SCRUM-63 AC1, AC2
   * Scenario: The assigned Coordinator opens a Confirmed event and presses Enable.
   * Expected: the card is shown and the page calls the enable route.
   */
  it('US63-F06: the assigned Coordinator sees the card and can enable registration', async () => {
    const calls = [];
    mockAuth(assignedCoordinator);
    stubApi(assignedCoordinator, eventWith(), calls);
    renderEvent();

    await userEvent.click(await screen.findByRole('button', { name: 'Enable registration' }));

    expect(calls).toContainEqual(expect.objectContaining({
      path: '/api/events/3/registration/enable',
      method: 'POST',
    }));
  });

  /*
   * AC: SCRUM-63 AC7
   * Scenario: A Coordinator who is not assigned opens the same Confirmed event.
   * Expected: no registration card.
   */
  it('US63-F07: a Coordinator who is not assigned does not see the card', async () => {
    mockAuth(otherCoordinator);
    stubApi(otherCoordinator, eventWith());
    renderEvent();

    expect(await screen.findByRole('heading', { name: 'Workshop' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Open registration' })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-63 AC1
   * Scenario: The assigned Coordinator opens an event that is not Confirmed yet.
   * Expected: no registration card.
   */
  it('US63-F08: the card is hidden until the event is Confirmed', async () => {
    mockAuth(assignedCoordinator);
    stubApi(assignedCoordinator, eventWith({ status: 'PREPARATION' }));
    renderEvent();

    expect(await screen.findByRole('heading', { name: 'Workshop' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Open registration' })).not.toBeInTheDocument();
  });
});

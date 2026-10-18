import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../auth';
import { api } from '../api';
import EventDetail from './EventDetail';

jest.mock('../api', () => ({
  api: jest.fn(),
}));

jest.mock('../auth', () => {
  const original = jest.requireActual('../auth');
  return {
    ...original,
    useAuth: jest.fn(),
  };
});

/**
 * SCRUM-52: the Attendee's Register button on the event page.
 * The rules (window, capacity, duplicates) are checked by the API in
 * backend/tests/registrations.register.test.js; these tests check what the page shows.
 */
const attendee = { id: 30, fullName: 'Alex Tan', roles: ['ATTENDEE'] };

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
    registrationOpen: true,
    ...overrides,
  };
}

function stubApi(eventData, registerResult, calls = []) {
  api.mockImplementation((path, options = {}) => {
    calls.push({ path, ...options });
    if (path === '/api/auth/me') return Promise.resolve({ user: attendee });
    if (path === '/api/events/3') return Promise.resolve({ event: eventData });
    if (path === '/api/events/3/history') return Promise.resolve({ history: [] });
    if (path === '/api/comments/3') return Promise.resolve({ comments: [] });
    if (path === '/api/venues') return Promise.resolve({ venues: [] });
    if (path === '/api/events/3/venue-bookings') return Promise.resolve({ bookings: [] });
    if (path === '/api/events/3/equipment-requests') return Promise.resolve({ requests: [] });
    if (path === '/api/events/3/registrations') return registerResult();
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

describe('SCRUM-52 Register button (event page)', () => {
  beforeEach(() => {
    api.mockReset();
    mockAuth(attendee);
  });

  /*
   * AC: SCRUM-52 AC1, AC2
   * Scenario: An Attendee presses Register on a Confirmed event with registration open.
   * Expected: the page posts to the register route and shows how many places are left.
   */
  it('US52-F01: registering shows the places left', async () => {
    const calls = [];
    stubApi(eventWith(), () => Promise.resolve({ registration: { id: 99 }, placesLeft: 39 }), calls);
    renderEvent();

    await userEvent.click(await screen.findByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Registered. 39 places left.')).toBeInTheDocument();
    expect(calls).toContainEqual(expect.objectContaining({
      path: '/api/events/3/registrations',
      method: 'POST',
    }));
  });

  it('US52-F02: the message says "place" when one is left', async () => {
    stubApi(eventWith(), () => Promise.resolve({ registration: { id: 99 }, placesLeft: 1 }));
    renderEvent();

    await userEvent.click(await screen.findByRole('button', { name: 'Register' }));
    expect(await screen.findByText('Registered. 1 place left.')).toBeInTheDocument();
  });

  it('US52-F05: taking the last place says "0 places left"', async () => {
    stubApi(eventWith(), () => Promise.resolve({ registration: { id: 99 }, placesLeft: 0 }));
    renderEvent();

    await userEvent.click(await screen.findByRole('button', { name: 'Register' }));
    expect(await screen.findByText('Registered. 0 places left.')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-52 AC4
   * Scenario: The API refuses because the event is full.
   * Expected: the server's message is shown.
   */
  it('US52-F03: a refused registration shows the reason', async () => {
    const full = Object.assign(new Error('This event is full'), { status: 409, code: 'EVENT_FULL' });
    stubApi(eventWith(), () => Promise.reject(full));
    renderEvent();

    await userEvent.click(await screen.findByRole('button', { name: 'Register' }));
    expect(await screen.findByText('This event is full')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-52 AC5
   * Scenario: The Attendee double-clicks Register while the first request is still running.
   * Expected: the button is disabled and only one registration request is sent.
   */
  it('US52-F06: a double click sends only one registration', async () => {
    const calls = [];
    let finish;
    stubApi(eventWith(), () => new Promise((resolve) => { finish = resolve; }), calls);
    renderEvent();

    const button = await screen.findByRole('button', { name: 'Register' });
    await userEvent.dblClick(button);

    expect(screen.getByRole('button', { name: 'Registering...' })).toBeDisabled();
    finish({ registration: { id: 99 }, placesLeft: 9 });
    expect(await screen.findByText('Registered. 9 places left.')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/events/3/registrations')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Register' })).toBeEnabled();
  });

  /*
   * AC: SCRUM-52 AC3
   * Scenario: The event is Confirmed but registration has not been enabled.
   * Expected: no Register button, and a note that registration is not open.
   */
  it('US52-F04: there is no Register button until registration is enabled', async () => {
    stubApi(eventWith({ registrationOpen: false }), () => Promise.reject(new Error('should not be called')));
    renderEvent();

    expect(await screen.findByText('Registration is not open for this event.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument();
  });
});

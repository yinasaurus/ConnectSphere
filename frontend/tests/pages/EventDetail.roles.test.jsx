import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import EventDetail from '../../src/pages/EventDetail';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => {
  const original = jest.requireActual('../../src/auth');
  return { ...original, useAuth: jest.fn() };
});

function mockEvent(overrides = {}) {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') {
      return {
        event: {
          id: 3,
          name: 'Secret Workshop',
          purpose: 'Confidential purpose',
          description: 'Do not leak this description',
          status: 'UNDER_REVIEW',
          coordinatorId: 2,
          organiserId: 1,
          ...overrides,
        },
      };
    }
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [] };
    return {};
  });
}

function renderEvent() {
  render(
    <MemoryRouter initialEntries={['/app/events/3']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/app/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SCRUM-54 event page role limits', () => {
  beforeEach(() => {
    api.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /*
   * AC: SCRUM-84 AC2. Supersedes SCRUM-54 AC6.
   * Scenario: A Coordinator who is not assigned opens the event page.
   * Setup: The API refuses GET /api/events/3. Signed-in user is id 9 with EVENT_COORDINATOR.
   * Expected: The access-denied message is shown. The event name is not.
   * Type: error
   */
  // SCRUM-54-TC41. Expected result updated by SCRUM-84: access denied, name hidden.
  it('shows an access-denied message when a Coordinator is not assigned', async () => {
    useAuth.mockReturnValue({
      user: { id: 9, roles: ['EVENT_COORDINATOR'] },
      hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
    });
    api.mockImplementation(async (path) => {
      if (path === '/api/events/3') {
        const err = new Error('Access denied. You can only view events assigned to you.');
        err.status = 403;
        throw err;
      }
      return {};
    });
    renderEvent();
    expect(await screen.findByText('Access denied. You can only view events assigned to you.')).toBeInTheDocument();
    expect(screen.queryByText('Secret Workshop')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-84 AC2
   * Scenario: The assigned Coordinator has the event open, then a later refresh is denied.
   * Setup: The first load returns Secret Workshop. The next GET /api/events/3 is 403.
   * Expected: The name is gone and only the access-denied message remains.
   * Type: error
   */
  // SCRUM-84-TC10
  it('clears the event when a later load is access denied', async () => {
    jest.useFakeTimers();
    useAuth.mockReturnValue({
      user: { id: 2, roles: ['EVENT_COORDINATOR'] },
      hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
    });
    mockEvent({ status: 'PLANNING' });
    renderEvent();
    expect(await screen.findByText('Secret Workshop')).toBeInTheDocument();

    api.mockImplementation(async (path) => {
      if (path === '/api/events/3') {
        const err = new Error('Access denied. You can only view events assigned to you.');
        err.status = 403;
        throw err;
      }
      if (path === '/api/events/3/history') return { history: [] };
      if (path === '/api/comments/3') return { comments: [] };
      if (path === '/api/venues') return { venues: [] };
      if (path === '/api/events/3/venue-bookings') return { bookings: [] };
      return {};
    });
    await act(async () => { jest.advanceTimersByTime(10000); });

    expect(await screen.findByText('Access denied. You can only view events assigned to you.')).toBeInTheDocument();
    expect(screen.queryByText('Secret Workshop')).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-84 AC2
   * Scenario: Bookings fail on refresh while the event itself is still allowed.
   * Setup: The event load keeps returning Secret Workshop. Venue bookings return 403.
   * Expected: The event name stays. A bookings failure does not blank the page.
   * Type: boundary
   */
  // SCRUM-84-TC11
  it('keeps the event on screen when a bookings refresh is denied', async () => {
    jest.useFakeTimers();
    useAuth.mockReturnValue({
      user: { id: 2, roles: ['EVENT_COORDINATOR'] },
      hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
    });
    mockEvent({ status: 'PLANNING' });
    renderEvent();
    expect(await screen.findByText('Secret Workshop')).toBeInTheDocument();

    api.mockImplementation(async (path) => {
      if (path === '/api/events/3') {
        return {
          event: {
            id: 3, name: 'Secret Workshop', status: 'PLANNING', coordinatorId: 2, organiserId: 1,
          },
        };
      }
      if (path === '/api/events/3/venue-bookings') {
        const err = new Error('Booking list failed');
        err.status = 403;
        throw err;
      }
      if (path === '/api/events/3/history') return { history: [] };
      if (path === '/api/comments/3') return { comments: [] };
      if (path === '/api/venues') return { venues: [] };
      return {};
    });
    await act(async () => { jest.advanceTimersByTime(10000); });

    expect(await screen.findByText('Booking list failed')).toBeInTheDocument();
    expect(screen.getByText('Secret Workshop')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-55 AC4 / SCRUM-54 AC4
   * Scenario: A Safety Officer opens an event awaiting a safety check.
   * Setup: Session role SAFETY_OFFICER; event status AWAITING_SAFETY_CHECK.
   * Expected: They see Safety queue and Open safety check.
   * Type: normal
   */
  // SCRUM-54-TC42
  it('shows Open safety check to a Safety Officer', async () => {
    useAuth.mockReturnValue({
      user: { id: 12, roles: ['SAFETY_OFFICER'] },
      hasRole: (...roles) => roles.includes('SAFETY_OFFICER'),
    });
    mockEvent({ status: 'AWAITING_SAFETY_CHECK' });
    renderEvent();
    expect(await screen.findByRole('link', { name: 'Safety queue' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open safety check' })).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: A Coordinator who is not a Safety Officer opens an event.
   * Setup: Session role EVENT_COORDINATOR, assigned or not.
   * Expected: The safety-check control is not shown.
   * Type: error
   */
  // SCRUM-54-TC43
  it('does not show Open safety check to a Coordinator who is not a Safety Officer', async () => {
    useAuth.mockReturnValue({
      user: { id: 2, roles: ['EVENT_COORDINATOR'] },
      hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
    });
    mockEvent({ status: 'AWAITING_SAFETY_CHECK' });
    renderEvent();
    expect(await screen.findByText('Secret Workshop')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open safety check' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Safety queue' })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-56 AC8
   * Scenario: The assigned Coordinator opens the event after a safety outcome was recorded.
   * Setup: Event includes safetyCheck APPROVED with a reason (API only attaches this for
   *        organiser / assigned coordinator).
   * Expected: The Safety check outcome card shows the outcome and reason.
   * Type: normal
   */
  // SCRUM-56-TC22
  it('shows the safety check outcome card when the API includes safetyCheck', async () => {
    useAuth.mockReturnValue({
      user: { id: 2, roles: ['EVENT_COORDINATOR'] },
      hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
    });
    mockEvent({
      status: 'PREPARATION',
      safetyCheck: {
        outcome: 'APPROVED',
        reason: 'Exits clear',
        decidedAt: '2026-10-17T08:00:00.000Z',
      },
    });
    renderEvent();
    expect(await screen.findByText('Safety check outcome')).toBeInTheDocument();
    expect(screen.getByText(/APPROVED/)).toBeInTheDocument();
    expect(screen.getByText(/Exits clear/)).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-56 AC8
   * Scenario: A Lead opens the event after a safety outcome (API omits safetyCheck).
   * Setup: No safetyCheck on the event payload — matches canViewSafetyOutcome for non-contacts.
   * Expected: The outcome card is not shown.
   * Type: boundary
   */
  // SCRUM-56-TC23
  it('does not show the safety check outcome card when the API omits safetyCheck', async () => {
    useAuth.mockReturnValue({
      user: { id: 20, roles: ['EVENT_COORDINATOR_LEAD'] },
      hasRole: (...roles) => roles.includes('EVENT_COORDINATOR_LEAD'),
    });
    mockEvent({ status: 'PREPARATION' });
    renderEvent();
    expect(await screen.findByText('Secret Workshop')).toBeInTheDocument();
    expect(screen.queryByText('Safety check outcome')).not.toBeInTheDocument();
  });
});

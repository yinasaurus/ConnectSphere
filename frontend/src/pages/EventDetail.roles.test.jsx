import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api';
import EventDetail from './EventDetail';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => {
  const original = jest.requireActual('../auth');
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

  /*
   * AC: SCRUM-54 AC6
   * Scenario: A Coordinator who is not assigned opens the event page.
   * Setup: Event assigned to id 2; signed-in user is id 9 with EVENT_COORDINATOR.
   * Expected: They can see the event name, but not approve, reject, or confirm.
   * Type: normal
   */
  it('lets an unassigned Coordinator view an event but not change it', async () => {
    useAuth.mockReturnValue({
      user: { id: 9, roles: ['EVENT_COORDINATOR'] },
      hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
    });
    mockEvent({ status: 'PLANNING' });
    renderEvent();
    expect(await screen.findByText('Secret Workshop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm event' })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: A Safety Officer opens an event.
   * Setup: Session role SAFETY_OFFICER.
   * Expected: They see the control to open a safety check.
   * Type: normal
   */
  it('shows Open safety check to a Safety Officer', async () => {
    useAuth.mockReturnValue({
      user: { id: 12, roles: ['SAFETY_OFFICER'] },
      hasRole: (...roles) => roles.includes('SAFETY_OFFICER'),
    });
    mockEvent();
    renderEvent();
    expect(await screen.findByRole('link', { name: 'Open safety check' })).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: A Coordinator who is not a Safety Officer opens an event.
   * Setup: Session role EVENT_COORDINATOR, assigned or not.
   * Expected: The safety-check control is not shown.
   * Type: error
   */
  it('does not show Open safety check to a Coordinator who is not a Safety Officer', async () => {
    useAuth.mockReturnValue({
      user: { id: 2, roles: ['EVENT_COORDINATOR'] },
      hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
    });
    mockEvent();
    renderEvent();
    expect(await screen.findByText('Secret Workshop')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open safety check' })).not.toBeInTheDocument();
  });
});

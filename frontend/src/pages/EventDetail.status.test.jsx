/**
 * SCRUM-5: the coordinator's buttons follow the lifecycle one step at a time.
 *   Approved - pending venue (PLANNING)  -> "Mark venue secured" (VENUE_SECURED)
 *   Venue secured (VENUE_SECURED)        -> "Confirm event" (CONFIRMED)
 * There's no button that jumps from PLANNING straight to CONFIRMED.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from './EventDetail';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

// Fakes the API for event 3, assigned to coordinator 2, in the given status.
function mockEvent(status) {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') return { event: { id: 3, coordinatorId: 2, name: 'Status event', status } };
    if (path === '/api/events/3/status') return { event: {} };
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [] };
    throw new Error(`Unexpected ${path}`);
  });
}

function renderAsCoordinator() {
  useAuth.mockReturnValue({ user: { id: 2 }, hasRole: (...roles) => roles.includes('EVENT_COORDINATOR') });
  render(
    <MemoryRouter initialEntries={['/app/events/3']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
  return userEvent.setup();
}

beforeEach(() => jest.clearAllMocks());

// AC1 · From Approved - pending venue, the only forward step offered is Venue secured.
it('US5-F02: PLANNING offers "Mark venue secured", not "Confirm event"', async () => {
  mockEvent('PLANNING');
  const user = renderAsCoordinator();
  await user.click(await screen.findByRole('button', { name: 'Mark venue secured' }));
  expect(api).toHaveBeenCalledWith('/api/events/3/status', { method: 'POST', body: { status: 'VENUE_SECURED' } });
  expect(screen.queryByRole('button', { name: 'Confirm event' })).not.toBeInTheDocument();
});

// AC1 · From Venue secured, the next step offered is Confirm event.
it('US5-F03: VENUE_SECURED offers "Confirm event"', async () => {
  mockEvent('VENUE_SECURED');
  const user = renderAsCoordinator();
  await user.click(await screen.findByRole('button', { name: 'Confirm event' }));
  expect(api).toHaveBeenCalledWith('/api/events/3/status', { method: 'POST', body: { status: 'CONFIRMED' } });
  expect(screen.queryByRole('button', { name: 'Mark venue secured' })).not.toBeInTheDocument();
});

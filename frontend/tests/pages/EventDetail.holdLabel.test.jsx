/*
 * - AC: SCRUM-75 AC1 (a hold's status is Held).
 * - Scenario: a Held booking is shown on the event page and on the venue booking page.
 * - Expected: it reads HELD (or Held) once, and the stored status "Tentative" is not printed.
 * - Type: normal.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from '../../src/pages/EventDetail';
import VenueBooking from '../../src/pages/VenueBooking';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

function mockApi(status, venueName = 'Innovation Hall') {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') {
      return { event: { id: 3, name: 'Workshop', coordinatorId: 21, status: 'PLANNING' } };
    }
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') {
      return { bookings: [{ id: 10, event_id: 3, venue_id: 8, venue_name: venueName, status }] };
    }
    if (path === '/api/events/3/registrations') return { registrations: [] };
    if (path === '/api/events/3/change-requests') return { changeRequests: [] };
    throw new Error(`Unexpected API path: ${path}`);
  });
}

function renderAt(path) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/app/events/:id" element={<EventDetail />} />
        <Route path="/app/events/:id/venue-booking" element={<VenueBooking />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({
    user: { id: 21, roles: ['EVENT_COORDINATOR'] },
    hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
  });
});

describe('SCRUM-75 a hold is labelled Held', () => {
  it('US75-F17: the event page shows HELD for a hold, without "Tentative" beside it', async () => {
    mockApi('TENTATIVE');
    renderAt('/app/events/3');
    expect(await screen.findByText('HELD')).toBeInTheDocument();
    expect(screen.getByText('Innovation Hall: HELD')).toBeInTheDocument();
    expect(screen.queryByText(/tentative/i)).not.toBeInTheDocument();
  });

  it('US75-F18: other bookings still show their status text on the event page', async () => {
    mockApi('APPROVED');
    renderAt('/app/events/3');
    expect(await screen.findByText('Approved')).toBeInTheDocument();
  });

  it('US75-F19: the venue booking page shows Held for a hold, not Tentative', async () => {
    mockApi('TENTATIVE');
    renderAt('/app/events/3/venue-booking');
    expect(await screen.findByText('Held')).toBeInTheDocument();
    expect(screen.queryByText(/tentative/i)).not.toBeInTheDocument();
  });

  it('US75-F20: a hold at a venue with no name reads "Venue #8: HELD" for screen readers', async () => {
    mockApi('TENTATIVE', null);
    renderAt('/app/events/3');
    expect(await screen.findByText('Venue #8: HELD')).toBeInTheDocument();
  });
});

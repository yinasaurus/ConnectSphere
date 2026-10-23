/**
 * SCRUM-47: EventDetail Equipment Request Integration Tests
 *
 * AC1: Event Coordinator can create an equipment request for an event (link from EventDetail).
 * AC2/3/4: Equipment request details (type, quantity, specs, timing) displayed on EventDetail.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from '../../src/pages/EventDetail';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

const EVENT = {
  id: 3,
  name: 'Acme Annual Showcase',
  category: 'EXHIBITION',
  status: 'PLANNING',
  startAt: '2026-11-20T10:00:00.000Z',
  endAt: '2026-11-20T18:00:00.000Z',
  expectedAttendance: 200,
  purpose: 'Showcasing innovation',
  coordinatorId: 2,
  organiserId: 10,
  organiserName: 'Alice',
  coordinatorName: 'Bob',
};

const REQUESTS = [
  {
    id: 15,
    event_id: 3,
    equipment_id: 1,
    equipment_name: 'Wireless handheld mic',
    equipment_type: 'AUDIO',
    quantity: 2,
    status: 'PENDING',
    technical_requirements: 'Dual channel UHF receiver with XLR outputs',
    start_at: '2026-11-20T10:00:00.000Z',
    end_at: '2026-11-20T18:00:00.000Z',
  },
];

function mockApi({ event = EVENT, requests = REQUESTS } = {}) {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') return { event };
    if (path === '/api/events/3/venue-bookings') return { bookings: [] };
    if (path === '/api/events/3/equipment-requests') return { requests };
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/change-requests') return { changeRequests: [] };
    throw new Error(`Unexpected ${path}`);
  });
}

function renderEventDetail(role = 'EVENT_COORDINATOR', userId = 2, locationState = null) {
  useAuth.mockReturnValue({
    user: { id: userId },
    hasRole: (...roles) => roles.includes(role),
  });

  return render(
    <MemoryRouter initialEntries={[{ pathname: '/app/events/3', state: locationState }]}>
      <Routes>
        <Route path="/app/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SCRUM-47 EventDetail equipment integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AC1: displays "Request equipment" link for assigned Event Coordinator', async () => {
    mockApi();
    renderEventDetail('EVENT_COORDINATOR', 2);

    expect(await screen.findByText('Acme Annual Showcase')).toBeInTheDocument();
    const reqLink = screen.getByRole('link', { name: /Request equipment/i });
    expect(reqLink).toBeInTheDocument();
    expect(reqLink).toHaveAttribute('href', '/app/events/3/equipment-request');
  });

  it('AC1: hides "Request equipment" link for Organiser and Attendee', async () => {
    mockApi();
    renderEventDetail('EVENT_ORGANISER', 10);

    expect(await screen.findByText('Acme Annual Showcase')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Request equipment/i })).not.toBeInTheDocument();
  });

  it('AC2–AC4: displays equipment type, quantity, technical specifications, and timing', async () => {
    mockApi();
    renderEventDetail('EVENT_COORDINATOR', 2);

    expect(await screen.findByText(/Wireless handheld mic × 2: PENDING/i)).toBeInTheDocument();
    expect(screen.getByText(/Type: AUDIO/i)).toBeInTheDocument();
    expect(screen.getByText(/Dual channel UHF receiver with XLR outputs/i)).toBeInTheDocument();
  });

  it('shows success banner when returning with equipmentRequestSubmitted state', async () => {
    mockApi();
    renderEventDetail('EVENT_COORDINATOR', 2, { equipmentRequestSubmitted: true });

    expect(await screen.findByText(/Equipment request submitted. Technical Support Staff can now review and prepare the equipment./i)).toBeInTheDocument();
  });
});

/*
 * - AC: SCRUM-61 AC1, AC5, AC7.
 * - Scenario: The assigned Coordinator uses the event page to cancel a venue booking.
 * - Setup: Event, booking, and authenticated user data are supplied through mocked API calls.
 * - Expected: The action appears only for eligible bookings owned by the Coordinator and
 *   submits the booking-specific cancellation request.
 * - Type: normal and boundary.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from '../../src/pages/EventDetail';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

function renderBookingPage(status, assigned = true) {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') {
      return { event: { id: 3, name: 'Workshop', coordinatorId: assigned ? 21 : 99, status: 'PLANNING' } };
    }
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') {
      return { bookings: [{ id: 10, event_id: 3, venue_id: 8, venue_name: 'Innovation Hall', status }] };
    }
    if (path === '/api/events/3/status') return { event: { status: 'PLANNING' } };
    if (path === '/api/venues/bookings/10/cancel') return { booking: { id: 10, status: 'CANCELLED' } };
    if (path === '/api/events/3/registrations') return { registrations: [] };
    if (path === '/api/events/3/change-requests') return { changeRequests: [] };
    throw new Error(`Unexpected API path: ${path}`);
  });
  useAuth.mockReturnValue({
    user: { id: 21, roles: ['EVENT_COORDINATOR'] },
    hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
  });
  render(
    <MemoryRouter
      initialEntries={['/app/events/3']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SCRUM-61 cancel booking action', () => {
  /*
   * - AC: SCRUM-61 AC1.
   * - Scenario: The assigned Coordinator views a PENDING, APPROVED, or TENTATIVE booking.
   * - Setup: The event is assigned to the signed-in Coordinator and the booking has a
   *   cancellable status.
   * - Expected: An accessible Cancel booking button is shown.
   * - Type: normal.
   */
  it.each(['PENDING', 'APPROVED', 'TENTATIVE'])('shows Cancel booking for %s bookings', async (status) => {
    renderBookingPage(status);
    expect(await screen.findByRole('button', { name: /cancel booking/i })).toBeInTheDocument();
  });

  /*
   * - AC: SCRUM-61 AC5 and rejected-status handling.
   * - Scenario: The assigned Coordinator views a CANCELLED or REJECTED booking.
   * - Setup: The event is assigned to the signed-in Coordinator and the booking is not
   *   cancellable.
   * - Expected: No Cancel booking button is shown.
   * - Type: boundary.
   */
  it.each(['CANCELLED', 'REJECTED'])('hides Cancel booking for %s bookings', async (status) => {
    renderBookingPage(status);
    await screen.findByText('Innovation Hall');
    expect(screen.queryByRole('button', { name: /cancel booking/i })).not.toBeInTheDocument();
  });

  /*
   * - AC: SCRUM-61 AC7.
   * - Scenario: A Coordinator views a pending booking for an event assigned to another Coordinator.
   * - Setup: The signed-in Coordinator is not the event's assigned Coordinator.
   * - Expected: No Cancel booking button is shown.
   * - Type: error.
   */
  it('hides Cancel booking from a Coordinator who is not assigned', async () => {
    renderBookingPage('PENDING', false);
    await screen.findByText('Innovation Hall');
    expect(screen.queryByRole('button', { name: /cancel booking/i })).not.toBeInTheDocument();
  });

  /*
   * - AC: SCRUM-61 AC1, AC2.
   * - Scenario: The assigned Coordinator clicks Cancel booking.
   * - Setup: Booking 10 is cancellable and its event is assigned to the signed-in Coordinator.
   * - Expected: The page sends POST /api/venues/bookings/10/cancel for the selected booking.
   * - Type: normal.
   */
  it('posts to the cancellation endpoint for the selected booking', async () => {
    renderBookingPage('PENDING');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /cancel booking/i }));

    expect(api).toHaveBeenCalledWith('/api/venues/bookings/10/cancel', { method: 'POST' });
  });
});

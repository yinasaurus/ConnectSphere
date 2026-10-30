/*
 * Purpose: verify the EventDetail page exposes venue rescheduling only to the assigned Coordinator.
 * AC: SCRUM-62 AC1, AC3, AC6, AC7, AC10–AC12 — only eligible bookings on active events have a reschedule action.
 * Inputs: mocked page API, booking status, event assignment, and authenticated user.
 * Output: passing assertions for form visibility, PATCH request payload, and keyboard operation.
 * Failure: Jest reports missing/incorrect UI controls or API requests.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from '../../src/pages/EventDetail';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

/*
 * Purpose: render an event with one venue booking and coordinator identity controls.
 * AC: SCRUM-62 AC1, AC6, AC7, AC10–AC12 — form eligibility follows booking status, event status, and assignment.
 * Inputs: booking status, event status, and whether the signed-in Coordinator owns the event.
 * Output: a rendered EventDetail page with mocked supporting endpoints.
 * Failure: unexpected API paths throw and fail the test.
 */
function renderBookingPage(status, assigned = true, eventStatus = 'PLANNING') {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') {
      return {
        event: {
          id: 3,
          name: 'Workshop',
          coordinatorId: assigned ? 21 : 99,
          status: eventStatus,
        },
      };
    }
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') {
      return {
        bookings: [{
          id: 10,
          event_id: 3,
          venue_id: 8,
          venue_name: 'Innovation Hall',
          status,
          start_at: '2026-10-20T09:00:00.000Z',
          end_at: '2026-10-20T12:00:00.000Z',
        }],
      };
    }
    if (path === '/api/events/3/equipment-requests') return { requests: [] };
    if (path === '/api/events/3/change-requests') return { changeRequests: [] };
    if (path === '/api/events/3/registrations') return { registrations: [] };
    if (path === '/api/venues/bookings/10') return { booking: { id: 10, status: 'PENDING' } };
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

describe('SCRUM-62 EventDetail booking reschedule form', () => {
  /*
   * AC: SCRUM-62 AC1
   * Scenario: Assigned Coordinator views a PENDING booking.
   * Setup: The event belongs to the signed-in Coordinator and its booking is PENDING.
   * Expected: An accessible form named for booking 10 is rendered.
   * Type: normal
   */
  it('shows the reschedule form for a PENDING booking', async () => {
    renderBookingPage('PENDING');

    expect(await screen.findByRole('form', { name: /reschedule booking 10/i })).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-62 AC1
   * Scenario: Assigned Coordinator views an APPROVED booking.
   * Setup: The event belongs to the signed-in Coordinator and its booking is APPROVED.
   * Expected: An accessible form named for booking 10 is rendered.
   * Type: normal
   */
  it('shows the reschedule form for an APPROVED booking', async () => {
    renderBookingPage('APPROVED');

    expect(await screen.findByRole('form', { name: /reschedule booking 10/i })).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-62 AC6
   * Scenario: Assigned Coordinator views a CANCELLED booking.
   * Setup: The event belongs to the signed-in Coordinator and its booking is CANCELLED.
   * Expected: No reschedule form or save button is rendered.
   * Type: boundary
   */
  it('does not show a reschedule form for a CANCELLED booking', async () => {
    renderBookingPage('CANCELLED');
    await screen.findByText('Innovation Hall');

    expect(screen.queryByRole('form', { name: /reschedule booking/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save new time/i })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-62 AC10
   * Scenario: Assigned Coordinator views a REJECTED booking.
   * Setup: Booking status is REJECTED and the event is assigned to the signed-in Coordinator.
   * Expected: No reschedule form or save button is rendered.
   * Type: boundary
   */
  it('does not show a reschedule form for a REJECTED booking', async () => {
    renderBookingPage('REJECTED');
    await screen.findByText('Innovation Hall');

    expect(screen.queryByRole('form', { name: /reschedule booking/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save new time/i })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-62 AC11
   * Scenario: Assigned Coordinator views a booking belonging to a COMPLETED event.
   * Setup: Event status is COMPLETED and booking status is PENDING.
   * Expected: No reschedule form or save button is rendered.
   * Type: boundary
   */
  it('does not show a reschedule form when the event is COMPLETED', async () => {
    renderBookingPage('PENDING', true, 'COMPLETED');
    await screen.findByText('Innovation Hall');

    expect(screen.queryByRole('form', { name: /reschedule booking/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save new time/i })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-62 AC12
   * Scenario: Assigned Coordinator views a booking belonging to a CANCELLED event.
   * Setup: Event status is CANCELLED and booking status is PENDING.
   * Expected: No reschedule form or save button is rendered.
   * Type: boundary
   */
  it('does not show a reschedule form when the event is CANCELLED', async () => {
    renderBookingPage('PENDING', true, 'CANCELLED');
    await screen.findByText('Innovation Hall');

    expect(screen.queryByRole('form', { name: /reschedule booking/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save new time/i })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-62 AC7
   * Scenario: A Coordinator who is not assigned to the event views its booking.
   * Setup: The event belongs to Coordinator 99 while the signed-in Coordinator is user 21.
   * Expected: No reschedule form is rendered.
   * Type: security
   */
  it('does not show the form to a Coordinator who is not assigned', async () => {
    renderBookingPage('PENDING', false);
    await screen.findByText('Innovation Hall');

    expect(screen.queryByRole('form', { name: /reschedule booking/i })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-62 AC1
   * Scenario: Assigned Coordinator submits new start and end times.
   * Setup: Booking 10 is PENDING and both datetime-local fields receive valid values.
   * Expected: The page sends PATCH /api/venues/bookings/10 with the entered times.
   * Type: normal
   */
  it('sends the entered times to the booking-specific PATCH endpoint', async () => {
    renderBookingPage('PENDING');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('New start date and time'), '2026-10-21T10:00');
    await user.type(screen.getByLabelText('New end date and time'), '2026-10-21T13:00');
    await user.click(screen.getByRole('button', { name: /save new time/i }));

    expect(api).toHaveBeenCalledWith('/api/venues/bookings/10', {
      method: 'PATCH',
      body: {
        startAt: '2026-10-21T10:00',
        endAt: '2026-10-21T13:00',
      },
    });
  });

  /*
   * AC: SCRUM-62 AC1 and accessibility
   * Scenario: Coordinator submits the reschedule form using the keyboard.
   * Setup: Both date/time fields are filled and the named submit button is focused.
   * Expected: Pressing Enter submits the form and sends the PATCH request.
   * Type: boundary
   */
  it('provides a named, keyboard-operable Save new time button', async () => {
    renderBookingPage('PENDING');
    const user = userEvent.setup();
    const startInput = await screen.findByLabelText('New start date and time');
    await user.type(startInput, '2026-10-21T10:00');
    await user.type(screen.getByLabelText('New end date and time'), '2026-10-21T13:00');
    const button = screen.getByRole('button', { name: /save new time/i });
    button.focus();
    await user.keyboard('{Enter}');

    expect(api).toHaveBeenCalledWith('/api/venues/bookings/10', expect.objectContaining({
      method: 'PATCH',
      body: expect.objectContaining({
        startAt: '2026-10-21T10:00',
        endAt: '2026-10-21T13:00',
      }),
    }));
  });

  /*
   * AC: SCRUM-62 AC2
   * Scenario: The reschedule request fails because the new time conflicts with another booking.
   * Setup: The Coordinator fills both fields and the PATCH request rejects with BOOKING_CONFLICT.
   * Expected: The page reports the error and retains the entered values for correction.
   * Type: error
   */
  it('retains the entered times when the reschedule request fails', async () => {
    renderBookingPage('PENDING');
    const user = userEvent.setup();
    const startInput = await screen.findByLabelText('New start date and time');
    const endInput = screen.getByLabelText('New end date and time');
    await user.type(startInput, '2026-10-21T10:00');
    await user.type(endInput, '2026-10-21T13:00');
    api.mockRejectedValueOnce(Object.assign(new Error('New time conflicts with another booking'), {
      code: 'BOOKING_CONFLICT',
    }));

    await user.click(screen.getByRole('button', { name: /save new time/i }));

    expect(await screen.findByText('New time conflicts with another booking')).toBeInTheDocument();
    expect(startInput).toHaveValue('2026-10-21T10:00');
    expect(endInput).toHaveValue('2026-10-21T13:00');
  });
});

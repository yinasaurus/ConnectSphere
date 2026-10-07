import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import EventDetail from './EventDetail';
import VenueBooking from './VenueBooking';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const eventFixture = {
  id: 3,
  name: 'Course Withdrawal Conference',
  purpose: 'Discourage current students from dropping out',
  category: 'SEMINAR',
  status: 'PLANNING',
  coordinatorId: 2,
  startAt: '2026-11-10T10:00:00.000Z',
  endAt: '2026-11-10T12:00:00.000Z',
  expectedAttendance: 100,
  layoutPreference: 'THEATRE',
  venueRequirements: 'Air con',
  equipmentNotes: 'Speaker, projector and e-dollars',
  accessibilityNeeds: 'None',
};

const venueFixture = [
  { id: 4, name: 'Seminar Room 3-4', capacity: 40, setupMinutes: 15, teardownMinutes: 15 },
  { id: 5, name: 'Multi-purpose Hall B', capacity: 80, setupMinutes: 30, teardownMinutes: 45 },
  { id: 6, name: 'Unconfigured Room', capacity: 120, setupMinutes: null, teardownMinutes: 15 },
];

let savedBookings;

// Return the page's current event data and simulate the booking API's pending record.
function configureApi(event = eventFixture) {
  savedBookings = [];
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/api/events/3') return { event };
    if (path === '/api/venues') return { venues: venueFixture };
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: savedBookings };
    if (path === '/api/venues/bookings' && options.method === 'POST') {
      savedBookings = [{
        id: 8,
        venue_name: 'Multi-purpose Hall B',
        status: 'PENDING',
        start_at: eventFixture.startAt,
        end_at: eventFixture.endAt,
        setup_minutes: 30,
        teardown_minutes: 45,
        created_at: '2026-10-05T12:00:00.000Z',
      }];
      return { booking: { id: 8, status: 'PENDING' } };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
}

// Exercise the booking-to-event return in the same router used by the actual application.
function renderBookingRoute() {
  render(
    <MemoryRouter initialEntries={['/app/events/3/venue-booking']}>
      <Routes>
        <Route path="/app/events/:id/venue-booking" element={<VenueBooking />} />
        <Route path="/app/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({
    user: { id: 2 },
    hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
  });
  configureApi();
});

// AC1-AC6, AC8-AC9: review a configured venue, submit the exact event request, and return.
// Tests Successful Request Submission
/*
 * AC:       SCRUM-26 AC1 + AC2 + AC3 + AC4 + AC6 + AC8 + AC9
 * Scenario: An Event Coordinator submits a venue request after reviewing the event details.
 * Setup:    The event has valid dates and required details; the selected venue has capacity
 *           and configured setup/turnaround times.
 * Expected: The page displays the timing and requirements, sends the event, venue, dates,
 *           and venue timings, records the request as Pending, and returns to the event.
 * Type:     normal
 */
it('shows timing and requirements, then submits a pending request for this event', async () => {
  const user = userEvent.setup();
  renderBookingRoute();

  expect(await screen.findByRole('heading', { name: eventFixture.name })).toBeInTheDocument();
  expect(screen.getByText('Book a venue for this event')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Choose a venue'), '5');

  expect(screen.getByText('30 min setup before, 45 min turnaround after')).toBeInTheDocument();
  expect(screen.getByText('Multi-purpose Hall B seats 80. Your attendance is 100.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Submit request' })).toBeEnabled();
  expect(screen.queryByLabelText(/arrangement notes/i)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Submit request' }));

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/venues/bookings', {
    method: 'POST',
    body: {
      eventId: 3,
      venueId: 5,
      startAt: eventFixture.startAt,
      endAt: eventFixture.endAt,
      setupMinutes: 30,
      teardownMinutes: 45,
    },
  }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Venue booking request submitted. Venue Staff will review it as Pending.'
  );
  expect(screen.getByText('Multi-purpose Hall B')).toBeInTheDocument();
  expect(screen.getByText('Pending')).toBeInTheDocument();
});

// AC5 + AC9: absent requirements and unconfigured venue timing both keep submission disabled.
// Validation Test: Blocking Invalid Submissions
/*
 * AC:       SCRUM-26 AC5
 * Scenario: Required booking information is missing.
 * Setup:    The event has no accessibility requirement and the chosen venue has no valid
 *           setup time.
 * Expected: The page shows the missing venue timing and keeps Submit request disabled,
 *           preventing an incomplete booking from being sent.
 * Type:     error
 */
it('blocks submission when required details or venue timing are missing', async () => {
  const user = userEvent.setup();
  configureApi({ ...eventFixture, accessibilityNeeds: '' });
  renderBookingRoute();
  await user.selectOptions(await screen.findByLabelText('Choose a venue'), '6');

  expect(screen.getByText(/no valid setup or turnaround time/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
  expect(screen.getByText('Required venue details are recorded')).toBeInTheDocument();
});

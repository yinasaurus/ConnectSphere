import { render, screen, waitFor, within } from '@testing-library/react';
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
  {
    id: 4,
    name: 'Seminar Room 3-4',
    capacity: 40,
    setupMinutes: 15,
    teardownMinutes: 15,
    facilities: 'Projector, air conditioning',
    accessibility: 'Wheelchair access',
    layouts: ['THEATRE'],
  },
  {
    id: 5,
    name: 'Multi-purpose Hall B',
    capacity: 80,
    setupMinutes: 30,
    teardownMinutes: 45,
    facilities: 'Projector, stage',
    accessibility: 'Wheelchair access, lift',
    layouts: ['THEATRE', 'BANQUET'],
  },
  {
    id: 6,
    name: 'Unconfigured Room',
    capacity: 120,
    setupMinutes: null,
    teardownMinutes: 15,
    facilities: 'Projector',
    accessibility: 'Wheelchair access',
    layouts: ['THEATRE'],
  },
];

let savedBookings;

// Return the page's current event data and simulate the booking API's pending record.
function configureApi(event = eventFixture, bookings = [], venues = venueFixture) {
  savedBookings = bookings;
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/api/events/3') return { event };
    if (path === '/api/venues') return { venues };
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


/*
 * AC:       SCRUM-25 AC1 + AC6
 * Scenario: A Coordinator submits a request for a venue that does not meet the event capacity.
 * Setup:    Expected attendance is 100 and the selected venue has capacity for 80.
 * Expected: The page displays the capacity-mismatch reason and still allows this otherwise
 *           valid booking request to be submitted; the unsuitable label is not asserted here.
 * Type:     boundary
 */
/*
 * AC:       SCRUM-26 AC1 + AC2 + AC6
 * Scenario: An Event Coordinator submits a request for a selected venue and event schedule.
 * Setup:    The event has valid dates and required details; the selected venue has configured
 *           setup/turnaround times and no overlapping booking.
 * Expected: The request payload contains the selected venue and event dates/times; after
 *           submission, the event page shows the new request as Pending.
 * Type:     normal
 */
// SCRUM-26 AC1-AC6, AC8-AC9: review a configured venue, submit the exact event request, and return.
// Tests Successful Request Submission
it('shows timing and requirements, then submits a pending request for this event', async () => {
  const user = userEvent.setup();
  renderBookingRoute();

  expect(await screen.findByRole('heading', { name: eventFixture.name })).toBeInTheDocument();
  expect(screen.getByText('Book a venue for this event')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Choose a venue'), '5');

  expect(screen.getByText('30 min setup before, 45 min turnaround after')).toBeInTheDocument();
  expect(screen.getByText('Expected attendance (100) exceeds venue capacity (80).')).toBeInTheDocument();
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

// Confirm mismatches are listed and do not block an otherwise valid request.
/*
 * AC:       SCRUM-25 AC1 + AC2 + AC3 + AC4 + AC6
 * Scenario: The selected venue fails one or more suitability checks.
 * Setup:    Expected attendance exceeds capacity, and the venue is missing requested
 *           accessibility, facility, and room-layout requirements.
 * Expected: The suitability alert lists each applicable reason, while the request remains
 *           submittable because suitability is advisory; the result label is not asserted.
 * Type:     boundary
 */
it('shows all selected-venue mismatch reasons without preventing request submission', async () => {
  const user = userEvent.setup();
  const event = {
    ...eventFixture,
    expectedAttendance: 100,
    layoutPreference: 'CABARET',
    venueRequirements: 'HDMI connection',
    equipmentNotes: '',
    accessibilityNeeds: 'Wheelchair ramp',
  };
  configureApi(event);
  renderBookingRoute();
  await user.selectOptions(await screen.findByLabelText('Choose a venue'), '5');

  const suitabilityAlert = screen.getByRole('alert');
  expect(within(suitabilityAlert).getByText(
    'Expected attendance (100) exceeds venue capacity (80).'
  )).toBeInTheDocument();
  expect(within(suitabilityAlert).getByText(
    'Missing accessibility features: Wheelchair ramp.'
  )).toBeInTheDocument();
  expect(within(suitabilityAlert).getByText(
    'Missing required facilities: HDMI connection.'
  )).toBeInTheDocument();
  expect(within(suitabilityAlert).getByText(
    "Room layout 'CABARET' is not supported by this venue."
  )).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Submit request' })).toBeEnabled();
});

/*
 * AC:       SCRUM-25 AC1 + AC2 + AC4 + AC5 + AC6 + AC7
 * Scenario: An event has existing requests for more than one venue.
 * Setup:    One venue meets the event requirements and another exceeds its capacity and
 *           does not support the preferred room layout.
 * Expected: The request for each venue shows its own suitable/unsuitable result; the
 *           unsuitable result and reasons for one do not change the other's suitable result.
 * Type:     normal
 */
it('shows independent suitability results and reasons for each existing request', async () => {
  const event = {
    ...eventFixture,
    expectedAttendance: 50,
    layoutPreference: 'BANQUET',
    venueRequirements: 'Projector',
    equipmentNotes: '',
    accessibilityNeeds: 'Wheelchair access',
  };
  const bookings = [
    { id: 21, venue_id: 5, venue_name: 'Multi-purpose Hall B', status: 'PENDING' },
    { id: 20, venue_id: 4, venue_name: 'Seminar Room 3-4', status: 'REJECTED' },
  ];
  configureApi(event, bookings);
  renderBookingRoute();

  const suitableRequest = await screen.findByText('Multi-purpose Hall B').then((name) => name.closest('.venue-request-row'));
  const unsuitableRequest = screen.getByText('Seminar Room 3-4').closest('.venue-request-row');
  expect(within(suitableRequest).getByText('Venue appears suitable')).toBeInTheDocument();
  expect(within(unsuitableRequest).getByText('Venue appears unsuitable')).toBeInTheDocument();
  expect(within(unsuitableRequest).getByText(
    'Expected attendance (50) exceeds venue capacity (40).'
  )).toBeInTheDocument();
  expect(within(unsuitableRequest).getByText(
    "Room layout 'BANQUET' is not supported by this venue."
  )).toBeInTheDocument();
});

/*
 * AC:       SCRUM-25 AC5
 * Scenario: A venue request uses a venue that is no longer in the active venue catalogue.
 * Setup:    A past booking supplies an inactive venue's saved details; its capacity meets
 *           attendance, and the event has no other recorded venue requirements.
 * Expected: The page uses that request's venue snapshot to display a suitable result.
 * Type:     boundary
 */
it('uses each historical request venue snapshot when the venue is no longer active', async () => {
  const event = {
    ...eventFixture,
    expectedAttendance: 50,
    layoutPreference: '',
    venueRequirements: '',
    equipmentNotes: '',
    accessibilityNeeds: 'None',
  };
  const bookings = [{
    id: 22,
    venue_id: 99,
    venue_name: 'Former Venue',
    status: 'REJECTED',
    venue_details: {
      capacity: 100,
      facilities: null,
      accessibility: null,
      layouts: [],
    },
  }];
  configureApi(event, bookings, venueFixture);
  renderBookingRoute();

  const formerVenue = await screen.findByText('Former Venue');
  const requestRow = formerVenue.closest('.venue-request-row');
  expect(within(requestRow).getByText('Venue appears suitable')).toBeInTheDocument();
});

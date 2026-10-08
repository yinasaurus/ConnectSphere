import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../auth';
import { api } from '../api';
import EventDetail from './EventDetail';
import VenueBooking from './VenueBooking';
import Layout from '../components/Layout';
import ProtectedRoute from '../components/ProtectedRoute';

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

describe('SCUM-16 (Event Clarification & Review Panel)', () => {
  const coordinatorUser = {
    id: 10,
    fullName: 'Chloe Lim',
    email: 'coordinator@connectsphere.sg',
    roles: ['EVENT_COORDINATOR'],
    organisationId: null,
  };

  const organiserUser = {
    id: 20,
    fullName: 'Aisha Rahman',
    email: 'organiser@acme.example',
    roles: ['EVENT_ORGANISER'],
    organisationId: 1,
  };

  beforeEach(() => {
    api.mockReset();
  });

  /*
   * AC:       AC1 & AC2 (UI: Request Clarification)
   * Scenario: Coordinator opens review panel and submits clarification request
   * Setup:    Event in UNDER_REVIEW status with coordinator id 10
   * Expected: Review remarks are sent via POST /api/events/5/clarification
   * Type:     normal
   */
  it('US16-UI01 (AC1+AC2): allows coordinator to view review panel and request clarification with remarks', async () => {
    const user = userEvent.setup();
    let sentRemarks = null;

    useAuth.mockReturnValue({
      user: coordinatorUser,
      hasRole: (...roles) => roles.some((r) => coordinatorUser.roles.includes(r)),
    });

    const eventData = {
      id: 5,
      name: 'Global AI Summit',
      purpose: 'Tech showcase',
      description: 'Annual gathering',
      status: 'UNDER_REVIEW',
      subState: 'IN_REVIEW',
      reviewRemarks: null,
      coordinatorId: 10,
      organiserId: 20,
      organisationName: 'Acme Corp',
      coordinatorName: 'Chloe Lim',
      organiserName: 'Aisha Rahman',
    };

    api.mockImplementation((path, options = {}) => {
      if (path === '/api/auth/me') return Promise.resolve({ user: coordinatorUser });
      if (path === '/api/events/5') return Promise.resolve({ event: eventData });
      if (path === '/api/events/5/history') return Promise.resolve({ history: [] });
      if (path === '/api/comments/5') return Promise.resolve({ comments: [] });
      if (path === '/api/venues') return Promise.resolve({ venues: [] });
      if (path === '/api/venues/bookings' || path === '/api/events/5/venue-bookings') return Promise.resolve({ bookings: [] });
      if (path === '/api/events/5/clarification' && options.method === 'POST') {
        sentRemarks = options.body.remarks;
        return Promise.resolve({
          event: { ...eventData, subState: 'ACTION_REQUIRED', reviewRemarks: sentRemarks },
        });
      }
      return Promise.reject(new Error(`Unhandled api: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={['/app/events/5']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/events/:id" element={<EventDetail />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Wait for event to load
    expect(await screen.findByText('Global AI Summit')).toBeInTheDocument();
    expect(screen.getByText(/coordinator review actions/i)).toBeInTheDocument();

    // Click "Request Clarification / Amendments"
    const reqBtn = screen.getByRole('button', { name: /request clarification \/ amendments/i });
    await user.click(reqBtn);

    // Enter review remarks
    const textarea = screen.getByPlaceholderText(/state incomplete details or amendments needed/i);
    await user.type(textarea, 'Please provide stage layout preference and catering headcount.');

    // Click "Send Clarification Request"
    const sendBtn = screen.getByRole('button', { name: /send clarification request/i });
    await user.click(sendBtn);

    await waitFor(() => {
      expect(sentRemarks).toBe('Please provide stage layout preference and catering headcount.');
    });
  });

  /*
   * AC:       AC3 & AC4 (UI: Organiser Action Required & Respond)
   * Scenario: Organiser opens event page in ACTION_REQUIRED sub-state and submits response
   * Setup:    Event subState is ACTION_REQUIRED
   * Expected: Organiser sees attention card, review remarks, edit link, and submits response
   * Type:     normal
   */
  it('US16-UI02 (AC3+AC4): displays attention card to organizer when ACTION_REQUIRED and allows submitting response', async () => {
    const user = userEvent.setup();
    let sentResponse = null;

    useAuth.mockReturnValue({
      user: organiserUser,
      hasRole: (...roles) => roles.some((r) => organiserUser.roles.includes(r)),
    });

    const eventNeedingAttention = {
      id: 5,
      name: 'Global AI Summit',
      purpose: 'Tech showcase',
      description: 'Annual gathering',
      status: 'UNDER_REVIEW',
      subState: 'ACTION_REQUIRED',
      reviewRemarks: 'Please clarify attendance numbers and seating layout.',
      coordinatorId: 10,
      organiserId: 20,
      organisationName: 'Acme Corp',
      coordinatorName: 'Chloe Lim',
      organiserName: 'Aisha Rahman',
    };

    api.mockImplementation((path, options = {}) => {
      if (path === '/api/auth/me') return Promise.resolve({ user: organiserUser });
      if (path === '/api/events/5') return Promise.resolve({ event: eventNeedingAttention });
      if (path === '/api/events/5/history') return Promise.resolve({ history: [] });
      if (path === '/api/comments/5') return Promise.resolve({ comments: [] });
      if (path === '/api/venues') return Promise.resolve({ venues: [] });
      if (path === '/api/venues/bookings' || path === '/api/events/5/venue-bookings') return Promise.resolve({ bookings: [] });
      if (path === '/api/events/5/clarification/respond' && options.method === 'POST') {
        sentResponse = options.body.response;
        return Promise.resolve({
          event: { ...eventNeedingAttention, subState: 'CLARIFICATION_PROVIDED', clarificationResponse: sentResponse },
        });
      }
      return Promise.reject(new Error(`Unhandled api: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={['/app/events/5']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/events/:id" element={<EventDetail />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Verify organizer sees the Action Required attention card
    expect(await screen.findByText(/action required: clarification requested/i)).toBeInTheDocument();
    expect(screen.getByText('Please clarify attendance numbers and seating layout.')).toBeInTheDocument();

    // Verify option to edit & amend details is present
    expect(screen.getByRole('link', { name: /edit & amend details/i })).toHaveAttribute(
      'href',
      '/app/events/5/edit'
    );

    // Click "Send Clarification Response"
    const openFormBtn = screen.getByRole('button', { name: /send clarification response/i });
    await user.click(openFormBtn);

    // Type response notes
    const responseInput = screen.getByPlaceholderText(/describe the changes made or answer/i);
    await user.type(responseInput, 'Attendance adjusted to 150 with banquet layout.');

    // Submit response
    const submitBtn = screen.getByRole('button', { name: /submit response/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(sentResponse).toBe('Attendance adjusted to 150 with banquet layout.');
    });
  });

  /*
   * AC:       AC5 (UI: Clarification Provided card & Coordinator View)
   * Scenario: Event subState is CLARIFICATION_PROVIDED
   * Setup:    Organiser and Coordinator view event page after clarification submitted
   * Expected: Displays Clarification Provided card to organiser and response text to coordinator
   * Type:     normal
   */
  it('US16-UI03 (AC5): displays Clarification Provided banner and shows response notes to coordinator', async () => {
    useAuth.mockReturnValue({
      user: organiserUser,
      hasRole: (...roles) => roles.some((r) => organiserUser.roles.includes(r)),
    });

    const eventClarified = {
      id: 5,
      name: 'Global AI Summit',
      status: 'UNDER_REVIEW',
      subState: 'CLARIFICATION_PROVIDED',
      reviewRemarks: 'Please clarify attendance numbers.',
      clarificationResponse: 'Attendance adjusted to 150 banquet style.',
      coordinatorId: 10,
      organiserId: 20,
    };

    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve({ user: organiserUser });
      if (path === '/api/events/5') return Promise.resolve({ event: eventClarified });
      if (path === '/api/events/5/history') return Promise.resolve({ history: [] });
      if (path === '/api/comments/5') return Promise.resolve({ comments: [] });
      if (path === '/api/venues') return Promise.resolve({ venues: [] });
      if (path === '/api/events/5/venue-bookings') return Promise.resolve({ bookings: [] });
      if (path === '/api/events/5/equipment-requests') return Promise.resolve({ requests: [] });
      throw new Error(`Unhandled api: ${path}`);
    });

    render(
      <MemoryRouter initialEntries={['/app/events/5']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/events/:id" element={<EventDetail />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('Clarification Provided')).toBeInTheDocument();
    expect(screen.getByText(/attendance adjusted to 150 banquet style/i)).toBeInTheDocument();
  });

  /*
   * AC:       AC5 (UI: clarification history)
   * Scenario: Coordinator opens an event that has had two clarification rounds
   * Setup:    Status history includes every request and response note, newest first
   * Expected: Status history and the coordinator panel show all four notes, not only the latest
   * Type:     normal
   */
  it('US16-UI04 (AC5): coordinator sees every clarification request and response in history', async () => {
    useAuth.mockReturnValue({
      user: coordinatorUser,
      hasRole: (...roles) => roles.some((r) => coordinatorUser.roles.includes(r)),
    });

    const eventClarified = {
      id: 5,
      name: 'Global AI Summit',
      status: 'UNDER_REVIEW',
      subState: 'CLARIFICATION_PROVIDED',
      reviewRemarks: 'Round 2 Question',
      clarificationResponse: 'Round 2 Answer',
      coordinatorId: 10,
      organiserId: 20,
    };

    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve({ user: coordinatorUser });
      if (path === '/api/events/5') return Promise.resolve({ event: eventClarified });
      if (path === '/api/events/5/history') {
        return Promise.resolve({
          history: [
            { id: 4, from_status: 'UNDER_REVIEW', to_status: 'UNDER_REVIEW', actor_name: 'Aisha Rahman', note: 'Clarification responded: Round 2 Answer' },
            { id: 3, from_status: 'UNDER_REVIEW', to_status: 'UNDER_REVIEW', actor_name: 'Chloe Lim', note: 'Clarification requested: Round 2 Question' },
            { id: 2, from_status: 'UNDER_REVIEW', to_status: 'UNDER_REVIEW', actor_name: 'Aisha Rahman', note: 'Clarification responded: Round 1 Answer' },
            { id: 1, from_status: 'UNDER_REVIEW', to_status: 'UNDER_REVIEW', actor_name: 'Chloe Lim', note: 'Clarification requested: Round 1 Question' },
          ],
        });
      }
      if (path === '/api/comments/5') return Promise.resolve({ comments: [] });
      if (path === '/api/venues') return Promise.resolve({ venues: [] });
      if (path === '/api/events/5/venue-bookings') return Promise.resolve({ bookings: [] });
      if (path === '/api/events/5/equipment-requests') return Promise.resolve({ requests: [] });
      throw new Error(`Unhandled api: ${path}`);
    });

    render(
      <MemoryRouter initialEntries={['/app/events/5']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/events/:id" element={<EventDetail />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('Global AI Summit')).toBeInTheDocument();
    expect(screen.getByText('Clarification history')).toBeInTheDocument();
    expect(screen.getAllByText(/Clarification requested: Round 1 Question/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Clarification responded: Round 1 Answer/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Clarification requested: Round 2 Question/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Clarification responded: Round 2 Answer/).length).toBeGreaterThan(0);
  });
});

describe('EventDetail SCRUM-17 & Base tests', () => {

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user: { id: 1 }, hasRole: (...roles) => roles.includes('EVENT_ORGANISER') });
});

/*
 * AC:       SCRUM-26 AC8 (display of one existing request only); SCRUM-39 AC1 + AC2 (role
 *           access to planning data, including the event's equipment requests)
 * Scenario: The event's own Organiser opens a Planning event.
 * Setup:    Organiser user 1; event 3 owned by user 1; one APPROVED booking at "Hall"; no
 *           equipment requests. Any other path fails, as the API would refuse it.
 * Expected: The event and its booking ("Hall: APPROVED") are shown, and the page never asks
 *           for the global bookings queue, which Organisers aren't allowed to see.
 * Type:     normal
 */
it('loads an organiser event and its booking without requesting the restricted global queue', async () => {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') return { event: { id: 3, organiserId: 1, name: 'My event', status: 'PLANNING' } };
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [{ id: 7, venue_name: 'Hall', status: 'APPROVED' }] };
    // SCRUM-39: the page now also loads the event's equipment requests for planning roles.
    if (path === '/api/events/3/equipment-requests') return { requests: [] };
    throw new Error('You do not have access to this action');
  });
  render(
    <MemoryRouter initialEntries={['/app/events/3']}>
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
  expect(await screen.findByText('My event')).toBeInTheDocument();
  expect(screen.getByText('Hall')).toBeInTheDocument();
  expect(screen.getByText('Approved')).toBeInTheDocument();
  expect(api).not.toHaveBeenCalledWith('/api/venues/bookings');
});
/*
 * AC:       Not directly covered by SCRUM-26 (event-specific booking-page navigation)
 * Scenario: An assigned Event Coordinator opens venue booking for an eligible event.
 * Setup:    The event is Approved or Planning and the application route is protected
 *           for Event Coordinators.
 * Expected: Selecting "Book a venue" opens the event-specific booking page, showing the
 *           event title and a link back to its details.
 * Type:     normal
 */
/* 
  This integration test verifies that an assigned Event Coordinator can open the
  venue booking page directly from the Event Details page when an event is in 
  either the APPROVED or PLANNING state.
*/
// Exercise the same protected nested route and layout used by the application.
it.each(['APPROVED', 'PLANNING'])(
  'opens the event-specific booking page from an assigned coordinator %s event',
  async (status) => {
  const user = userEvent.setup();
  useAuth.mockReturnValue({
    user: { id: 2, fullName: 'Event Coordinator', roles: ['EVENT_COORDINATOR'] },
    hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
    logout: jest.fn(),
  });
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') {
      return {
        event: {
          id: 3,
          coordinatorId: 2,
          name: 'Course Withdrawal Conference',
          category: 'SEMINAR',
          status,
          startAt: '2026-11-10T10:00:00.000Z',
          endAt: '2026-11-10T12:00:00.000Z',
          expectedAttendance: 100,
          venueRequirements: 'Air con',
          accessibilityNeeds: 'None',
        },
      };
    }
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [] };
    throw new Error(`Unexpected ${path}`);
  });
  render(
    <MemoryRouter initialEntries={['/app/events/3']}>
      <Routes>
        <Route path="/app" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="events/:id/venue-booking" element={<ProtectedRoute allowedRoles={['EVENT_COORDINATOR']}><VenueBooking /></ProtectedRoute>} />
          <Route path="events/:id" element={<EventDetail />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

  await user.click(await screen.findByRole('link', { name: 'Book a venue' }));
  expect(await screen.findByText('Book a venue for this event')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Course Withdrawal Conference' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '‹ Back to event' })).toHaveAttribute('href', '/app/events/3');
  }
);

/*
 * SCRUM-17 page-level tests (US17-F12 to US17-F16).
 * The panel itself is covered in EventDecisionPanel.test.jsx; these check that the
 * event page shows it to the right person and wires it to the right API endpoint.
 */

// Fakes the API for event 3, owned by organiser 1 and assigned to `coordinatorId`.
// By default it's under review; `decisionError` makes the decision endpoint fail.
function mockEvent({ coordinatorId, status = 'UNDER_REVIEW', rejectionReason = null, decisionError = null }) {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') {
      return { event: { id: 3, organiserId: 1, coordinatorId, name: 'Review me', status, rejectionReason } };
    }
    if (path === '/api/events/3/decision') {
      if (decisionError) throw new Error(decisionError);
      return { event: {} };
    }
    if (path === '/api/events/3/review') return { event: {} };
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [] };
    throw new Error(`Unexpected ${path}`);
  });
}

function renderEvent() {
  render(
    <MemoryRouter initialEntries={['/app/events/3']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
}

// AC1 + AC2 · Happy path: the assigned coordinator (id 2) rejects with a valid reason, and
// the page sends it to POST /api/events/3/decision with the right body.
it('US17-F12: the assigned coordinator rejects through the decision endpoint', async () => {
  useAuth.mockReturnValue({ user: { id: 2 }, hasRole: (...roles) => roles.includes('EVENT_COORDINATOR') });
  mockEvent({ coordinatorId: 2 });
  renderEvent();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Reject' }));
  await user.type(screen.getByLabelText('Rejection reason'), 'Attendance numbers are missing');
  await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
  expect(api).toHaveBeenCalledWith('/api/events/3/decision', {
    method: 'POST',
    body: { decision: 'REJECT', reason: 'Attendance numbers are missing' },
  });
});

// Security (UI): the organiser (id 1, the default user in beforeEach) can view their
// own event under review but must not see the decision buttons.
it('US17-F13: the organiser does not see approve or reject buttons', async () => {
  mockEvent({ coordinatorId: 2 });
  renderEvent();
  expect(await screen.findByText('Review me')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
});

// Security (UI): a coordinator who isn't assigned (id 9) can view the event for planning
// but doesn't get the decision buttons. The backend blocks this too (US17-B09).
it('US17-F14: a coordinator who is not assigned does not see approve or reject buttons', async () => {
  useAuth.mockReturnValue({ user: { id: 9 }, hasRole: (...roles) => roles.includes('EVENT_COORDINATOR') });
  mockEvent({ coordinatorId: 2 });
  renderEvent();
  expect(await screen.findByText('Review me')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
});

// AC5 · Negative (UI): a Draft request cannot be decided, so even the assigned coordinator
// gets no decision buttons; the general coordinator note box is shown instead.
it('US17-F17: the assigned coordinator does not see approve or reject buttons on a draft', async () => {
  useAuth.mockReturnValue({ user: { id: 2 }, hasRole: (...roles) => roles.includes('EVENT_COORDINATOR') });
  mockEvent({ coordinatorId: 2, status: 'DRAFT' });
  renderEvent();
  expect(await screen.findByText('Coordinator actions')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  expect(screen.getByText('Reason / note')).toBeInTheDocument();
});

// Error handling: if the server refuses the decision (e.g. someone already decided, so the
// event is no longer under review), the coordinator sees the server's message on the page.
it('US17-F15: a decision refused by the server shows the error to the coordinator', async () => {
  useAuth.mockReturnValue({ user: { id: 2 }, hasRole: (...roles) => roles.includes('EVENT_COORDINATOR') });
  mockEvent({ coordinatorId: 2, decisionError: 'Only event requests under review can be approved or rejected' });
  renderEvent();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Approve' }));
  expect(await screen.findByText('Only event requests under review can be approved or rejected')).toBeInTheDocument();
});

// C1 + C2 · The organiser can see why their request was rejected, so they know what to
// fix before resubmitting (Customer Briefing, Step 5: keep a record of the decision).
it('US17-F16: the organiser sees the rejection reason on a rejected event', async () => {
  mockEvent({ coordinatorId: 2, status: 'REJECTED', rejectionReason: 'Attendance numbers are missing' });
  renderEvent();
  expect(await screen.findByText('Attendance numbers are missing')).toBeInTheDocument();
  expect(screen.getByText('Rejection reason:')).toBeInTheDocument();
});

/*
 * SCRUM-64: a Submitted request has no reviewable status until its assigned
 * coordinator opens it. These check the button appears only for that coordinator
 * and wires to the right endpoint.
 */

// AC1 + AC6 · The assigned coordinator sees an "Open for review" button on a
// Submitted request, and it calls the review endpoint.
it('US64-F01: the assigned coordinator opens a submitted request for review', async () => {
  useAuth.mockReturnValue({ user: { id: 2 }, hasRole: (...roles) => roles.includes('EVENT_COORDINATOR') });
  mockEvent({ coordinatorId: 2, status: 'SUBMITTED' });
  renderEvent();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Open for review' }));
  expect(api).toHaveBeenCalledWith('/api/events/3/review', { method: 'POST' });
});

// AC3 · A coordinator who isn't assigned to this request (id 9) never sees the button,
// even though they can still view the event for planning purposes.
it('US64-F02: an unrelated coordinator does not see the Open for review button', async () => {
  useAuth.mockReturnValue({ user: { id: 9 }, hasRole: (...roles) => roles.includes('EVENT_COORDINATOR') });
  mockEvent({ coordinatorId: 2, status: 'SUBMITTED' });
  renderEvent();
  expect(await screen.findByText('Review me')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Open for review' })).not.toBeInTheDocument();
});

// AC6 · The organiser never sees the coordinator-only button on their own request.
it('US64-F03: the organiser does not see the Open for review button', async () => {
  mockEvent({ coordinatorId: 2, status: 'SUBMITTED' });
  renderEvent();
  expect(await screen.findByText('Review me')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Open for review' })).not.toBeInTheDocument();
});

/*
 * AC:       Not applicable to SCRUM-25/26 (public attendee event visibility); SCRUM-39 AC1
 *           (agreed decision: Attendees keep the public view, so equipment requests are
 *           never requested either)
 * Scenario: An attendee requests an event that has venue booking information.
 * Setup:    The attendee can access only a confirmed public event and is not a
 *           Coordinator or Venue Staff member.
 * Expected: The event page shows its public event and registration information, hides
 *           staff-only panels, and does not request comments, event status history or
 *           equipment requests.
 * Type:     boundary
 */
it('loads an attendee event without requesting restricted planning data', async () => {
  useAuth.mockReturnValue({ user: { id: 8 }, hasRole: (...roles) => roles.includes('ATTENDEE') });
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') return { event: { id: 3, name: 'Public event', status: 'CONFIRMED' } };
    if (path === '/api/events/3/venue-bookings') return { bookings: [] };
    throw new Error('Forbidden planning information');
  });
  render(
    <MemoryRouter initialEntries={['/app/events/3']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
  expect(await screen.findByText('Public event')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();
  expect(screen.queryByText('Discussion')).not.toBeInTheDocument();
  expect(screen.queryByText('Status history')).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalledWith('/api/comments/3');
  expect(api).not.toHaveBeenCalledWith('/api/events/3/history');
  // SCRUM-39: attendees don't get planning details, so equipment is never requested.
  expect(api).not.toHaveBeenCalledWith('/api/events/3/equipment-requests');
});
});

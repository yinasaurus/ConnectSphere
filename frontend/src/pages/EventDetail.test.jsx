import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../auth';
import { api } from '../api';
import EventDetail from './EventDetail';

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
      if (path === '/api/venues/bookings') return Promise.resolve({ bookings: [] });
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
      if (path === '/api/venues/bookings') return Promise.resolve({ bookings: [] });
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
});

describe('EventDetail SCRUM-17 & Base tests', () => {

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user: { id: 1 }, hasRole: (...roles) => roles.includes('EVENT_ORGANISER') });
});

it('loads an organiser event and its booking without requesting the restricted global queue', async () => {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') return { event: { id: 3, organiserId: 1, name: 'My event', status: 'PLANNING' } };
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [{ id: 7, venue_name: 'Hall', status: 'APPROVED' }] };
    throw new Error('You do not have access to this action');
  });
  render(
    <MemoryRouter initialEntries={['/app/events/3']}>
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
  expect(await screen.findByText('My event')).toBeInTheDocument();
  expect(screen.getByText('Hall: APPROVED')).toBeInTheDocument();
  expect(api).not.toHaveBeenCalledWith('/api/venues/bookings');
});

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
});
});

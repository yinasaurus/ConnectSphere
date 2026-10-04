import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from './EventDetail';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({
  useAuth: jest.fn(),
}));

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

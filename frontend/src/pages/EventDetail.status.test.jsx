/**
 * SCRUM-5: the assigned coordinator's buttons follow the lifecycle one step at a time.
 *   Under Review           -> "Approve" (APPROVED, AC2) / "Reject / return" (REJECTED + reason, AC4)
 *   Approved               -> "Start planning" (PLANNING, AC3)
 *   Planning               -> "Send to safety check" (AWAITING_SAFETY_CHECK, AC6)
 *   Awaiting Safety Check  -> no coordinator button; only the Safety Officer can start preparation (AC7)
 *   Preparation            -> "Confirm event" (CONFIRMED)
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from './EventDetail';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const STEP_BUTTONS = ['Approve', 'Reject / return', 'Start planning', 'Send to safety check', 'Confirm event'];

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

async function renderAsCoordinator() {
  useAuth.mockReturnValue({ user: { id: 2 }, hasRole: (...roles) => roles.includes('EVENT_COORDINATOR') });
  render(
    <MemoryRouter initialEntries={['/app/events/3']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
  await screen.findByText('Coordinator actions');
  return userEvent.setup();
}

function visibleStepButtons() {
  return STEP_BUTTONS.filter((name) => screen.queryByRole('button', { name }));
}

beforeEach(() => jest.clearAllMocks());

// AC2 / AC3 / AC6 / SCRUM-73 · each status offers exactly its next step, which sends that status.
it.each([
  ['UNDER_REVIEW', 'Approve', 'APPROVED'],
  ['APPROVED', 'Start planning', 'PLANNING'],
  ['PLANNING', 'Send to safety check', 'AWAITING_SAFETY_CHECK'],
  ['PREPARATION', 'Confirm event', 'CONFIRMED'],
])('US5-F02: %s offers "%s", which sends %s', async (status, button, next) => {
  mockEvent(status);
  const user = await renderAsCoordinator();
  await user.click(screen.getByRole('button', { name: button }));
  expect(api).toHaveBeenCalledWith('/api/events/3/status', { method: 'POST', body: { status: next } });
  expect(visibleStepButtons().filter((name) => name !== 'Reject / return')).toEqual([button]);
});

// AC4 · Rejecting sends the reason the coordinator typed, not a made-up default.
it('US5-F03: "Reject / return" sends the typed reason', async () => {
  mockEvent('UNDER_REVIEW');
  const user = await renderAsCoordinator();
  // The first text box is the coordinator's "Reason / note"; the second is the discussion box.
  await user.type(screen.getAllByRole('textbox')[0], 'Budget not approved');
  await user.click(screen.getByRole('button', { name: 'Reject / return' }));
  expect(api).toHaveBeenCalledWith('/api/events/3/status', {
    method: 'POST', body: { status: 'REJECTED', reason: 'Budget not approved' },
  });
});

// AC5 · If someone else changes the status, the open event page shows it within 10 seconds,
// along with the buttons for the new status.
it('US5-F08: the event page picks up a status change on the next 10-second refresh', async () => {
  jest.useFakeTimers();
  mockEvent('UNDER_REVIEW');
  await renderAsCoordinator();
  expect(screen.getByText('Under Review')).toBeInTheDocument();

  mockEvent('APPROVED');
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(await screen.findByText('Approved')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start planning' })).toBeInTheDocument();
  jest.useRealTimers();
});

// AC7 · While awaiting the safety check the coordinator has no button to move the event on.
it('US5-F05: AWAITING_SAFETY_CHECK offers the coordinator no step button', async () => {
  mockEvent('AWAITING_SAFETY_CHECK');
  await renderAsCoordinator();
  expect(visibleStepButtons()).toEqual([]);
});

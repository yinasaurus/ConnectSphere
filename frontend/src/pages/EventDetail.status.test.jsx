/**
 * SCRUM-5: the assigned coordinator's buttons follow the lifecycle one step at a time.
 *   Under Review           -> "Approve" (APPROVED, AC2) / "Reject / return" (REJECTED + reason, AC4)
 *   Approved               -> "Start planning" (PLANNING, AC3)
 *   Planning               -> "Send to safety check" (AWAITING_SAFETY_CHECK, AC6)
 *   Awaiting Safety Check  -> no coordinator button; only the Safety Officer can start preparation (AC7)
 *   Preparation            -> "Confirm event" (CONFIRMED)
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from './EventDetail';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const STEP_BUTTONS = ['Approve', 'Reject / return', 'Start planning', 'Send to safety check', 'Confirm event'];

const APPROVED_BOOKING = { id: 7, venue_name: 'Hall', status: 'APPROVED' };

// Fakes the API for event 3, assigned to coordinator 2, in the given status, with the given
// venue bookings. statusError makes the status change fail, as the backend would.
function mockEvent(status, bookings = [], statusError = null) {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') return { event: { id: 3, coordinatorId: 2, name: 'Status event', status } };
    if (path === '/api/events/3/status') {
      if (statusError) throw new Error(statusError);
      return { event: {} };
    }
    if (path === '/api/events/3/decision') return { event: {} };
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings };
    throw new Error(`Unexpected ${path}`);
  });
}

function coordinatorCard() {
  return screen.getByText('Coordinator actions').closest('.card');
}

async function renderAsCoordinator() {
  useAuth.mockReturnValue({ user: { id: 2 }, hasRole: (...roles) => roles.includes('EVENT_COORDINATOR') });
  render(
    <MemoryRouter initialEntries={['/app/events/3']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
  // Waiting on the event name rather than the header text, since the header reads
  // "Coordinator review actions" under Under Review and "Coordinator actions" otherwise.
  await screen.findByText('Status event');
  return userEvent.setup();
}

function visibleStepButtons() {
  return STEP_BUTTONS.filter((name) => screen.queryByRole('button', { name }));
}

beforeEach(() => jest.clearAllMocks());
// Safety net: if a fake-timer test fails before reaching its own cleanup, real timers
// must still be restored so later tests' async waitFor/findBy calls don't hang.
afterEach(() => jest.useRealTimers());

// AC3 / AC6 / SCRUM-73 · each status (other than Under Review, which goes through the
// Approve/Reject decision panel — see below) offers exactly its next step, which sends
// that status. Planning has an approved booking, because the safety check button waits
// for one (US5-F09).
it.each([
  ['APPROVED', 'Start planning', 'PLANNING', []],
  ['PLANNING', 'Send to safety check', 'AWAITING_SAFETY_CHECK', [APPROVED_BOOKING]],
  ['PREPARATION', 'Confirm event', 'CONFIRMED', []],
])('US5-F02: %s offers "%s", which sends %s', async (status, button, next, bookings) => {
  mockEvent(status, bookings);
  const user = await renderAsCoordinator();
  await user.click(screen.getByRole('button', { name: button }));
  expect(api).toHaveBeenCalledWith('/api/events/3/status', { method: 'POST', body: { status: next } });
  expect(visibleStepButtons()).toEqual([button]);
});

// AC2 · Under Review offers Approve through the existing decision panel (SCRUM-17),
// sending APPROVED via the decision endpoint rather than the generic status one.
it('US5-F02b: UNDER_REVIEW offers "Approve", which sends APPROVED via the decision endpoint', async () => {
  mockEvent('UNDER_REVIEW');
  const user = await renderAsCoordinator();
  await user.click(screen.getByRole('button', { name: 'Approve' }));
  expect(api).toHaveBeenCalledWith('/api/events/3/decision', {
    method: 'POST', body: { decision: 'APPROVE', reason: '' },
  });
});

// AC4 · Rejecting from Under Review sends the typed reason via the decision panel's
// two-step confirm flow (SCRUM-17), not a single "Reject / return" button.
it('US5-F03: rejecting from Under Review sends the typed reason', async () => {
  mockEvent('UNDER_REVIEW');
  const user = await renderAsCoordinator();
  await user.click(screen.getByRole('button', { name: 'Reject' }));
  await user.type(screen.getByLabelText('Rejection reason'), 'Budget not approved');
  await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
  expect(api).toHaveBeenCalledWith('/api/events/3/decision', {
    method: 'POST', body: { decision: 'REJECT', reason: 'Budget not approved' },
  });
});

// AC5 · If someone else changes the status, the open event page shows it within 10 seconds,
// along with the buttons for the new status.
it('US5-F08: the event page picks up a status change on the next 10-second refresh', async () => {
  jest.useFakeTimers();
  mockEvent('UNDER_REVIEW');
  await renderAsCoordinator();
  // "Under Review" also appears in the review-phase panel (SCRUM-16), so expect at least one.
  expect(screen.getAllByText('Under Review').length).toBeGreaterThan(0);

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

/*
 * AC:       SCRUM-5 AC6
 * Scenario: The coordinator is planning but hasn't requested a venue yet.
 * Setup:    Event in PLANNING with no venue bookings.
 * Expected: "Send to safety check" is disabled, a hint says to request a venue first, and
 *           clicking it sends no status change.
 * Type:     error
 */
it('US5-F09: "Send to safety check" is disabled until a venue is requested', async () => {
  mockEvent('PLANNING', []);
  const user = await renderAsCoordinator();
  const button = screen.getByRole('button', { name: 'Send to safety check' });
  expect(button).toBeDisabled();
  expect(screen.getByText(/Request a venue first/)).toBeInTheDocument();
  await user.click(button);
  expect(api).not.toHaveBeenCalledWith('/api/events/3/status', expect.anything());
});

/*
 * AC:       SCRUM-5 AC6
 * Scenario: A venue booking was sent but Venue Staff haven't approved it yet; an earlier
 *           booking was rejected.
 * Setup:    Event in PLANNING with one PENDING and one REJECTED booking.
 * Expected: The button stays disabled and the hint counts only the 1 pending booking,
 *           because a rejected booking is no longer part of the event's arrangements.
 * Type:     edge
 */
it('US5-F10: "Send to safety check" stays disabled while a booking is pending', async () => {
  mockEvent('PLANNING', [
    { id: 7, venue_name: 'Hall', status: 'PENDING' },
    { id: 8, venue_name: 'Studio', status: 'REJECTED' },
  ]);
  await renderAsCoordinator();
  expect(screen.getByRole('button', { name: 'Send to safety check' })).toBeDisabled();
  expect(screen.getByText('Waiting for venue approval: 1 booking pending.')).toBeInTheDocument();
});

/*
 * AC:       SCRUM-5 AC6
 * Scenario: Venue Staff approved the booking; an earlier booking had been rejected.
 * Setup:    Event in PLANNING with one APPROVED and one REJECTED booking.
 * Expected: The button is enabled with no hint, since the rejected booking doesn't count.
 * Type:     happy
 */
it('US5-F11: "Send to safety check" is enabled once every active booking is approved', async () => {
  mockEvent('PLANNING', [APPROVED_BOOKING, { id: 8, venue_name: 'Studio', status: 'REJECTED' }]);
  await renderAsCoordinator();
  expect(screen.getByRole('button', { name: 'Send to safety check' })).toBeEnabled();
  expect(screen.queryByText(/Request a venue first|Waiting for venue approval/)).not.toBeInTheDocument();
});

/*
 * AC:       SCRUM-5 AC6
 * Scenario: The venue is approved but equipment isn't reserved, so the backend refuses the
 *           safety check. The page can't see equipment, so only the backend catches this.
 * Setup:    Event in PLANNING with an approved booking; the status call fails with the
 *           backend's NOT_READY_FOR_SAFETY_CHECK message.
 * Expected: The message appears inside the Coordinator actions card, next to the button,
 *           instead of only at the top of the page where the coordinator wouldn't see it.
 * Type:     error
 */
it('US5-F12: a refused status change is shown inside the Coordinator actions card', async () => {
  const refusal = 'Every venue booking must be approved and all requested equipment reserved before the safety check';
  mockEvent('PLANNING', [APPROVED_BOOKING], refusal);
  const user = await renderAsCoordinator();
  await user.click(screen.getByRole('button', { name: 'Send to safety check' }));
  expect(await within(coordinatorCard()).findByRole('alert')).toHaveTextContent(refusal);
});

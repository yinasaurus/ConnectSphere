/*
 * Purpose: verify the confirmation control remains accessible to the assigned Coordinator.
 * AC: SCRUM-73 AC1 and cross-cutting accessibility — the action has a clear button name and keyboard activation.
 * Inputs: a Preparation event and an authenticated assigned Coordinator.
 * Output: the confirmation action is discoverable by role and invoked by Enter.
 * Failure: fails if the action is inaccessible or does not submit confirmation.
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
 * Purpose: render the event page using the same accessible route as the application.
 * AC: SCRUM-73 AC1 — expose the confirmation action only to its assigned Coordinator.
 * Inputs: event id 3, in Preparation and assigned to user 2.
 * Output: a rendered EventDetail page with the confirmation control.
 * Failure: unexpected API calls fail the test with their path.
 */
function renderConfirmationPage() {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') {
      return { event: { id: 3, name: 'Workshop', coordinatorId: 2, status: 'PREPARATION' } };
    }
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [] };
    if (path === '/api/events/3/status') return { event: { status: 'CONFIRMED' } };
    throw new Error(`Unexpected API path: ${path}`);
  });
  useAuth.mockReturnValue({
    user: { id: 2, roles: ['EVENT_COORDINATOR'] },
    hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
  });
  render(
    <MemoryRouter initialEntries={['/app/events/3']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/app/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

/*
 * Purpose: prove that confirmation is discoverable and operable without a pointer.
 * AC: SCRUM-73 AC1 and accessibility expectation — the button has a meaningful accessible name.
 * Inputs: an assigned Coordinator focuses the named button and presses Enter.
 * Output: the confirmation request is submitted once.
 * Failure: fails if the control is unnamed, not keyboard operable, or does not submit.
 */
it('exposes a keyboard-operable Confirm event button with an accessible name', async () => {
  api.mockReset();
  renderConfirmationPage();
  const user = userEvent.setup();

  const button = await screen.findByRole('button', { name: 'Confirm event' });
  button.focus();
  await user.keyboard('{Enter}');

  expect(api).toHaveBeenCalledWith('/api/events/3/status', {
    method: 'POST',
    body: { status: 'CONFIRMED' },
  });
});

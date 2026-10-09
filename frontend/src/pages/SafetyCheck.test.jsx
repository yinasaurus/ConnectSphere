import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../api';
import SafetyCheck from './SafetyCheck';

jest.mock('../api', () => ({ api: jest.fn() }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/events/3/safety-check']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/app/events/:id/safety-check" element={<SafetyCheck />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SCRUM-54 safety check page', () => {
  beforeEach(() => {
    api.mockReset();
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: A Safety Officer opens a safety check and records an outcome.
   * Setup: GET returns event 3; POST echoes the outcome.
   * Expected: The form submits POST /api/events/3/safety-check with the outcome.
   * Type: normal
   */
  it('lets a Safety Officer record a safety-check outcome', async () => {
    api.mockImplementation(async (path, options = {}) => {
      if (path === '/api/events/3/safety-check' && options.method === 'POST') {
        return { safetyCheck: { eventId: 3, outcome: 'Site cleared' } };
      }
      return { safetyCheck: { eventId: 3, eventName: 'Helix Conference', outcome: null } };
    });
    renderPage();
    expect(await screen.findByText('Helix Conference')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Outcome'), 'Site cleared');
    await user.click(screen.getByRole('button', { name: 'Record outcome' }));
    expect(api).toHaveBeenCalledWith('/api/events/3/safety-check', {
      method: 'POST',
      body: { outcome: 'Site cleared' },
    });
    expect(await screen.findByText('Safety check outcome recorded.')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC4
   * Scenario: Opening succeeds but recording is refused by the server.
   * Setup: GET returns the check; POST returns 403.
   * Expected: The refusal message is shown; the form remains (they already opened it).
   * Type: error
   */
  it('shows the server refusal when recording an outcome is blocked', async () => {
    api.mockImplementation(async (path, options = {}) => {
      if (options.method === 'POST') {
        const err = new Error('You do not have access to this action');
        err.status = 403;
        throw err;
      }
      return { safetyCheck: { eventId: 3, eventName: 'Helix Conference', outcome: null } };
    });
    renderPage();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Outcome'), 'Site cleared');
    await user.click(screen.getByRole('button', { name: 'Record outcome' }));
    expect(await screen.findByText('You do not have access to this action')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC4, AC7
   * Scenario: A blocked user hits the safety-check page (for example after a stale session).
   * Setup: GET 403 with a message and no safetyCheck body.
   * Expected: The refusal is shown and the event name is not rendered from the error.
   * Type: error
   */
  it('shows the refusal and no extra event details when opening a safety check is blocked', async () => {
    const err = new Error('You do not have access to this action');
    err.status = 403;
    api.mockRejectedValue(err);
    renderPage();
    expect(await screen.findByText('You do not have access to this action')).toBeInTheDocument();
    expect(screen.queryByLabelText('Outcome')).not.toBeInTheDocument();
    expect(screen.queryByText('Helix Conference')).not.toBeInTheDocument();
  });
});

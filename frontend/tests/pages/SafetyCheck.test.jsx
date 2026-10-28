import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../../src/api';
import SafetyCheck from '../../src/pages/SafetyCheck';

jest.mock('../../src/api', () => ({ api: jest.fn() }));

const reviewPayload = {
  eventId: 3,
  eventName: 'Helix Conference',
  expectedAttendance: 120,
  accessibilityNeeds: 'Step-free',
  outcome: null,
  bookings: [{
    id: 7,
    venueName: 'Orchid',
    capacity: 100,
    layouts: ['Theatre'],
    venueAccessibility: 'Lift',
  }],
  equipmentRequests: [{
    id: 21,
    equipmentName: 'Wireless mic',
    quantity: 2,
    status: 'RESERVED',
  }],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/events/3/safety-check']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/app/events/:id/safety-check" element={<SafetyCheck />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SCRUM-55 / SCRUM-56 safety check page', () => {
  beforeEach(() => {
    api.mockReset();
  });

  /*
   * AC:       SCRUM-55 AC2; SCRUM-56 AC1, AC4
   * Scenario: Safety Officer opens the review and approves without a reason.
   * Setup:    GET returns attendance, venue capacity/layouts and equipment.
   * Expected: Those fields are shown; POST sends outcome APPROVE.
   * Type:     normal
   */
  // SCRUM-55-TC15
  it('shows review details and lets a Safety Officer approve', async () => {
    api.mockImplementation(async (path, options = {}) => {
      if (path === '/api/events/3/safety-check' && options.method === 'POST') {
        return { safetyCheck: { eventId: 3, outcome: 'APPROVED' } };
      }
      return { safetyCheck: reviewPayload };
    });
    renderPage();
    expect(await screen.findByText('Helix Conference')).toBeInTheDocument();
    expect(screen.getByText(/Expected attendance/i).parentElement).toHaveTextContent('120');
    expect(screen.getByText(/Capacity 100/)).toBeInTheDocument();
    expect(screen.getByText(/Wireless mic/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Outcome'), 'APPROVE');
    await user.click(screen.getByRole('button', { name: 'Record outcome' }));
    expect(api).toHaveBeenCalledWith('/api/events/3/safety-check', {
      method: 'POST',
      body: { outcome: 'APPROVE', reason: '' },
    });
    expect(await screen.findByText('Safety check outcome recorded.')).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-56 AC2, AC3
   * Scenario: Request changes requires a reason and a selected arrangement.
   * Setup:    GET returns one booking; user chooses request changes.
   * Expected: Submit stays disabled until reason and checkbox are set; POST includes both.
   * Type:     normal
   */
  it('requires reason and an arrangement for request changes', async () => {
    api.mockImplementation(async (path, options = {}) => {
      if (options.method === 'POST') {
        return { safetyCheck: { eventId: 3, outcome: 'REQUEST_CHANGES', reason: 'Move room' } };
      }
      return { safetyCheck: reviewPayload };
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Helix Conference');
    await user.selectOptions(screen.getByLabelText('Outcome'), 'REQUEST_CHANGES');
    expect(screen.getByRole('button', { name: 'Record outcome' })).toBeDisabled();

    await user.type(screen.getByLabelText(/Reason/), 'Move room');
    expect(screen.getByRole('button', { name: 'Record outcome' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /Venue: Orchid/i }));
    await user.click(screen.getByRole('button', { name: 'Record outcome' }));
    expect(api).toHaveBeenCalledWith('/api/events/3/safety-check', {
      method: 'POST',
      body: {
        outcome: 'REQUEST_CHANGES',
        reason: 'Move room',
        affectedArrangements: [{ type: 'VENUE_BOOKING', id: 7 }],
      },
    });
  });

  /*
   * AC:       SCRUM-56 AC5
   * Scenario: Safety Officer clicks Record while the POST is still in flight.
   * Setup:    POST hangs until we resolve it; form is otherwise valid for approve.
   * Expected: Record outcome is disabled for the duration of the request (no double submit).
   * Type:     boundary
   */
  it('disables Record outcome while the save request is in flight', async () => {
    let resolvePost;
    const postPromise = new Promise((resolve) => {
      resolvePost = resolve;
    });
    api.mockImplementation(async (path, options = {}) => {
      if (path === '/api/events/3/safety-check' && options.method === 'POST') {
        return postPromise;
      }
      return { safetyCheck: reviewPayload };
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Helix Conference');
    await user.click(screen.getByRole('button', { name: 'Record outcome' }));
    expect(screen.getByRole('button', { name: 'Record outcome' })).toBeDisabled();
    resolvePost({ safetyCheck: { eventId: 3, outcome: 'APPROVED' } });
    expect(await screen.findByText('Safety check outcome recorded.')).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-55 AC4
   * Scenario: A blocked user hits the safety-check page.
   * Setup:    GET 403 with a message and no safetyCheck body.
   * Expected: The refusal is shown and review fields are not rendered.
   * Type:     error
   */
  // SCRUM-55-TC16
  it('shows the refusal and no extra event details when opening is blocked', async () => {
    const err = new Error('You do not have access to this action');
    err.status = 403;
    api.mockRejectedValue(err);
    renderPage();
    expect(await screen.findByText('You do not have access to this action')).toBeInTheDocument();
    expect(screen.queryByLabelText('Outcome')).not.toBeInTheDocument();
    expect(screen.queryByText('Helix Conference')).not.toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-56 AC5 (refresh after decide)
   * Scenario: Safety Officer reopens the check page after the event left Awaiting.
   * Setup:    GET returns 409 (openSafetyCheck INVALID_STATUS / already decided).
   * Expected: A clear closed-check message and a link back to the queue; no outcome form.
   * Type:     boundary
   */
  it('explains when the safety check is no longer open after a 409', async () => {
    const err = new Error('Only events awaiting a safety check can be opened for safety review');
    err.status = 409;
    api.mockRejectedValue(err);
    renderPage();
    expect(await screen.findByText(/This safety check is no longer open/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to queue' })).toHaveAttribute(
      'href',
      '/app/events/safety-queue'
    );
    expect(screen.queryByLabelText('Outcome')).not.toBeInTheDocument();
  });
});

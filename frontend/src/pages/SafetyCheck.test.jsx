import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../api';
import SafetyCheck from './SafetyCheck';

jest.mock('../api', () => ({ api: jest.fn() }));

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
   * AC:       SCRUM-55 AC4
   * Scenario: A blocked user hits the safety-check page.
   * Setup:    GET 403 with a message and no safetyCheck body.
   * Expected: The refusal is shown and review fields are not rendered.
   * Type:     error
   */
  it('shows the refusal and no extra event details when opening is blocked', async () => {
    const err = new Error('You do not have access to this action');
    err.status = 403;
    api.mockRejectedValue(err);
    renderPage();
    expect(await screen.findByText('You do not have access to this action')).toBeInTheDocument();
    expect(screen.queryByLabelText('Outcome')).not.toBeInTheDocument();
    expect(screen.queryByText('Helix Conference')).not.toBeInTheDocument();
  });
});

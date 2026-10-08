import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../api';
import AssignmentOverview from './AssignmentOverview';

jest.mock('../api', () => ({ api: jest.fn() }));

describe('SCRUM-54 assignment overview page', () => {
  beforeEach(() => {
    api.mockReset();
  });

  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Lead opens the overview when the API omits the assignments key.
   * Setup: Response is `{}` rather than `{ assignments: [] }`.
   * Expected: Empty-state copy, not a crash.
   * Type: boundary
   */
  it('shows an empty state when the overview payload has no assignments list', async () => {
    api.mockResolvedValue({});
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AssignmentOverview />
      </MemoryRouter>
    );
    expect(await screen.findByText('No coordinator assignments yet.')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Lead opens the overview of coordinator assignments.
   * Setup: One assignment for Workshop to Chloe Lim.
   * Expected: Event name and coordinator name are listed.
   * Type: normal
   */
  it('lists coordinator assignments for a Lead', async () => {
    api.mockResolvedValue({
      assignments: [{ eventId: 3, eventName: 'Workshop', coordinatorName: 'Chloe Lim', status: 'UNDER_REVIEW' }],
    });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AssignmentOverview />
      </MemoryRouter>
    );
    expect(await screen.findByText('Workshop')).toBeInTheDocument();
    expect(screen.getByText('Chloe Lim')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC3, AC7
   * Scenario: A blocked request reaches the overview page.
   * Setup: API 403 with a message and no assignments.
   * Expected: The refusal is shown and no assignment rows are rendered.
   * Type: error
   */
  it('shows the refusal and no assignment details when the overview is blocked', async () => {
    const err = new Error('You do not have access to this action');
    err.status = 403;
    api.mockRejectedValue(err);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AssignmentOverview />
      </MemoryRouter>
    );
    expect(await screen.findByText('You do not have access to this action')).toBeInTheDocument();
    expect(screen.queryByText('Chloe Lim')).not.toBeInTheDocument();
  });
});

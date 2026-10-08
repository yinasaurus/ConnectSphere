import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../api';
import UnassignedQueue from './UnassignedQueue';

jest.mock('../api', () => ({ api: jest.fn() }));

describe('SCRUM-54 unassigned queue page', () => {
  beforeEach(() => {
    api.mockReset();
  });

  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Lead opens the unassigned queue and there is one waiting event.
   * Setup: GET /api/events/unassigned-queue returns one event named Waiting.
   * Expected: The event name is listed.
   * Type: normal
   */
  it('lists unassigned events for a Lead', async () => {
    api.mockResolvedValue({ events: [{ id: 9, name: 'Waiting', status: 'SUBMITTED' }] });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UnassignedQueue />
      </MemoryRouter>
    );
    expect(await screen.findByText('Waiting')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC3
   * Scenario: A Lead opens an empty unassigned queue.
   * Setup: API returns no events.
   * Expected: Empty-state copy, not a fabricated event.
   * Type: boundary
   */
  it('shows an empty state when there are no unassigned events', async () => {
    api.mockResolvedValue({ events: [] });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UnassignedQueue />
      </MemoryRouter>
    );
    expect(await screen.findByText('No unassigned events.')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC3, AC7
   * Scenario: A blocked (non-Lead) request reaches the page anyway.
   * Setup: API returns 403 with only a message, no events array.
   * Expected: The message is shown and no event names are rendered.
   * Type: error
   */
  it('shows the refusal and no event details when the queue is blocked', async () => {
    const err = new Error('You do not have access to this action');
    err.status = 403;
    api.mockRejectedValue(err);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UnassignedQueue />
      </MemoryRouter>
    );
    expect(await screen.findByText('You do not have access to this action')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

/**
 * SCRUM-30: the Events list flags a submitted request as Unassigned until a Coordinator is assigned.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Events from './Events';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const organiser = {
  user: { id: 1, fullName: 'Aisha Rahman' },
  hasRole: (...roles) => roles.includes('EVENT_ORGANISER'),
};

function renderEvents(events) {
  api.mockResolvedValue({ events });
  useAuth.mockReturnValue(organiser);
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Events />
    </MemoryRouter>
  );
}

describe('SCRUM-30 Unassigned flag on the events list', () => {
  /*
   * AC: SCRUM-30 AC1, AC2
   * Scenario: The organiser opens Events after submitting a request that has no Coordinator.
   * Setup: One SUBMITTED event, coordinatorId null, returned by GET /api/events.
   * Expected: The event name is on the page and it is flagged Unassigned.
   * Type: normal
   */
  it('US30-F01: a submitted event with no Coordinator shows Unassigned', async () => {
    renderEvents([{
      id: 3,
      name: 'Town Hall',
      status: 'SUBMITTED',
      coordinatorId: null,
      organisationName: 'Acme',
      category: 'MEETING',
      startAt: '2026-10-01T10:00:00Z',
    }]);

    expect(await screen.findByRole('heading', { name: 'Town Hall' })).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-30 AC3
   * Scenario: A Coordinator has been assigned, so the organiser opens Events again.
   * Setup: The same event is now UNDER_REVIEW with coordinatorId 2.
   * Expected: The event is still listed. The Unassigned flag is not shown.
   * Type: normal
   */
  it('US30-F02: an assigned event stays listed and is not flagged Unassigned', async () => {
    renderEvents([{
      id: 3,
      name: 'Town Hall',
      status: 'UNDER_REVIEW',
      coordinatorId: 2,
      organisationName: 'Acme',
      category: 'MEETING',
      startAt: '2026-10-01T10:00:00Z',
    }]);

    expect(await screen.findByRole('heading', { name: 'Town Hall' })).toBeInTheDocument();
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-30 AC1
   * Scenario: The organiser has a draft that was never submitted.
   * Setup: Status DRAFT and coordinatorId null.
   * Expected: The draft is still listed. It is not flagged Unassigned.
   * Type: boundary
   */
  it('US30-F03: a draft is listed but not flagged Unassigned', async () => {
    renderEvents([{
      id: 4,
      name: 'Draft workshop',
      status: 'DRAFT',
      coordinatorId: null,
      organisationName: 'Acme',
      category: 'WORKSHOP',
      startAt: null,
    }]);

    expect(await screen.findByRole('heading', { name: 'Draft workshop' })).toBeInTheDocument();
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
  });
});

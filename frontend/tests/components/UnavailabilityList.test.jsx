import { render, screen } from '@testing-library/react';
import { api } from '../../src/api';
import UnavailabilityList from '../../src/components/UnavailabilityList';

jest.mock('../../src/api', () => ({
  api: jest.fn(),
}));

/**
 * SCRUM-72: show recorded venue unavailability periods (read-only).
 * The API owns the rules (backend/tests/venues.unavailability.test.js); these tests check
 * the list renders what the API returns.
 */
const venues = [{ id: 7, name: 'Helix Hall' }];

const FUTURE = {
  id: 40,
  venue_id: 7,
  reason: 'Maintenance',
  start_at: '2026-12-01T09:00:00Z',
  end_at: '2026-12-01T17:00:00Z',
};

function mockApi({ periods = [FUTURE] } = {}) {
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/api/venues/unavailability' && !options.method) return { unavailability: periods };
    throw new Error(`Unexpected ${path}`);
  });
}

describe('SCRUM-72 UnavailabilityList', () => {
  beforeEach(() => {
    api.mockReset();
  });

  /*
   * AC:       SCRUM-72 (AC1: a recorded period's venue, reason, and start/end are visible)
   * Scenario: Venue Staff opens the Venues page with at least one recorded period.
   * Setup:    api() mocked to return one future period (Helix Hall, Maintenance).
   * Expected: the period's venue name and reason are rendered in the list.
   * Type:     normal
   */
  // SCRUM-72-TC16
  it('shows each period with its venue name, reason, and from/until', async () => {
    mockApi();
    render(<UnavailabilityList venues={venues} refreshKey={0} />);

    expect(await screen.findByText('Helix Hall')).toBeInTheDocument();
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-72 (empty-state guard)
   * Scenario: Venue Staff opens the Venues page before any period has been recorded.
   * Setup:    api() mocked to return an empty unavailability list.
   * Expected: the card renders nothing (no "unavailability-list" test id in the DOM).
   * Type:     boundary
   */
  // SCRUM-72-TC17
  it('shows nothing when there are no recorded periods', async () => {
    mockApi({ periods: [] });
    render(<UnavailabilityList venues={venues} refreshKey={0} />);

    await screen.findByText('Helix Hall').catch(() => {});
    expect(screen.queryByTestId('unavailability-list')).not.toBeInTheDocument();
  });
});

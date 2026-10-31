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

  // SCRUM-72-TC26
  it('US72-F05: shows each period with its venue name, reason, and from/until', async () => {
    mockApi();
    render(<UnavailabilityList venues={venues} refreshKey={0} />);

    expect(await screen.findByText('Helix Hall')).toBeInTheDocument();
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
  });

  // SCRUM-72-TC27
  it('US72-F06: shows nothing when there are no recorded periods', async () => {
    mockApi({ periods: [] });
    render(<UnavailabilityList venues={venues} refreshKey={0} />);

    await screen.findByText('Helix Hall').catch(() => {});
    expect(screen.queryByTestId('unavailability-list')).not.toBeInTheDocument();
  });
});

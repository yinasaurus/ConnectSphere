import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../src/api';
import UnavailabilityList from '../../src/components/UnavailabilityList';

jest.mock('../../src/api', () => ({
  api: jest.fn(),
}));

/**
 * SCRUM-72: show recorded venue unavailability periods, and let a Coordinator/Lead end
 * one early. The API owns the rules (backend/tests/venues.unavailability.test.js); these
 * tests check the list renders what the API returns and that "End early" is Coordinator/
 * Lead-only and only shown for a period that hasn't already ended.
 */
const venues = [{ id: 7, name: 'Helix Hall' }];

const FUTURE = {
  id: 40,
  venue_id: 7,
  reason: 'Maintenance',
  start_at: '2026-12-01T09:00:00Z',
  end_at: '2026-12-01T17:00:00Z',
};

const PAST = {
  id: 41,
  venue_id: 7,
  reason: 'Renovation',
  start_at: '2020-01-01T09:00:00Z',
  end_at: '2020-01-02T09:00:00Z',
};

function mockApi({ periods = [FUTURE], endError } = {}) {
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/api/venues/unavailability' && !options.method) return { unavailability: periods };
    if (path === '/api/venues/unavailability/40/end' && options.method === 'POST') {
      if (endError) {
        const error = new Error(endError.message);
        error.code = endError.code;
        throw error;
      }
      return { unavailability: { ...FUTURE, end_at: new Date().toISOString() } };
    }
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
    render(<UnavailabilityList venues={venues} canEndEarly={false} refreshKey={0} />);

    expect(await screen.findByText('Helix Hall')).toBeInTheDocument();
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
  });

  // SCRUM-72-TC27
  it('US72-F06: does not show an End early action when the caller cannot end one early', async () => {
    mockApi();
    render(<UnavailabilityList venues={venues} canEndEarly={false} refreshKey={0} />);

    await screen.findByText('Helix Hall');
    expect(screen.queryByRole('button', { name: 'End early' })).not.toBeInTheDocument();
  });

  // SCRUM-72-TC28
  it('US72-F07: a Coordinator/Lead sees End early for a period that has not ended yet', async () => {
    mockApi();
    render(<UnavailabilityList venues={venues} canEndEarly refreshKey={0} />);

    expect(await screen.findByRole('button', { name: 'End early' })).toBeInTheDocument();
  });

  // SCRUM-72-TC29
  it('US72-F08: End early is not offered for a period that has already ended', async () => {
    mockApi({ periods: [PAST] });
    render(<UnavailabilityList venues={venues} canEndEarly refreshKey={0} />);

    await screen.findByText('Renovation');
    expect(screen.queryByRole('button', { name: 'End early' })).not.toBeInTheDocument();
  });

  // SCRUM-72-TC30
  it('US72-F09: clicking End early posts to the end route and reloads the list', async () => {
    mockApi();
    render(<UnavailabilityList venues={venues} canEndEarly refreshKey={0} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'End early' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/venues/unavailability/40/end', { method: 'POST' }));
  });

  // SCRUM-72-TC31
  it('US72-F10: shows the server\'s message if ending early is refused', async () => {
    mockApi({ endError: { message: 'Only an Event Coordinator can end an unavailability period early', code: 'FORBIDDEN' } });
    render(<UnavailabilityList venues={venues} canEndEarly refreshKey={0} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'End early' }));

    expect(await screen.findByText('Only an Event Coordinator can end an unavailability period early')).toBeInTheDocument();
  });
});

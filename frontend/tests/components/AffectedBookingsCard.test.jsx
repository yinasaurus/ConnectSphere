import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../src/api';
import AffectedBookingsCard from '../../src/components/AffectedBookingsCard';

jest.mock('../../src/api', () => ({
  api: jest.fn(),
}));

/**
 * SCRUM-60 AC8: Venue Staff view the bookings a recorded unavailability period affects.
 * The API owns the identification rules (backend/tests/venues.affectedBookings.test.js);
 * these tests check the card lets Venue Staff pick a period and shows what comes back.
 */
const venues = [{ id: 7, name: 'Helix Hall' }];

const PERIOD = {
  id: 60,
  venue_id: 7,
  reason: 'Maintenance',
  start_at: '2026-11-10T09:00:00Z',
  end_at: '2026-11-10T17:00:00Z',
};

const AFFECTED_BOOKING = {
  id: 100,
  eventId: 30,
  eventName: 'Tech Symposium',
  venueId: 7,
  type: 'BOOKING',
  status: 'APPROVED',
  startAt: '2026-11-10T10:00:00Z',
  endAt: '2026-11-10T12:00:00Z',
};

function mockApi({ periods = [PERIOD], bookings = [AFFECTED_BOOKING], affectedError } = {}) {
  api.mockImplementation(async (path) => {
    if (path === '/api/venues/unavailability') return { unavailability: periods };
    if (path === '/api/venues/unavailability/60/affected-bookings') {
      if (affectedError) {
        const error = new Error(affectedError.message);
        error.code = affectedError.code;
        throw error;
      }
      return { bookings };
    }
    throw new Error(`Unexpected ${path}`);
  });
}

describe('SCRUM-60 AffectedBookingsCard', () => {
  beforeEach(() => {
    api.mockReset();
  });

  // SCRUM-60-TC18
  it('US60-F01: shows nothing when there are no recorded periods', async () => {
    mockApi({ periods: [] });
    const { container } = render(<AffectedBookingsCard venues={venues} />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('[data-testid="affected-bookings-card"]')).not.toBeInTheDocument();
  });

  // SCRUM-60-TC19
  it('US60-F02: lets Venue Staff pick a recorded period and view its affected bookings', async () => {
    mockApi();
    render(<AffectedBookingsCard venues={venues} />);

    const select = await screen.findByLabelText('Unavailability period');
    await userEvent.selectOptions(select, '60');
    await userEvent.click(screen.getByRole('button', { name: 'View affected bookings' }));

    expect(await screen.findByText('Tech Symposium')).toBeInTheDocument();
    expect(screen.getByText('Helix Hall')).toBeInTheDocument();
  });

  // SCRUM-60-TC20
  it('US60-F03: shows a message when no bookings are affected', async () => {
    mockApi({ bookings: [] });
    render(<AffectedBookingsCard venues={venues} />);

    const select = await screen.findByLabelText('Unavailability period');
    await userEvent.selectOptions(select, '60');
    await userEvent.click(screen.getByRole('button', { name: 'View affected bookings' }));

    expect(await screen.findByText('No bookings are affected by this period.')).toBeInTheDocument();
  });

  // SCRUM-60-TC21
  it('US60-F04: shows the server\'s message when the lookup is refused', async () => {
    mockApi({ affectedError: { message: 'Only venue staff can view affected bookings', code: 'FORBIDDEN' } });
    render(<AffectedBookingsCard venues={venues} />);

    const select = await screen.findByLabelText('Unavailability period');
    await userEvent.selectOptions(select, '60');
    await userEvent.click(screen.getByRole('button', { name: 'View affected bookings' }));

    expect(await screen.findByText('Only venue staff can view affected bookings')).toBeInTheDocument();
  });
});

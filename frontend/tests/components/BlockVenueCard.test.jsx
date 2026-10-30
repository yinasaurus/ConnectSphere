import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../src/api';
import BlockVenueCard from '../../src/components/BlockVenueCard';

jest.mock('../../src/api', () => ({
  api: jest.fn(),
}));

/**
 * SCRUM-72: Venue Staff record a venue unavailability period.
 * The API owns the rules (backend/tests/venues.unavailability.test.js); these tests check
 * the card sends the right request and shows the server's message on errors.
 */
const venues = [{ id: 8, name: 'Hall A' }, { id: 9, name: 'Hall B' }];

function mockApi({ blockError } = {}) {
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/api/venues/unavailability' && options.method === 'POST') {
      if (blockError) {
        const error = new Error(blockError.message);
        error.code = blockError.code;
        throw error;
      }
      return { unavailability: { id: 900, venue_id: 8, reason: options.body.reason } };
    }
    throw new Error(`Unexpected ${path}`);
  });
}

async function fillForm({ reason = 'Maintenance' } = {}) {
  await userEvent.selectOptions(screen.getByLabelText('Venue'), '8');
  await userEvent.type(screen.getByLabelText('Unavailable from'), '2026-11-18T09:00');
  await userEvent.type(screen.getByLabelText('Unavailable until'), '2026-11-18T17:00');
  if (reason !== 'Maintenance') {
    await userEvent.selectOptions(screen.getByLabelText('Reason'), reason);
  }
}

describe('SCRUM-72 BlockVenueCard', () => {
  beforeEach(() => {
    api.mockReset();
  });

  // SCRUM-72-TC13
  it('US72-F01: sends the venue, period and reason (as ISO) to the unavailability route', async () => {
    mockApi();
    const onRecorded = jest.fn();
    render(<BlockVenueCard venues={venues} onRecorded={onRecorded} />);

    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Mark unavailable' }));

    expect(api).toHaveBeenCalledWith('/api/venues/unavailability', {
      method: 'POST',
      body: {
        venueId: 8,
        startAt: new Date('2026-11-18T09:00').toISOString(),
        endAt: new Date('2026-11-18T17:00').toISOString(),
        reason: 'Maintenance',
      },
    });
    expect(await screen.findByText('Venue marked unavailable for this period.')).toBeInTheDocument();
    expect(onRecorded).toHaveBeenCalled();
  });

  // SCRUM-72-TC14
  it('US72-F02: offers every reason the AC names, plus Other with free text', async () => {
    mockApi();
    render(<BlockVenueCard venues={venues} />);

    ['Maintenance', 'Equipment failure', 'Renovation', 'Safety concerns', 'Other'].forEach((option) => {
      expect(screen.getByRole('option', { name: option })).toBeInTheDocument();
    });

    expect(screen.queryByPlaceholderText('Describe the reason')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'Other');
    expect(screen.getByPlaceholderText('Describe the reason')).toBeInTheDocument();
  });

  // SCRUM-72-TC15
  it('US72-F03: sends the typed-in text when Other is chosen', async () => {
    mockApi();
    render(<BlockVenueCard venues={venues} />);

    await fillForm();
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'Other');
    await userEvent.type(screen.getByPlaceholderText('Describe the reason'), 'Pest control');
    await userEvent.click(screen.getByRole('button', { name: 'Mark unavailable' }));

    expect(api).toHaveBeenCalledWith('/api/venues/unavailability', expect.objectContaining({
      body: expect.objectContaining({ reason: 'Pest control' }),
    }));
  });

  // SCRUM-72-TC16
  it('US72-F04: shows the server\'s validation message (e.g. end not after start)', async () => {
    mockApi({ blockError: { message: 'endAt must be after startAt', code: 'VALIDATION_ERROR' } });
    render(<BlockVenueCard venues={venues} />);

    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Mark unavailable' }));

    expect(await screen.findByText('endAt must be after startAt')).toBeInTheDocument();
  });
});

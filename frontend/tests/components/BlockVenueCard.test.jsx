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

    /*
    * AC:       SCRUM-72 (AC1: Venue Staff can record a period with start, end, reason —
    *           through the UI form)
    * Scenario: Venue Staff fills in venue, start and end on the form and submits with the
    *           default reason.
    * Setup:    Form filled via fillForm() (venue 8, start 2026-11-18T09:00, end
    *           2026-11-18T17:00, reason Maintenance).
    * Expected: api() is called with POST to /api/venues/unavailability with venueId, startAt/
    *           endAt converted to ISO, and reason; a success message is shown and onRecorded
    *           fires.
    * Type:     normal
    */
  // SCRUM-72-TC12
  it('sends the venue, period and reason (as ISO) to the unavailability route', async () => {
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

  /*
   * AC:       SCRUM-72 (AC1: reason can be any of the five named examples, plus Other with
   *           free text)
   * Scenario: Venue Staff opens the reason dropdown.
   * Setup:    Card rendered with no interaction yet.
   * Expected: all five reason options are present; the free-text "Describe the reason" field
   *           only appears once "Other" is selected.
   * Type:     normal
   */
  // SCRUM-72-TC13
  it('offers every reason the AC names, plus Other with free text', async () => {
    mockApi();
    render(<BlockVenueCard venues={venues} />);

    ['Maintenance', 'Equipment failure', 'Renovation', 'Safety concerns', 'Other'].forEach((option) => {
      expect(screen.getByRole('option', { name: option })).toBeInTheDocument();
    });

    expect(screen.queryByPlaceholderText('Describe the reason')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'Other');
    expect(screen.getByPlaceholderText('Describe the reason')).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-72 (AC1: reason is free text when Other is picked, not a fixed value)
   * Scenario: Venue Staff picks Other and types a custom reason.
   * Setup:    Form filled, reason set to Other, custom text "Pest control" typed.
   * Expected: api() is called with reason: 'Pest control' in the request body.
   * Type:     normal
   */
  // SCRUM-72-TC14
  it('sends the typed-in text when Other is chosen', async () => {
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

  /*
   * AC:       SCRUM-72 (AC2/AC3: invalid submissions are rejected by the server; the UI
   *           surfaces that message)
   * Scenario: Venue Staff submits a period the server rejects (e.g. end not after start).
   * Setup:    api() mocked to throw a VALIDATION_ERROR with message 'endAt must be after
   *           startAt'.
   * Expected: that message is shown on the card.
   * Type:     error
   */
  // SCRUM-72-TC15
  it('shows the server\'s validation message (e.g. end not after start)', async () => {
    mockApi({ blockError: { message: 'endAt must be after startAt', code: 'VALIDATION_ERROR' } });
    render(<BlockVenueCard venues={venues} />);

    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Mark unavailable' }));

    expect(await screen.findByText('endAt must be after startAt')).toBeInTheDocument();
  });
});

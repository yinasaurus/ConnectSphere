import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../src/api';
import PlaceHoldCard from '../../src/components/PlaceHoldCard';

jest.mock('../../src/api', () => ({
  api: jest.fn(),
}));

/**
 * SCRUM-75: Venue Staff place a tentative hold on a venue.
 * The API owns the rules (backend/tests/venues.holds.test.js); these tests check the card
 * sends the right request, shows the event's time and shows the server's message on errors.
 */
const venues = [{ id: 8, name: 'Hall A' }, { id: 9, name: 'Hall B' }];
const events = [
  { id: 50, name: 'Tech Talk', status: 'PLANNING', startAt: '2026-11-20T10:00:00.000Z', endAt: '2026-11-20T12:00:00.000Z' },
  { id: 51, name: 'Old Gala', status: 'COMPLETED', startAt: '2026-01-01T10:00:00.000Z', endAt: '2026-01-01T12:00:00.000Z' },
  { id: 52, name: 'Cancelled Fair', status: 'CANCELLED', startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T12:00:00.000Z' },
];

function mockApi({ holdError } = {}) {
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/api/events') return { events };
    if (path === '/api/venues/holds' && options.method === 'POST') {
      if (holdError) {
        const error = new Error(holdError.message);
        error.code = holdError.code;
        throw error;
      }
      return { booking: { id: 900, status: 'TENTATIVE' } };
    }
    throw new Error(`Unexpected ${path}`);
  });
}

async function fillForm() {
  await screen.findByRole('option', { name: 'Tech Talk' });
  await userEvent.selectOptions(screen.getByLabelText('Event'), '50');
  await userEvent.selectOptions(screen.getByLabelText('Venue'), '8');
  await userEvent.type(screen.getByLabelText('Hold expires'), '2026-11-18T09:00');
}

describe('SCRUM-75 PlaceHoldCard', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('US75-F01: sends the event, venue and expiry (as ISO) to the holds route', async () => {
    mockApi();
    const onPlaced = jest.fn();
    render(<PlaceHoldCard venues={venues} onPlaced={onPlaced} />);

    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Place hold' }));

    expect(api).toHaveBeenCalledWith('/api/venues/holds', {
      method: 'POST',
      body: { eventId: 50, venueId: 8, expiresAt: new Date('2026-11-18T09:00').toISOString() },
    });
    expect(await screen.findByText('Hold placed.')).toBeInTheDocument();
    expect(onPlaced).toHaveBeenCalled();
  });

  it('US75-F02: lists only events still being planned', async () => {
    mockApi();
    render(<PlaceHoldCard venues={venues} />);
    expect(await screen.findByRole('option', { name: 'Tech Talk' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Old Gala' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Cancelled Fair' })).not.toBeInTheDocument();
  });

  it('US75-F03: shows the chosen event\'s date and time so staff can pick a valid expiry', async () => {
    mockApi();
    render(<PlaceHoldCard venues={venues} />);
    await screen.findByRole('option', { name: 'Tech Talk' });
    await userEvent.selectOptions(screen.getByLabelText('Event'), '50');
    expect(screen.getByTestId('hold-event-window')).toHaveTextContent(
      new Date(events[0].startAt).toLocaleString()
    );
  });

  it('US75-F04: sends no expiry when none is picked, and shows the server\'s message', async () => {
    mockApi({ holdError: { code: 'HOLD_EXPIRY_REQUIRED', message: 'A hold needs an expiry date and time' } });
    render(<PlaceHoldCard venues={venues} />);
    await screen.findByRole('option', { name: 'Tech Talk' });
    await userEvent.selectOptions(screen.getByLabelText('Event'), '50');
    await userEvent.selectOptions(screen.getByLabelText('Venue'), '8');
    await userEvent.click(screen.getByRole('button', { name: 'Place hold' }));

    expect(api).toHaveBeenCalledWith('/api/venues/holds', {
      method: 'POST',
      body: { eventId: 50, venueId: 8, expiresAt: undefined },
    });
    expect(await screen.findByText('A hold needs an expiry date and time')).toBeInTheDocument();
  });

  it('US75-F05: shows a clash message and does not call onPlaced', async () => {
    mockApi({ holdError: { code: 'BOOKING_CONFLICT', message: 'This venue already has a confirmed booking or active hold in that window' } });
    const onPlaced = jest.fn();
    render(<PlaceHoldCard venues={venues} onPlaced={onPlaced} />);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Place hold' }));

    expect(await screen.findByText(/already has a confirmed booking or active hold/)).toBeInTheDocument();
    expect(onPlaced).not.toHaveBeenCalled();
  });

  it('US75-F06: disables the button while the hold is being saved', async () => {
    let finish;
    api.mockImplementation(async (path) => {
      if (path === '/api/events') return { events };
      return new Promise((resolve) => { finish = resolve; });
    });
    render(<PlaceHoldCard venues={venues} />);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Place hold' }));

    expect(screen.getByRole('button', { name: 'Placing hold…' })).toBeDisabled();
    finish({ booking: { id: 900 } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Place hold' })).toBeEnabled());
  });

  it('US75-F10: shows an error when the event list cannot be loaded', async () => {
    api.mockRejectedValueOnce(new Error('Could not load events'));
    render(<PlaceHoldCard venues={venues} />);
    expect(await screen.findByText('Could not load events')).toBeInTheDocument();
  });

  it('US75-F11: an empty reply from the event list leaves only the placeholder option', async () => {
    api.mockResolvedValueOnce({});
    render(<PlaceHoldCard venues={venues} />);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/events'));
    expect(screen.getByLabelText('Event').querySelectorAll('option')).toHaveLength(1);
  });

  it('US75-F12: leaves out events with no start time', async () => {
    api.mockResolvedValueOnce({
      events: [...events, { id: 53, name: 'Undated Talk', status: 'PLANNING', startAt: null }],
    });
    render(<PlaceHoldCard venues={venues} />);
    await screen.findByRole('option', { name: 'Tech Talk' });
    expect(screen.queryByRole('option', { name: 'Undated Talk' })).not.toBeInTheDocument();
  });

  it('US75-F13: with nothing picked, sends no ids and no expiry (the API rejects it)', async () => {
    mockApi({ holdError: { code: 'VALIDATION_ERROR', message: 'eventId and venueId are required' } });
    render(<PlaceHoldCard venues={venues} />);
    await screen.findByRole('option', { name: 'Tech Talk' });
    await userEvent.click(screen.getByRole('button', { name: 'Place hold' }));

    expect(api).toHaveBeenCalledWith('/api/venues/holds', {
      method: 'POST',
      body: { eventId: undefined, venueId: undefined, expiresAt: undefined },
    });
    expect(await screen.findByText('eventId and venueId are required')).toBeInTheDocument();
  });

  it('US75-F14: works with no venues passed in', async () => {
    mockApi();
    render(<PlaceHoldCard />);
    await screen.findByRole('option', { name: 'Tech Talk' });
    expect(screen.getByLabelText('Venue').querySelectorAll('option')).toHaveLength(1);
  });

  it('US75-F15: shows only the start when the event has no end time', async () => {
    api.mockResolvedValueOnce({ events: [{ ...events[0], endAt: null }] });
    render(<PlaceHoldCard venues={venues} />);
    await screen.findByRole('option', { name: 'Tech Talk' });
    await userEvent.selectOptions(screen.getByLabelText('Event'), '50');
    const heldFor = screen.getByTestId('hold-event-window');
    expect(heldFor).toHaveTextContent(new Date(events[0].startAt).toLocaleString());
    expect(heldFor).not.toHaveTextContent(' to ');
  });

  it('US75-F16: places a hold even when the page passes no onPlaced callback', async () => {
    mockApi();
    render(<PlaceHoldCard venues={venues} />);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Place hold' }));
    expect(await screen.findByText('Hold placed.')).toBeInTheDocument();
    expect(screen.getByLabelText('Hold expires')).toHaveValue('');
  });
});

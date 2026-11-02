import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/api';
import { useAuth } from '../src/auth';
import Button from '../src/components/Button';
import { displayError, displayFieldErrors } from '../src/displayError';
import Venues from '../src/pages/Venues';

jest.mock('../src/api', () => ({
  api: jest.fn(),
}));

jest.mock('../src/auth', () => ({
  useAuth: jest.fn(),
}));

function renderVenues(bookings) {
  api.mockImplementation(async (path) => {
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/venues/bookings') return { bookings };
    if (path === '/api/events') return { events: [] };
    return {};
  });
  return render(
    <MemoryRouter>
      <Venues />
    </MemoryRouter>
  );
}

const pendingBooking = {
  id: 101,
  event_id: 3,
  venue_id: 1,
  status: 'PENDING',
  start_at: '2026-11-20T09:00:00.000Z',
  end_at: '2026-11-20T12:00:00.000Z',
  event_name: 'Revert check',
  venue_name: 'Helix Hall',
};

const approvedBooking = {
  ...pendingBooking,
  id: 201,
  status: 'APPROVED',
  event_name: 'Approved talk',
};

describe('SCRUM-92 shared wording and controls', () => {
  // SCRUM-92-TC04
  it('replaces a known technical sentence and keeps an unknown one', () => {
    expect(displayError('Request failed')).toBe('Something went wrong. Please try again.');
    expect(displayError({ message: 'Authentication required' })).toBe('Please sign in again.');
    expect(displayError('from must be before to')).toBe('The start must be before the end.');
    expect(displayError('Venue is already booked for that window.')).toBe(
      'Venue is already booked for that window.'
    );
  });

  // SCRUM-92-TC05
  it('shows a field message without the field name', () => {
    const text = displayFieldErrors({
      details: [
        { field: 'setupMinutes', message: 'Setup minutes must be a number' },
        { field: 'teardownMinutes', message: 'Teardown minutes must be a number' },
      ],
    });
    expect(text).toBe('Setup minutes must be a number. Teardown minutes must be a number.');
    expect(text).not.toMatch(/setupMinutes|teardownMinutes/);
  });

  // SCRUM-92-TC06
  it('uses one button style for primary, secondary, danger, and links', () => {
    render(
      <MemoryRouter>
        <Button>Save</Button>
        <Button variant="secondary">Back</Button>
        <Button variant="danger">Reject</Button>
        <Button variant="ghost" to="/app">Home</Button>
        <Button disabled>Wait</Button>
      </MemoryRouter>
    );

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveClass('btn');
    expect(save).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('btn', 'secondary');
    expect(screen.getByRole('button', { name: 'Reject' })).toHaveClass('btn', 'danger');
    expect(screen.getByRole('button', { name: 'Wait' })).toBeDisabled();
    const home = screen.getByRole('link', { name: 'Home' });
    expect(home).toHaveClass('btn', 'ghost');
    expect(home).toHaveAttribute('href', '/app');
  });
});

describe('SCRUM-92 venue tables split by status', () => {
  beforeEach(() => {
    api.mockReset();
  });

  // SCRUM-92-TC07
  it('keeps a pending booking off the catalogue until Pending is opened', async () => {
    useAuth.mockReturnValue({ hasRole: (role) => role === 'VENUE_STAFF' });
    renderVenues([pendingBooking, approvedBooking]);

    expect(await screen.findByRole('tab', { name: 'Catalogue' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('pending-booking-101')).not.toBeInTheDocument();
    expect(screen.queryByTestId('booking-row-201')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Pending' }));
    expect(await screen.findByTestId('pending-booking-101')).toBeInTheDocument();
    expect(screen.queryByTestId('booking-row-201')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Decided' }));
    expect(await screen.findByTestId('booking-row-201')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-booking-101')).not.toBeInTheDocument();
  });

  // SCRUM-92-TC08
  it('shows a coordinator one bookings tab instead of the staff status tabs', async () => {
    useAuth.mockReturnValue({ hasRole: (role) => role === 'EVENT_COORDINATOR' });
    renderVenues([pendingBooking, approvedBooking]);

    expect(await screen.findByRole('tab', { name: 'Catalogue' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Bookings' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Pending' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Decided' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Holds' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Unavailable' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Bookings' }));
    expect(await screen.findByTestId('booking-row-101')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-booking-101')).not.toBeInTheDocument();
    expect(screen.getByTestId('booking-row-201')).toBeInTheDocument();
  });
});

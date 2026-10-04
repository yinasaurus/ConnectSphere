/**
 * SCRUM-66: venue availability page and who can reach it (AC6).
 * The backend computes the periods; these tests check the page asks for the right
 * range and shows what comes back.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import VenueAvailability from './VenueAvailability';
import Layout from '../components/Layout';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const AVAILABILITY = {
  venue: { id: 7, name: 'Helix Hall' },
  from: '2026-10-20T08:00:00.000Z',
  to: '2026-10-20T14:00:00.000Z',
  periods: [
    { startAt: '2026-10-20T08:00:00.000Z', endAt: '2026-10-20T09:30:00.000Z', available: true, reasons: [] },
    {
      startAt: '2026-10-20T09:30:00.000Z',
      endAt: '2026-10-20T12:45:00.000Z',
      available: false,
      reasons: [{ type: 'BOOKING', id: 1, label: 'Leadership Forum' }],
    },
    {
      startAt: '2026-10-20T12:45:00.000Z',
      endAt: '2026-10-20T14:00:00.000Z',
      available: false,
      reasons: [{ type: 'TENTATIVE_HOLD', id: 2, label: 'Board offsite', expiresAt: '2026-10-16T00:00:00.000Z' }],
    },
  ],
};

function mockApi({ availabilityError = null } = {}) {
  api.mockImplementation(async (path) => {
    if (path === '/api/venues') return { venues: [{ id: 7, name: 'Helix Hall' }] };
    if (path.startsWith('/api/venues/7/availability')) {
      if (availabilityError) throw new Error(availabilityError);
      return AVAILABILITY;
    }
    throw new Error(`Unexpected ${path}`);
  });
}

async function fillForm() {
  fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-20T08:00' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-20T14:00' } });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SCRUM-66 VenueAvailability page', () => {
  it('US66-F01: requests the chosen range and shows available and unavailable periods with reasons', async () => {
    mockApi();
    render(<VenueAvailability />);
    await screen.findByRole('option', { name: 'Helix Hall' });
    await fillForm();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check availability' }));

    const params = new URLSearchParams({
      from: new Date('2026-10-20T08:00').toISOString(),
      to: new Date('2026-10-20T14:00').toISOString(),
    });
    expect(api).toHaveBeenCalledWith(`/api/venues/7/availability?${params.toString()}`);
    expect(await screen.findByRole('heading', { name: 'Helix Hall' })).toBeInTheDocument();
    expect(screen.getAllByText('Available')).toHaveLength(1);
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.getByText(/Confirmed booking \(incl\. setup\/turnaround\): Leadership Forum/)).toBeInTheDocument();
    expect(screen.getByText(/Tentative hold: Board offsite/)).toBeInTheDocument();
    expect(screen.getByText(/hold expires/)).toBeInTheDocument();
  });

  it('US66-F02: asks for a venue and both dates before calling the API', async () => {
    mockApi();
    render(<VenueAvailability />);
    await screen.findByRole('option', { name: 'Helix Hall' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check availability' }));
    expect(screen.getByText('Pick a venue, a start and an end date/time.')).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('US66-F03: shows the server error, e.g. a refused or invalid range', async () => {
    mockApi({ availabilityError: 'from must be before to' });
    render(<VenueAvailability />);
    await screen.findByRole('option', { name: 'Helix Hall' });
    await fillForm();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check availability' }));
    expect(await screen.findByText('from must be before to')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('SCRUM-66 VenueAvailability page (venue list failure)', () => {
  it('US66-F06: shows an error if the venue list cannot be loaded', async () => {
    api.mockRejectedValue(new Error('You do not have access to this action'));
    render(<VenueAvailability />);
    expect(await screen.findByText('You do not have access to this action')).toBeInTheDocument();
  });
});

describe('SCRUM-66 navigation (AC6)', () => {
  function renderLayoutAs(roles) {
    useAuth.mockReturnValue({
      user: { fullName: 'Test User', roles },
      logout: jest.fn(),
      hasRole: (...allowed) => allowed.some((role) => roles.includes(role)),
    });
    render(<MemoryRouter><Layout /></MemoryRouter>);
  }

  it.each(['EVENT_COORDINATOR', 'VENUE_STAFF', 'TECHNICAL_SUPPORT'])(
    'US66-F04: %s sees the Venue availability link',
    (role) => {
      renderLayoutAs([role]);
      expect(screen.getByRole('link', { name: 'Venue availability' })).toBeInTheDocument();
    }
  );

  it.each(['EVENT_ORGANISER', 'ATTENDEE'])('US66-F05: %s does not see the Venue availability link', (role) => {
    renderLayoutAs([role]);
    expect(screen.queryByRole('link', { name: 'Venue availability' })).not.toBeInTheDocument();
  });
});

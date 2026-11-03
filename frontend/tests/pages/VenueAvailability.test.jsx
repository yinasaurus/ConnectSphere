/**
 * SCRUM-66: venue availability page and who can reach it (AC6).
 * The backend computes the periods; these tests check the page asks for the right
 * range and shows what comes back.
 *
 * An empty form and a server error message (AC5), a failed venue list and the sidebar
 * link for internal roles (AC6) check ways those criteria cannot fail. Those tests sit
 * in their own describes at the bottom.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import VenueAvailability from '../../src/pages/VenueAvailability';
import Layout from '../../src/components/Layout';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

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
  // The page reads the user's roles since SCRUM-67. Technical Support is a SCRUM-66 role
  // that doesn't get the bookings list, so these tests still see only the availability calls.
  useAuth.mockReturnValue({ hasRole: (...allowed) => allowed.includes('TECHNICAL_SUPPORT') });
});

describe('SCRUM-66 VenueAvailability page', () => {
  /*
   * AC:       SCRUM-66 AC1 + AC2 + AC5 (display side)
   * Scenario: An internal user picks a venue and a range and checks availability.
   * Setup:    The API returns one available period, one blocked by a confirmed booking
   *           and one blocked by a tentative hold that has an expiry. The form uses local
   *           datetime-local values, as a real user would enter.
   * Expected: The page asks for exactly the chosen venue and range (converted to UTC),
   *           then shows each period's status and why it is blocked, including when the
   *           hold expires.
   * Type:     normal
   */
  // SCRUM-66-TC15
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
    // Expected params are built from the same local inputs, so this holds in any time zone.
    expect(api).toHaveBeenCalledWith(`/api/venues/7/availability?${params.toString()}`);
    expect(await screen.findByRole('heading', { name: 'Helix Hall' })).toBeInTheDocument();
    // Counts prove each period gets its own status badge (1 available + 2 unavailable rows).
    expect(screen.getAllByText('Available')).toHaveLength(1);
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.getByText(/Confirmed booking \(incl\. setup\/turnaround\): Leadership Forum/)).toBeInTheDocument();
    expect(screen.getByText(/Tentative hold: Board offsite/)).toBeInTheDocument();
    expect(screen.getByText(/hold expires/)).toBeInTheDocument();
  });
});

function renderLayoutAs(roles) {
  useAuth.mockReturnValue({
    user: { fullName: 'Test User', roles },
    logout: jest.fn(),
    hasRole: (...allowed) => allowed.some((role) => roles.includes(role)),
  });
  render(<MemoryRouter><Layout /></MemoryRouter>);
}

describe('SCRUM-66 navigation (AC6)', () => {
  /*
   * AC:       SCRUM-66 AC6 (UI side)
   * Scenario: An Event Organiser or Attendee looks at the sidebar.
   * Setup:    Layout rendered for a user with only that role.
   * Expected: No "Venue availability" link, so they are never offered the view. The real
   *           enforcement is the API's 403 (US66-R02); this only covers the link.
   * Type:     error
   */
  // SCRUM-66-TC17
  it.each(['EVENT_ORGANISER', 'ATTENDEE'])('US66-F05: %s does not see the Venue availability link', (role) => {
    renderLayoutAs([role]);
    expect(screen.queryByRole('link', { name: 'Venue availability' })).not.toBeInTheDocument();
  });
});

describe('SCRUM-66 page guards: empty form and errors', () => {
  /*
   * AC: SCRUM-66 AC5 (cannot fail this way: the page checks or shows availability before a
   *     venue and a range are chosen).
   * Scenario: The user clicks Check availability without filling in the form.
   * Setup: The venue list has loaded. Venue, From, and To are empty. The API is mocked.
   * Expected: An inline message asks for all three, and no availability request is sent.
   * Type: error
   */
  // SCRUM-66-TC22
  it('US66-F02: asks for a venue and both dates before calling the API', async () => {
    mockApi();
    render(<VenueAvailability />);
    await screen.findByRole('option', { name: 'Helix Hall' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check availability' }));
    expect(screen.getByText('Pick a venue, a start and an end date/time.')).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
  });

  /*
   * AC: SCRUM-66 AC5 (cannot fail this way: the server refuses the check and the page still
   *     shows a results table). The message here is a bad range, not an AC6 refusal.
   * Scenario: The server rejects the availability request.
   * Setup: The availability call throws "from must be before to". The API is mocked.
   * Expected: The server's message is shown and no results table is rendered.
   * Type: error
   */
  // SCRUM-66-TC23
  it('US66-F03: shows the server error, e.g. a refused or invalid range', async () => {
    mockApi({ availabilityError: 'from must be before to' });
    render(<VenueAvailability />);
    await screen.findByRole('option', { name: 'Helix Hall' });
    await fillForm();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check availability' }));
    expect(await screen.findByText('from must be before to')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-66 AC6 (cannot fail this way: the server refuses the venue list and the page
   *     hides the refusal). The refusal is mocked; the signed-in role is Technical Support.
   * Scenario: GET /api/venues fails.
   * Setup: Every API call rejects. The API is mocked.
   * Expected: The error is shown on the page.
   * Type: error
   */
  // SCRUM-66-TC24
  it('US66-F06: shows an error if the venue list cannot be loaded', async () => {
    api.mockRejectedValue(new Error('You do not have access to this action'));
    render(<VenueAvailability />);
    expect(await screen.findByText('You do not have access to this action')).toBeInTheDocument();
  });
});

describe('Venue availability link for internal roles', () => {
  /*
   * AC: SCRUM-66 AC6 (cannot fail this way: hiding the link from Organisers and Attendees
   *     also hides it from internal roles).
   * Scenario: An internal user looks at the sidebar.
   * Setup: Layout rendered for a user with only that role.
   * Expected: The "Venue availability" link is shown. This checks the nav link only.
   *           Who can open the view is the API (US66-R01).
   * Type: normal
   */
  // SCRUM-66-TC16
  it.each([
    'EVENT_COORDINATOR',
    'EVENT_COORDINATOR_LEAD',
    'SAFETY_OFFICER',
    'VENUE_STAFF',
    'TECHNICAL_SUPPORT',
  ])(
    'US66-F04: %s sees the Venue availability link',
    (role) => {
      renderLayoutAs([role]);
      expect(screen.getByRole('link', { name: 'Venue availability' })).toBeInTheDocument();
    }
  );
});

/**
 * SCRUM-67: "Existing bookings" list on the Venue availability page.
 * The backend decides which bookings count and computes the occupied windows
 * (tests in backend/tests/venues.periodBookings.test.js); these tests check the page
 * asks for the right venue and period, shows what comes back, and only asks for the
 * roles AC5 allows.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VenueAvailability from './VenueAvailability';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const AVAILABILITY = {
  venue: { id: 7, name: 'Helix Hall' },
  from: '2026-10-20T08:00:00.000Z',
  to: '2026-10-20T14:00:00.000Z',
  periods: [{ startAt: '2026-10-20T08:00:00.000Z', endAt: '2026-10-20T14:00:00.000Z', available: true, reasons: [] }],
};

const CONFIRMED = {
  id: 1,
  eventId: 50,
  eventName: 'Leadership Forum',
  type: 'BOOKING',
  status: 'APPROVED',
  startAt: '2026-10-20T10:00:00.000Z',
  endAt: '2026-10-20T12:00:00.000Z',
  setupMinutes: 30,
  teardownMinutes: 45,
  occupiedStartAt: '2026-10-20T09:30:00.000Z',
  occupiedEndAt: '2026-10-20T12:45:00.000Z',
  holdExpiresAt: null,
};

const HOLD = {
  id: 2,
  eventId: 60,
  eventName: 'Board offsite',
  type: 'TENTATIVE_HOLD',
  status: 'TENTATIVE',
  startAt: '2026-10-20T13:00:00.000Z',
  endAt: '2026-10-20T13:30:00.000Z',
  setupMinutes: null,
  teardownMinutes: null,
  occupiedStartAt: '2026-10-20T13:00:00.000Z',
  occupiedEndAt: '2026-10-20T13:30:00.000Z',
  holdExpiresAt: '2026-10-16T00:00:00.000Z',
};

function signInAs(role) {
  useAuth.mockReturnValue({ hasRole: (...allowed) => allowed.includes(role) });
}

function mockApi({ bookings = [CONFIRMED, HOLD], bookingsError = null } = {}) {
  api.mockImplementation(async (path) => {
    if (path === '/api/venues') return { venues: [{ id: 7, name: 'Helix Hall' }] };
    if (path.startsWith('/api/venues/7/availability')) return AVAILABILITY;
    if (path.startsWith('/api/venues/7/bookings')) {
      if (bookingsError) throw new Error(bookingsError);
      return { ...AVAILABILITY, bookings };
    }
    throw new Error(`Unexpected ${path}`);
  });
}

async function search() {
  render(<VenueAvailability />);
  await screen.findByRole('option', { name: 'Helix Hall' });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-20T08:00' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-20T14:00' } });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Check availability' }));
}

function range(value) {
  return new Date(value).toLocaleString();
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SCRUM-67 Existing bookings list', () => {
  /*
   * AC:       SCRUM-67 AC1 + AC2 (display side)
   * Scenario: An Event Coordinator checks Helix Hall for 08:00-14:00.
   * Setup:    The bookings API returns a confirmed booking (10:00-12:00, occupied
   *           09:30-12:45 with 30/45 min) and an active hold (13:00-13:30, expiring 16 Oct).
   * Expected: The page asks for the same venue and period (in UTC) as the availability
   *           check, and lists both: the booking as "Confirmed" with its occupied window and
   *           setup/turnaround, the hold as "Tentative hold" with its expiry.
   * Type:     normal
   */
  it('US67-F01 (AC1+AC2): lists confirmed bookings with occupied windows and holds marked as holds', async () => {
    signInAs('EVENT_COORDINATOR');
    mockApi();
    await search();

    const params = new URLSearchParams({
      from: new Date('2026-10-20T08:00').toISOString(),
      to: new Date('2026-10-20T14:00').toISOString(),
    });
    expect(api).toHaveBeenCalledWith(`/api/venues/7/bookings?${params.toString()}`);

    const table = await screen.findByRole('table', { name: 'Existing bookings' });
    // One body row per booking, so neither was dropped or duplicated.
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByText('Leadership Forum')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    // Occupied window is the padded one from the API, not the booked 10:00-12:00.
    expect(screen.getByText(`${range(CONFIRMED.occupiedStartAt)} – ${range(CONFIRMED.occupiedEndAt)}`, { exact: false })).toBeInTheDocument();
    expect(screen.getByText('30 min setup, 45 min turnaround')).toBeInTheDocument();
    expect(screen.getByText('Board offsite')).toBeInTheDocument();
    // The visible "Tentative hold" label is what makes a hold identifiable (AC2).
    expect(screen.getByText('Tentative hold')).toBeInTheDocument();
    expect(screen.getByText(`expires ${range(HOLD.holdExpiresAt)}`)).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-67 AC5 (UI side)
   * Scenario: Venue Staff and the Event Coordinator Lead check availability.
   * Setup:    Signed in with only that role.
   * Expected: The bookings list is requested and shown.
   * Type:     normal
   */
  it.each(['VENUE_STAFF', 'EVENT_COORDINATOR_LEAD'])('US67-F02 (AC5): %s sees the existing bookings', async (role) => {
    signInAs(role);
    mockApi();
    await search();
    expect(await screen.findByRole('table', { name: 'Existing bookings' })).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-67 AC5 (UI side)
   * Scenario: Technical Support uses the page. SCRUM-66 lets them see availability, but
   *           AC5 doesn't name them for bookings.
   * Setup:    Signed in as Technical Support only.
   * Expected: Availability is shown, but the bookings API is never called and there is no
   *           "Existing bookings" section. The real enforcement is the API's 403 (US67-R02).
   * Type:     error
   */
  it('US67-F03 (AC5): Technical Support does not request or see the bookings list', async () => {
    signInAs('TECHNICAL_SUPPORT');
    mockApi();
    await search();
    expect(await screen.findByRole('heading', { name: 'Helix Hall' })).toBeInTheDocument();
    expect(api.mock.calls.map(([path]) => path).some((path) => path.includes('/bookings'))).toBe(false);
    expect(screen.queryByText('Existing bookings')).not.toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-67 AC1 + AC3 (display side)
   * Scenario: Nothing is committed in the period, for example only an expired hold
   *           existed, which the API leaves out.
   * Setup:    The bookings API returns an empty list.
   * Expected: A clear "nothing in this period" message instead of an empty table.
   * Type:     boundary
   */
  it('US67-F04 (AC1+AC3): says so when the venue has no bookings in the period', async () => {
    signInAs('EVENT_COORDINATOR');
    mockApi({ bookings: [] });
    await search();
    expect(await screen.findByText('No confirmed bookings or active holds in this period.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Existing bookings' })).not.toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-67 (error handling; also how an AC5 refusal reaches the user)
   * Scenario: The bookings request fails while the availability request succeeds.
   * Setup:    The bookings API throws "You do not have access to this action".
   * Expected: The error is shown in the bookings section and the availability result is
   *           still shown, so one failing call doesn't hide the other.
   * Type:     error
   */
  it('US67-F05: shows a bookings error without hiding the availability result', async () => {
    signInAs('EVENT_COORDINATOR');
    mockApi({ bookingsError: 'You do not have access to this action' });
    await search();
    expect(await screen.findByText('You do not have access to this action')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Helix Hall' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Existing bookings' })).not.toBeInTheDocument();
  });
});

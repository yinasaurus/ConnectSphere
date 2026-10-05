/**
 * SCRUM-67: "Existing bookings" list on the Venue availability page.
 * The backend decides which bookings count and computes the occupied windows
 * (tests in backend/tests/venues.periodBookings.test.js); these tests check the page
 * asks for the right venue and period, shows what comes back, and only asks for the
 * roles AC5 allows.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
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

    // The heading names the venue the bookings came back for.
    expect(await screen.findByRole('heading', { name: 'Existing bookings at Helix Hall' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Existing bookings' });
    // One body row per booking, so neither was dropped or duplicated.
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByText('Leadership Forum')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    // The booked 10:00-12:00 and the padded occupied 09:30-12:45 are both shown, in
    // their own columns, so the user can see how much the setup/turnaround adds.
    const [, , bookedCell, occupiedCell] = table.querySelectorAll('tbody tr')[0].querySelectorAll('td');
    expect(bookedCell).toHaveTextContent(`${range(CONFIRMED.startAt)} – ${range(CONFIRMED.endAt)}`);
    expect(occupiedCell).toHaveTextContent(`${range(CONFIRMED.occupiedStartAt)} – ${range(CONFIRMED.occupiedEndAt)}`);
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
    // Regex so it also catches the "Existing bookings at <venue>" heading.
    expect(screen.queryByText(/Existing bookings/)).not.toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-67 AC1 (display side, empty period)
   * Scenario: Nothing is committed at the venue in the period.
   * Setup:    The bookings API returns an empty list. Leaving out expired holds (AC3) is
   *           done by the API and checked in US67-B07/B08, not here.
   * Expected: A clear "nothing in this period" message instead of an empty table.
   * Type:     boundary
   */
  it('US67-F04 (AC1): says so when the venue has no bookings in the period', async () => {
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

  /*
   * AC:       SCRUM-67 AC1 (display side)
   * Scenario: The API sends a booking with no event name (B14), or a reply with no
   *           bookings list.
   * Setup:    (a) one confirmed booking for event 60 with eventName null; (b) a reply
   *           whose bookings field is null.
   * Expected: (a) The row is still listed, labelled "Event #60", so a committed booking
   *           is never hidden. (b) The empty-period message is shown instead of a crash.
   * Type:     error
   */
  it('US67-F07 (AC1): falls back to the event id, and copes with a reply without bookings', async () => {
    signInAs('EVENT_COORDINATOR');
    mockApi({ bookings: [{ ...CONFIRMED, eventId: 60, eventName: null }] });
    await search();
    expect(await screen.findByText('Event #60')).toBeInTheDocument();

    // null, not undefined: undefined would fall back to mockApi's default bookings.
    mockApi({ bookings: null });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check availability' }));
    expect(await screen.findByText('No confirmed bookings or active holds in this period.')).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-67 AC4 (display side)
   * Scenario: The user checks Helix Hall, then a breakout room, and Helix Hall's bookings
   *           reply arrives only after the breakout room search.
   * Setup:    Venue 7's bookings call is held open; venue 8's answers straight away with
   *           its own booking. Venue 7's late reply is (a) a success with Helix Hall's
   *           "Leadership Forum" or (b) an error.
   * Expected: Only the breakout room's booking is shown, with no error, under the heading
   *           "Existing bookings at Breakout Room". A late reply
   *           from the earlier search must not put another venue's bookings (or its
   *           error) under the venue being viewed.
   * Type:     conflict
   */
  it.each([
    ['succeeds', (late) => late.resolve({ venue: { id: 7, name: 'Helix Hall' }, bookings: [CONFIRMED] })],
    ['fails', (late) => late.reject(new Error('Venue 7 bookings failed'))],
  ])('US67-F06 (AC4): a late reply from an earlier search that %s is ignored', async (_label, settleLate) => {
    signInAs('EVENT_COORDINATOR');
    const late = {};
    const lateReply = new Promise((resolve, reject) => Object.assign(late, { resolve, reject }));
    api.mockImplementation(async (path) => {
      if (path === '/api/venues') return { venues: [{ id: 7, name: 'Helix Hall' }, { id: 8, name: 'Breakout Room' }] };
      if (path.startsWith('/api/venues/7/availability')) return AVAILABILITY;
      if (path.startsWith('/api/venues/8/availability')) return { ...AVAILABILITY, venue: { id: 8, name: 'Breakout Room' } };
      if (path.startsWith('/api/venues/7/bookings')) return lateReply;
      if (path.startsWith('/api/venues/8/bookings')) return { venue: { id: 8, name: 'Breakout Room' }, bookings: [HOLD] };
      throw new Error(`Unexpected ${path}`);
    });
    await search();
    await screen.findByRole('heading', { name: 'Helix Hall' });

    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: '8' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check availability' }));
    expect(await screen.findByText('Board offsite')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Existing bookings at Breakout Room' })).toBeInTheDocument();

    await act(async () => {
      settleLate(late);
      await lateReply.catch(() => {});
    });
    // Venue 7's booking and error never appear under the breakout room.
    expect(screen.queryByText('Leadership Forum')).not.toBeInTheDocument();
    expect(screen.queryByText('Venue 7 bookings failed')).not.toBeInTheDocument();
    expect(screen.getByText('Board offsite')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Existing bookings at Breakout Room' })).toBeInTheDocument();
  });
});

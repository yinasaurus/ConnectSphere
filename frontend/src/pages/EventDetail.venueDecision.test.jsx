/**
 * SCRUM-78: what Venue Staff send when they decide a booking request on the event page.
 * The backend builds the Coordinator's notice from it (backend/tests/
 * venues.bookingDecisionNotice.test.js); these tests check the page sends exactly what
 * staff typed, and nothing made up when they type nothing. Also covers how the notice
 * appears on the Notifications page.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from './EventDetail';
import Notifications from './Notifications';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const DECISION_PATH = '/api/venues/bookings/5/decision';

function mockEventApi() {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') return { event: { id: 3, name: 'Leadership Forum', status: 'PLANNING', coordinatorId: 21 } };
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [{ id: 5, venue_name: 'Helix Hall', status: 'PENDING' }] };
    if (path === DECISION_PATH) return { booking: { id: 5 } };
    throw new Error(`Unexpected ${path}`);
  });
}

async function openAsVenueStaff() {
  useAuth.mockReturnValue({ user: { id: 40 }, hasRole: (...roles) => roles.includes('VENUE_STAFF') });
  mockEventApi();
  render(
    <MemoryRouter initialEntries={['/app/events/3']}>
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
  await screen.findByText('Leadership Forum');
}

function decisionBody() {
  const call = api.mock.calls.find(([path]) => path === DECISION_PATH);
  return call[1].body;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SCRUM-78 Venue Staff decision on the event page', () => {
  /*
   * AC:       SCRUM-78 AC2 (UI side)
   * Scenario: Venue Staff reject the pending booking and explain why, suggesting another room.
   * Setup:    Signed in as Venue Staff only; booking 5 at Helix Hall is PENDING. They type
   *           "Stage under repair" and "Orchid Room".
   * Expected: The rejection is sent with exactly that reason and alternative, so the
   *           Coordinator's notice can include them.
   * Type:     normal
   */
  it('US78-F01 (AC2): rejecting sends the reason and alternative staff typed', async () => {
    await openAsVenueStaff();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Reason for rejecting (optional)'), 'Stage under repair');
    await user.type(screen.getByLabelText('Suggested alternative (optional)'), 'Orchid Room');
    await user.click(screen.getByRole('button', { name: 'Reject venue' }));
    expect(decisionBody()).toEqual({ approve: false, reason: 'Stage under repair', alternativeSuggestion: 'Orchid Room' });
  });

  /*
   * AC:       SCRUM-78 AC3 (UI side)
   * Scenario: Venue Staff reject without typing a reason (or type only spaces).
   * Setup:    Both boxes left blank, or the reason box holds "   ".
   * Expected: The rejection is sent with no reason and no alternative. The page used to fill
   *           in "Venue not suitable", which would show the Coordinator a reason staff never
   *           gave.
   * Type:     boundary
   */
  it.each([['left blank', ''], ['only spaces', '   ']])(
    'US78-F02 (AC3): rejecting with the reason %s sends no reason',
    async (_label, typed) => {
      await openAsVenueStaff();
      const user = userEvent.setup();
      if (typed) await user.type(screen.getByLabelText('Reason for rejecting (optional)'), typed);
      await user.click(screen.getByRole('button', { name: 'Reject venue' }));
      const body = decisionBody();
      expect(body.approve).toBe(false);
      // Checked one by one: toEqual would treat a missing field and an undefined one alike.
      expect(body.reason).toBeUndefined();
      expect(body.alternativeSuggestion).toBeUndefined();
    }
  );

  /*
   * AC:       SCRUM-78 AC1 (UI side)
   * Scenario: Venue Staff approve the booking.
   * Setup:    Signed in as Venue Staff; booking 5 PENDING; a reason was typed beforehand.
   * Expected: Only { approve: true } is sent; the approval notice doesn't use the rejection
   *           reason.
   * Type:     normal
   */
  it('US78-F03 (AC1): approving sends an approval only', async () => {
    await openAsVenueStaff();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Reason for rejecting (optional)'), 'not used');
    await user.click(screen.getByRole('button', { name: 'Approve venue' }));
    expect(decisionBody()).toEqual({ approve: true });
  });
});

describe('SCRUM-78 notice on the Notifications page', () => {
  /*
   * AC:       SCRUM-78 AC2 + AC4 (display side)
   * Scenario: The Coordinator opens Notifications after a rejection.
   * Setup:    The API returns the BOOKING_DECISION notice the backend writes for a rejection
   *           with a reason, linked to event 3.
   * Expected: The title, the full text (event, venue, reason) and a link to the event are
   *           shown, so the Coordinator can act without searching for the event.
   * Type:     normal
   */
  it('US78-F04 (AC2+AC4): shows the decision notice with its event link', async () => {
    useAuth.mockReturnValue({ user: { id: 21 }, hasRole: () => true });
    api.mockResolvedValue({
      notifications: [{
        id: 1,
        event_id: 3,
        type: 'BOOKING_DECISION',
        title: 'Venue booking rejected',
        body: 'The venue booking request for Leadership Forum at Helix Hall was rejected. Reason: Stage under repair',
        read_at: null,
      }],
    });
    render(<MemoryRouter><Notifications /></MemoryRouter>);
    expect(await screen.findByText('Venue booking rejected')).toBeInTheDocument();
    expect(screen.getByText(/Leadership Forum at Helix Hall was rejected\. Reason: Stage under repair/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open event' })).toHaveAttribute('href', '/app/events/3');
  });
});

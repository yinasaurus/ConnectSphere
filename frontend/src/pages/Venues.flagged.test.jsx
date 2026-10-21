/**
 * SCRUM-58 AC5 (Venue Staff view): bookings flagged because a venue's new setup or turnaround
 * time makes them overlap are listed for Venue Staff, marked "Requires review", and the
 * save confirmation says how many were flagged. The backend rules are in
 * backend/tests/venues.flagClashes.test.js; this file only covers what the page shows.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api';
import { useAuth } from '../auth';
import Venues from './Venues';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const VENUE = {
  id: 1,
  name: 'Helix Hall',
  location: 'Level 2',
  capacity: 180,
  facilities: 'Projector',
  accessibility: 'Wheelchair access',
  operatingHours: '08:00 - 22:00',
  setupMinutes: 0,
  teardownMinutes: 0,
  isActive: true,
  updatedAt: '2026-09-20T10:00:00.000Z',
  layouts: ['THEATRE'],
  layoutDetails: [{ id: 10, venue_id: 1, layout: 'THEATRE' }],
};

function bookingRow(id, eventName, needsReview, status = 'APPROVED') {
  return {
    id,
    event_id: id,
    venue_id: 1,
    status,
    start_at: '2099-06-01T10:00:00.000Z',
    end_at: '2099-06-01T12:00:00.000Z',
    event_name: eventName,
    venue_name: 'Helix Hall',
    needs_review: needsReview,
  };
}

// `patchResponse` is what the real PATCH returns: the venue, plus flaggedBookingIds when checked.
function mockApi({ bookings, patchResponse }) {
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/api/venues' && !options.method) return { venues: [{ ...VENUE }] };
    if (path === '/api/venues/bookings') return { bookings };
    if (path === '/api/venues/1' && options.method === 'PATCH') return patchResponse;
    throw new Error(`Unhandled API call: ${path}`);
  });
}

function asRole(role) {
  useAuth.mockReturnValue({ hasRole: (...roles) => roles.includes(role) });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
  api.mockReset();
});

describe('SCRUM-58 flagged bookings on the Venues page', () => {
  /*
   * AC:       SCRUM-58 AC5
   * Scenario: Venue Staff open Venues when two bookings are flagged and one is not.
   * Setup:    Forum and Workshop have needs_review true; Gala is false. All are confirmed.
   * Expected: A "Flagged for review" list shows Forum and Workshop, each with "Requires
   *           review"; Gala is not in that list.
   * Type:     normal
   */
  it('US58-P01: Venue Staff see the flagged bookings listed and marked', async () => {
    asRole('VENUE_STAFF');
    mockApi({ bookings: [bookingRow(1, 'Forum', true), bookingRow(2, 'Workshop', true), bookingRow(3, 'Gala', false)] });
    render(<Venues />);

    const heading = await screen.findByRole('heading', { name: 'Flagged for review' });
    const section = within(heading.closest('div'));
    expect(section.getByText('Forum')).toBeInTheDocument();
    expect(section.getByText('Workshop')).toBeInTheDocument();
    expect(section.queryByText('Gala')).not.toBeInTheDocument();
    expect(section.getAllByText('Requires review')).toHaveLength(2);
  });

  /*
   * AC:       SCRUM-58 AC5 / AC6
   * Scenario: The flagged bookings keep their status on the page.
   * Setup:    One flagged confirmed booking.
   * Expected: The list says nothing has been cancelled or changed, and the booking still
   *           shows its APPROVED status badge next to the flag (the page shows the raw status).
   * Type:     normal
   */
  it('US58-P02: a flagged booking keeps its status and the page says nothing changed', async () => {
    asRole('VENUE_STAFF');
    mockApi({ bookings: [bookingRow(1, 'Forum', true)] });
    render(<Venues />);

    const heading = await screen.findByRole('heading', { name: 'Flagged for review' });
    const section = within(heading.closest('div'));
    expect(section.getByText(/Nothing has been cancelled or changed/)).toBeInTheDocument();
    const row = section.getByText('Forum').closest('tr');
    expect(within(row).getByText('APPROVED')).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-58 AC3
   * Scenario: No booking is flagged.
   * Setup:    Two bookings, both needs_review false.
   * Expected: The "Flagged for review" list is not shown.
   * Type:     boundary
   */
  it('US58-P03: with nothing flagged the list is not shown', async () => {
    asRole('VENUE_STAFF');
    mockApi({ bookings: [bookingRow(1, 'Forum', false), bookingRow(2, 'Workshop', false)] });
    render(<Venues />);

    await screen.findByText('Forum');
    expect(screen.queryByRole('heading', { name: 'Flagged for review' })).not.toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-58 AC5 (the list is for Venue Staff)
   * Scenario: An Event Coordinator opens Venues while bookings are flagged.
   * Setup:    A flagged booking; the signed-in user is only an Event Coordinator.
   * Expected: No "Flagged for review" list (Coordinators see their flag on their event page).
   * Type:     boundary
   */
  it('US58-P04: the flagged list is not offered to a non-Venue-Staff user', async () => {
    asRole('EVENT_COORDINATOR');
    mockApi({ bookings: [bookingRow(1, 'Forum', true)] });
    render(<Venues />);

    await screen.findByText('Forum');
    expect(screen.queryByRole('heading', { name: 'Flagged for review' })).not.toBeInTheDocument();
  });
});

describe('SCRUM-58 saving the venue times shows how many bookings were flagged', () => {
  async function saveTimes(patchResponse) {
    asRole('VENUE_STAFF');
    mockApi({ bookings: [], patchResponse });
    const user = userEvent.setup();
    render(<Venues />);
    await user.click(await screen.findByRole('button', { name: /Helix Hall/i }));
    const update = within(screen.getByRole('heading', { name: 'Update venue' }).closest('.card'));
    await user.clear(update.getByLabelText('Setup (mins)'));
    await user.type(update.getByLabelText('Setup (mins)'), '30');
    await user.click(update.getByRole('button', { name: 'Save changes' }));
  }

  /*
   * AC:       SCRUM-58 AC1
   * Scenario: Venue Staff save new times and the backend reports two bookings now clash.
   * Setup:    PATCH answers with flaggedBookingIds [1, 2].
   * Expected: The confirmation says the venue was updated and 2 bookings are flagged.
   * Type:     normal
   */
  it('US58-P05: the confirmation says how many bookings were flagged', async () => {
    await saveTimes({ venue: { ...VENUE, setupMinutes: 30, flaggedBookingIds: [1, 2] } });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Helix Hall updated. 2 bookings now overlap and are flagged for review.'
    );
  });

  /*
   * AC:       SCRUM-58 AC1 (singular wording)
   * Scenario: The backend reports exactly one booking.
   * Setup:    flaggedBookingIds [7].
   * Expected: "1 booking now overlaps another and is flagged for review."
   * Type:     boundary
   */
  it('US58-P06: the confirmation uses the singular for one booking', async () => {
    await saveTimes({ venue: { ...VENUE, setupMinutes: 30, flaggedBookingIds: [7] } });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Helix Hall updated. 1 booking now overlaps another and is flagged for review.'
    );
  });

  /*
   * AC:       SCRUM-58 AC3
   * Scenario: The new times create no overlap.
   * Setup:    PATCH answers with an empty flaggedBookingIds list.
   * Expected: The plain "Helix Hall updated" confirmation, with no mention of flagged bookings.
   * Type:     normal
   */
  it('US58-P07: no flagged bookings gives the plain confirmation', async () => {
    await saveTimes({ venue: { ...VENUE, setupMinutes: 30, flaggedBookingIds: [] } });

    const toast = await screen.findByRole('status');
    await waitFor(() => expect(toast).toHaveTextContent('Helix Hall updated'));
    expect(toast).not.toHaveTextContent(/flagged/);
  });
});

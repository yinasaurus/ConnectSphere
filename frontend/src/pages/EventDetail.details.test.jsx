/**
 * SCRUM-39: the event page shows the latest details during the Planning or Confirmed stage.
 *
 *   AC1  Authorised users can view event details during the Planning or Confirmed stage.
 *   AC2  The page shows attendance, venue, date, time and equipment requirement.
 *
 * Access itself is enforced by the API (backend/tests/events.details.test.js); these tests
 * check what the page asks for and shows. The Attendee view is covered in EventDetail.test.jsx.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from './EventDetail';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const EVENT = {
  id: 3,
  organiserId: 1,
  coordinatorId: 21,
  name: 'Leadership Forum',
  status: 'PLANNING',
  startAt: '2026-10-20T10:00:00.000Z',
  endAt: '2026-10-20T12:00:00.000Z',
  expectedAttendance: 120,
  venueRequirements: 'Theatre layout, stage',
  equipmentNotes: '2 projectors, 4 wireless mics',
};

function mockApi({ event = EVENT, bookings = [{ id: 7, venue_name: 'Helix Hall', status: 'APPROVED' }],
  requests = [{ id: 12, equipment_id: 4, equipment_name: 'Projector', quantity: 2, status: 'PENDING' }],
  eventError = null, equipmentError = null } = {}) {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') {
      if (eventError) throw new Error(eventError);
      return { event };
    }
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings };
    if (path === '/api/events/3/equipment-requests') {
      if (equipmentError) throw new Error(equipmentError);
      return { requests };
    }
    throw new Error(`Unexpected ${path}`);
  });
}

function renderAs(role, userId = 50) {
  useAuth.mockReturnValue({ user: { id: userId }, hasRole: (...roles) => roles.includes(role) });
  render(
    <MemoryRouter initialEntries={['/app/events/3']}>
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SCRUM-39 event details on the event page', () => {
  /*
   * AC:       SCRUM-39 AC1 + AC2
   * Scenario: An authorised user opens a Planning or Confirmed event.
   * Setup:    Coordinator (not the assigned one) on Planning, Venue Staff and Technical
   *           Support on Confirmed, and the event's own Organiser (user 1) on Planning. The
   *           event has 120 attendees, 10:00-12:00 on 20 Oct, venue needs, equipment notes,
   *           an approved Helix Hall booking and 2 projectors requested.
   * Expected: All AC2 details are shown: date and time, attendance, the booked venue and the
   *           venue needs, the equipment notes and the equipment request. The equipment
   *           requests are fetched for this event only.
   * Type:     normal
   */
  it.each([
    ['EVENT_COORDINATOR', 'PLANNING', 50],
    ['VENUE_STAFF', 'CONFIRMED', 50],
    ['TECHNICAL_SUPPORT', 'CONFIRMED', 50],
    ['EVENT_ORGANISER', 'PLANNING', 1],
  ])('US39-F01 (AC1+AC2): %s sees all details of a %s event', async (role, status, userId) => {
    mockApi({ event: { ...EVENT, status } });
    renderAs(role, userId);
    expect(await screen.findByText('Leadership Forum')).toBeInTheDocument();
    const when = `${new Date(EVENT.startAt).toLocaleString()} – ${new Date(EVENT.endAt).toLocaleString()}`;
    // Each AC2 item is checked against its own label, so a value in the wrong place fails.
    expect(screen.getByText('When:').parentElement).toHaveTextContent(`When: ${when}`);
    expect(screen.getByText('Attendance:').parentElement).toHaveTextContent('Attendance: 120');
    expect(screen.getByText('Venue needs:').parentElement).toHaveTextContent('Venue needs: Theatre layout, stage');
    expect(screen.getByText('Equipment:').parentElement).toHaveTextContent('Equipment: 2 projectors, 4 wireless mics');
    expect(screen.getByText('Helix Hall')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Projector × 2: PENDING')).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/api/events/3/equipment-requests');
  });

  /*
   * AC:       SCRUM-39 AC2
   * Scenario: A Planning event where nothing has been arranged or filled in yet.
   * Setup:    Coordinator; no times, attendance, venue needs or equipment notes; no venue
   *           booking and no equipment requests.
   * Expected: Each item shows a clear placeholder ("TBC", "—", "No booking yet…",
   *           "No equipment requested yet.") instead of blank or broken text.
   * Type:     boundary
   */
  it('US39-F02 (AC2): missing details show placeholders', async () => {
    mockApi({
      event: { ...EVENT, startAt: null, endAt: null, expectedAttendance: null, venueRequirements: null, equipmentNotes: null },
      bookings: [],
      requests: [],
    });
    renderAs('EVENT_COORDINATOR');
    expect(await screen.findByText('Leadership Forum')).toBeInTheDocument();
    expect(screen.getByText('When:').parentElement).toHaveTextContent('When: TBC');
    expect(screen.getByText('Attendance:').parentElement).toHaveTextContent('Attendance: —');
    expect(screen.getByText('Venue needs:').parentElement).toHaveTextContent('Venue needs: —');
    expect(screen.getByText('Equipment:').parentElement).toHaveTextContent('Equipment: —');
    expect(screen.getByText(/No booking yet/)).toBeInTheDocument();
    expect(screen.getByText('No equipment requested yet.')).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-39 AC2
   * Scenario: An equipment request whose catalogue item has since been deleted.
   * Setup:    One request with equipment_name null, quantity 1, PENDING.
   * Expected: It is still listed, as "Item no longer in catalogue × 1: PENDING", so the
   *           requirement isn't hidden.
   * Type:     boundary
   */
  it('US39-F03 (AC2): a request for a deleted item is still shown', async () => {
    mockApi({ requests: [{ id: 13, equipment_id: null, equipment_name: null, quantity: 1, status: 'PENDING' }] });
    renderAs('TECHNICAL_SUPPORT');
    expect(await screen.findByText('Item no longer in catalogue × 1: PENDING')).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-39 AC1 (error side)
   * Scenario: The user isn't allowed to see the event, or it doesn't exist.
   * Setup:    GET /api/events/3 fails with "Event not found" (what the API returns for both).
   * Expected: The message is shown instead of any details, so nothing stale or partial
   *           is displayed.
   * Type:     error
   */
  it('US39-F04 (AC1): shows the error when the event cannot be viewed', async () => {
    mockApi({ eventError: 'Event not found' });
    renderAs('EVENT_ORGANISER', 1);
    expect(await screen.findByText('Event not found')).toBeInTheDocument();
    expect(screen.queryByText('Attendance:')).not.toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-39 AC1 + AC2 (error side)
   * Scenario: The event loads but its equipment requests can't be loaded.
   * Setup:    Coordinator on a Planning event; GET /api/events/3/equipment-requests fails
   *           with "Server unavailable"; everything else succeeds.
   * Expected: The other details (attendance, venue booking) are still shown, and the
   *           equipment card says the requests couldn't be loaded, instead of the whole page
   *           failing or wrongly claiming nothing was requested.
   * Type:     error
   */
  it('US39-F05 (AC1+AC2): an equipment loading failure does not hide the event details', async () => {
    mockApi({ equipmentError: 'Server unavailable' });
    renderAs('EVENT_COORDINATOR');
    expect(await screen.findByText('Leadership Forum')).toBeInTheDocument();
    expect(screen.getByText('Attendance:').parentElement).toHaveTextContent('Attendance: 120');
    expect(screen.getByText('Helix Hall')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Equipment requests could not be loaded: Server unavailable')).toBeInTheDocument();
    // An empty list here would wrongly tell staff that no equipment is needed.
    expect(screen.queryByText('No equipment requested yet.')).not.toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-39 AC2
   * Scenario: The equipment reply comes back without a requests list.
   * Setup:    Coordinator; GET /api/events/3/equipment-requests returns {}; everything else
   *           as normal.
   * Expected: The card shows "No equipment requested yet." and the rest of the page loads.
   * Type:     boundary
   */
  it('US39-F06 (AC2): a reply without a requests list shows the empty message', async () => {
    mockApi();
    const normal = api.getMockImplementation();
    api.mockImplementation(async (path) => (path === '/api/events/3/equipment-requests' ? {} : normal(path)));
    renderAs('EVENT_COORDINATOR');
    expect(await screen.findByText('Leadership Forum')).toBeInTheDocument();
    expect(screen.getByText('No equipment requested yet.')).toBeInTheDocument();
  });
});

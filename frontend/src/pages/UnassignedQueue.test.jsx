import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import Layout from '../components/Layout';
import EventDetail from './EventDetail';
import UnassignedQueue from './UnassignedQueue';

jest.mock('../api', () => ({
  api: jest.fn(),
}));

jest.mock('../auth', () => {
  const original = jest.requireActual('../auth');
  return {
    ...original,
    useAuth: jest.fn(),
  };
});

const leadUser = {
  id: 9,
  fullName: 'Ivy Chen',
  email: 'lead@connectsphere.sg',
  roles: ['EVENT_COORDINATOR_LEAD'],
  organisationId: null,
};

const queuedEvent = {
  id: 11,
  name: 'Town Hall',
  purpose: 'Quarterly update',
  description: 'All-hands meeting for the team.',
  status: 'SUBMITTED',
  organiserId: 1,
  coordinatorId: null,
  organiserName: 'Aisha Rahman',
  organisationName: 'Acme',
  coordinatorName: null,
  startAt: '2026-10-01T10:00:00.000Z',
  endAt: '2026-10-01T11:00:00.000Z',
  expectedAttendance: 50,
  venueRequirements: 'Projector and stage',
  equipmentNotes: 'Two wireless mics',
  accessibilityNeeds: 'None',
  layoutPreference: 'THEATRE',
  category: 'MEETING',
};

function asLead() {
  useAuth.mockReturnValue({
    user: leadUser,
    hasRole: (...roles) => roles.some((role) => leadUser.roles.includes(role)),
    logout: jest.fn(),
  });
}

function renderQueue(path = '/app/events/unassigned') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/app" element={<Layout />}>
          <Route path="events/unassigned" element={<UnassignedQueue />} />
          <Route path="events/:id" element={<EventDetail />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('SCRUM-65 Unassigned queue (Lead)', () => {
  beforeEach(() => {
    api.mockReset();
    asLead();
  });

  /*
   * AC: SCRUM-65 AC1, AC4
   * Scenario: The Lead opens the unassigned queue and two Submitted unassigned requests are waiting.
   * Setup: GET /api/events/unassigned-queue returns two complete queued events from different organisers.
   * Expected: Both names appear, and each row shows organiser, date/time, attendance, venue and equipment.
   * Type: normal
   */
  it('AC1/AC4: shows every queued request with name, organiser, date/time, attendance, venue and equipment', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/events/unassigned-queue') {
        return Promise.resolve({
          events: [
            queuedEvent,
            {
              ...queuedEvent,
              id: 12,
              name: 'Apex Kickoff',
              organiserName: 'Ben Tan',
              startAt: '2026-11-02T02:00:00.000Z',
              endAt: '2026-11-02T04:00:00.000Z',
              expectedAttendance: 80,
              venueRequirements: 'Boardroom',
              equipmentNotes: 'HDMI cable',
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    renderQueue();

    expect(await screen.findByRole('heading', { name: /unassigned queue/i })).toBeInTheDocument();
    expect(screen.getByText('Town Hall')).toBeInTheDocument();
    expect(screen.getByText('Aisha Rahman')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('Projector and stage')).toBeInTheDocument();
    expect(screen.getByText('Two wireless mics')).toBeInTheDocument();
    expect(screen.getByText('Apex Kickoff')).toBeInTheDocument();
    expect(screen.getByText('Ben Tan')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('Boardroom')).toBeInTheDocument();
    expect(screen.getByText('HDMI cable')).toBeInTheDocument();
    expect(screen.getByText(
      `${new Date(queuedEvent.startAt).toLocaleString()} – ${new Date(queuedEvent.endAt).toLocaleString()}`
    )).toBeInTheDocument();
    expect(screen.getByText(
      `${new Date('2026-11-02T02:00:00.000Z').toLocaleString()} – ${new Date('2026-11-02T04:00:00.000Z').toLocaleString()}`
    )).toBeInTheDocument();
    expect(screen.getByText(/date\/time/i)).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/api/events/unassigned-queue');
  });

  /*
   * AC: SCRUM-65 AC2, AC3
   * Scenario: The API is the source of queue membership; assigned and draft rows are not returned.
   * Setup: The queue payload contains only the Submitted unassigned request (assigned and drafts are omitted).
   * Expected: Town Hall is listed; names that belong to assigned or draft requests never appear.
   * Type: boundary
   */
  it('AC2/AC3: assigned and draft requests are not shown in the queue', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/events/unassigned-queue') {
        return Promise.resolve({ events: [queuedEvent] });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    renderQueue();

    expect(await screen.findByText('Town Hall')).toBeInTheDocument();
    expect(screen.queryByText('Already Assigned')).not.toBeInTheDocument();
    expect(screen.queryByText('Still a Draft')).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-65 AC1
   * Scenario: The queue API succeeds but omits the events array.
   * Setup: Response is `{}` so `data.events` is undefined.
   * Expected: Same empty queue as `events: []` — the page must not crash.
   * Type: boundary
   */
  it('AC1: treats a missing events array as an empty queue', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/events/unassigned-queue') {
        return Promise.resolve({});
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    renderQueue();

    expect(await screen.findByText(/no submitted requests are waiting for a coordinator/i)).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-65 AC1
   * Scenario: The Lead opens the queue when nothing is waiting.
   * Setup: API returns an empty events array.
   * Expected: Empty-state copy, not a broken table.
   * Type: boundary
   */
  it('AC1: shows an empty state when no requests are waiting', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/events/unassigned-queue') {
        return Promise.resolve({ events: [] });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    renderQueue();

    expect(await screen.findByText(/no submitted requests are waiting for a coordinator/i)).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-65 AC1
   * Scenario: The queue API fails while the Lead is viewing it.
   * Setup: GET /api/events/unassigned-queue rejects.
   * Expected: The error message is shown instead of pretending the queue is empty.
   * Type: error
   */
  it('AC1: shows an error when the queue cannot be loaded', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/events/unassigned-queue') {
        return Promise.reject(new Error('Queue unavailable'));
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    renderQueue();

    expect(await screen.findByText('Queue unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/no submitted requests are waiting/i)).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC3, AC7
   * Scenario: A blocked (non-Lead) request reaches the page anyway.
   * Setup: API returns 403 with only a message, no events array.
   * Expected: The message is shown and no event names are rendered as links.
   * Type: error
   */
  it('shows the refusal and no event details when the queue is blocked', async () => {
    const err = new Error('You do not have access to this action');
    err.status = 403;
    api.mockRejectedValue(err);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UnassignedQueue />
      </MemoryRouter>
    );
    expect(await screen.findByText('You do not have access to this action')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-65 AC4
   * Scenario: A queued request has no equipment notes and a missing organiser name.
   * Setup: equipmentNotes is null, organiserName is null; other AC4 fields are present.
   * Expected: Those cells show an em dash so the columns still exist.
   * Type: boundary
   */
  it('AC4: blank organiser or equipment needs still show the columns', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/events/unassigned-queue') {
        return Promise.resolve({
          events: [{
            ...queuedEvent,
            organiserName: null,
            equipmentNotes: null,
            startAt: null,
            endAt: null,
            expectedAttendance: null,
            venueRequirements: '   ',
          }],
        });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    renderQueue();

    expect(await screen.findByText('Town Hall')).toBeInTheDocument();
    expect(screen.getByText('TBC')).toBeInTheDocument();
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });

  /*
   * AC: SCRUM-65 AC5
   * Scenario: The Lead clicks a queued request to read the full details.
   * Setup: Queue returns Town Hall; EventDetail APIs return the same event plus empty planning lists.
   * Expected: The event name is a link to /app/events/11 and the detail page shows description, when, attendance, venue and equipment.
   * Type: normal
   */
  it('AC5: opening a queued request shows its full details', async () => {
    const user = userEvent.setup();
    api.mockImplementation((path) => {
      if (path === '/api/events/unassigned-queue') {
        return Promise.resolve({ events: [queuedEvent] });
      }
      if (path === '/api/events/11') return Promise.resolve({ event: queuedEvent });
      if (path === '/api/events/11/history') return Promise.resolve({ history: [] });
      if (path === '/api/comments/11') return Promise.resolve({ comments: [] });
      if (path === '/api/venues') return Promise.resolve({ venues: [] });
      if (path === '/api/events/11/venue-bookings') return Promise.resolve({ bookings: [] });
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    renderQueue();

    const link = await screen.findByRole('link', { name: 'Town Hall' });
    expect(link).toHaveAttribute('href', '/app/events/11');
    await user.click(link);

    expect(await screen.findByRole('heading', { name: 'Town Hall' })).toBeInTheDocument();
    expect(screen.getByText('All-hands meeting for the team.')).toBeInTheDocument();
    expect(screen.getByText(/attendance:/i)).toBeInTheDocument();
    expect(screen.getByText(/venue needs:/i)).toBeInTheDocument();
    expect(screen.getByText('Projector and stage')).toBeInTheDocument();
    expect(screen.getByText(/equipment:/i)).toBeInTheDocument();
    expect(screen.getByText('Two wireless mics')).toBeInTheDocument();
    expect(screen.getByText(/organiser:/i)).toBeInTheDocument();
    expect(screen.getByText('Aisha Rahman')).toBeInTheDocument();
    expect(screen.getByText(/coordinator:/i).closest('p')).toHaveTextContent('Unassigned');
  });

  /*
   * AC: SCRUM-65 AC1
   * Scenario: The Lead looks at the sidebar.
   * Setup: Layout is rendered for EVENT_COORDINATOR_LEAD.
   * Expected: An Unassigned queue link to /app/events/unassigned is present so they can open the queue.
   * Type: normal
   */
  it('AC1: the Lead nav includes Unassigned queue', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/events/unassigned-queue') {
        return Promise.resolve({ events: [] });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    renderQueue();

    const navLink = await screen.findByRole('link', { name: /unassigned queue/i });
    expect(navLink).toHaveAttribute('href', '/app/events/unassigned');
  });

  /*
   * AC: SCRUM-65 AC4
   * Scenario: Date/time is shown when only a start exists (end missing).
   * Setup: startAt set, endAt null.
   * Expected: A formatted start is shown, not TBC, because a start time exists.
   * Type: boundary
   */
  it('AC4: date/time shows the start when the end is missing', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/events/unassigned-queue') {
        return Promise.resolve({
          events: [{ ...queuedEvent, endAt: null }],
        });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    renderQueue();

    await screen.findByText('Town Hall');
    expect(screen.queryByText('TBC')).not.toBeInTheDocument();
    expect(screen.getByText(new Date(queuedEvent.startAt).toLocaleString())).toBeInTheDocument();
  });
});

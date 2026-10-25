/**
 * SCRUM-34: organiser requests a change on the event page.
 * SCRUM-35: assigned coordinator approves or rejects it.
 * SCRUM-69 AC2: approve 400 (invalid requested values) is shown on the page.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from '../../src/pages/EventDetail';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

const EVENT = {
  id: 3,
  organiserId: 1,
  coordinatorId: 2,
  name: 'Leadership Forum',
  status: 'PLANNING',
  startAt: '2026-11-10T09:00:00.000Z',
  endAt: '2026-11-10T17:00:00.000Z',
  expectedAttendance: 40,
  venueRequirements: 'Lecture theatre',
  equipmentNotes: '2 mics',
};

const PENDING = {
  id: 50,
  status: 'PENDING',
  startAt: '2026-11-20T09:00:00.000Z',
  endAt: '2026-11-20T17:00:00.000Z',
  expectedAttendance: 80,
  venueRequirements: 'Banquet',
  equipmentNotes: '4 mics',
};

function mockApi({ event = EVENT, changeRequests = [], onCreate, onDecide, decideError } = {}) {
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/api/events/3') return { event };
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [] };
    if (path === '/api/events/3/equipment-requests') return { requests: [] };
    if (path === '/api/events/3/change-requests' && options.method === 'POST') {
      if (onCreate) onCreate(options.body);
      return { changeRequest: { id: 50, status: 'PENDING', ...options.body } };
    }
    if (path === '/api/events/3/change-requests') return { changeRequests };
    if (path === '/api/events/3/change-requests/50/decision' && options.method === 'POST') {
      if (decideError) {
        const err = new Error(decideError);
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      if (onDecide) onDecide(options.body);
      return {
        changeRequest: {
          id: 50,
          status: options.body.approve ? 'APPROVED' : 'REJECTED',
          decisionReason: options.body.reason || null,
        },
      };
    }
    throw new Error(`Unexpected ${path}`);
  });
}

function renderAs(user) {
  useAuth.mockReturnValue({
    user,
    hasRole: (...roles) => roles.some((role) => (user.roles || []).includes(role)),
  });
  render(
    <MemoryRouter initialEntries={['/app/events/3']}>
      <Routes>
        <Route path="/app/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SCRUM-34 organiser change request form', () => {
  /*
   * AC:       SCRUM-34 AC1 + AC2
   * Scenario: Organiser on a Planning event with an assigned coordinator submits permitted fields.
   * Setup:    datetime-local start/end plus attendance, venue and equipment notes.
   * Expected: POST includes ISO start/end and the other permitted fields only.
   * Type:     normal
   */
  // SCRUM-34-TC19
  it('US34-F01 (AC1+AC2): organiser submits date, attendance, venue and equipment changes', async () => {
    let posted = null;
    mockApi({ onCreate: (body) => { posted = body; } });
    renderAs({ id: 1, roles: ['EVENT_ORGANISER'] });
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Request a change' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Proposed start'), { target: { value: '2026-11-20T09:00' } });
    fireEvent.change(screen.getByLabelText('Proposed end'), { target: { value: '2026-11-20T17:00' } });
    await user.type(screen.getByLabelText('Proposed attendance'), '80');
    await user.type(screen.getByLabelText('Proposed venue requirements'), 'Banquet');
    await user.type(screen.getByLabelText('Proposed equipment requirements'), '4 mics');
    await user.click(screen.getByRole('button', { name: 'Submit change request' }));

    expect(posted).toEqual({
      startAt: new Date('2026-11-20T09:00').toISOString(),
      endAt: new Date('2026-11-20T17:00').toISOString(),
      expectedAttendance: 80,
      venueRequirements: 'Banquet',
      equipmentNotes: '4 mics',
    });
    expect(api).toHaveBeenCalledWith('/api/events/3/change-requests', {
      method: 'POST',
      body: posted,
    });
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Organiser opens a Draft — they should edit the draft, not file a change request.
   * Setup:    status DRAFT, assigned coordinator still present on the fixture.
   * Expected: The change-request form is not shown.
   * Type:     negative
   */
  // SCRUM-34-TC20
  it('US34-F02 (AC1): draft events do not offer a change request form', async () => {
    mockApi({ event: { ...EVENT, status: 'DRAFT' } });
    renderAs({ id: 1, roles: ['EVENT_ORGANISER'] });
    expect(await screen.findByText('Leadership Forum')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Request a change' })).not.toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Submitted event still has no coordinator.
   * Setup:    status SUBMITTED, coordinatorId null.
   * Expected: No change-request form until a coordinator is assigned.
   * Type:     negative
   */
  // SCRUM-34-TC21
  it('US34-F03 (AC1): unassigned submitted events do not offer a change request form', async () => {
    mockApi({ event: { ...EVENT, status: 'SUBMITTED', coordinatorId: null } });
    renderAs({ id: 1, roles: ['EVENT_ORGANISER'] });
    expect(await screen.findByText('Leadership Forum')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Request a change' })).not.toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: Confirmed event — organiser still requests a change rather than editing directly.
   * Setup:    status CONFIRMED, coordinator assigned.
   * Expected: The form is shown.
   * Type:     normal
   */
  // SCRUM-34-TC22
  it('US34-F04 (AC1): confirmed events still offer a change request form', async () => {
    mockApi({ event: { ...EVENT, status: 'CONFIRMED' } });
    renderAs({ id: 1, roles: ['EVENT_ORGANISER'] });
    expect(await screen.findByRole('heading', { name: 'Request a change' })).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-34 AC1
   * Scenario: A PENDING change request already exists.
   * Setup:    GET change-requests returns one PENDING row.
   * Expected: The form is hidden (one pending at a time); the list is shown instead.
   * Type:     negative
   */
  // SCRUM-34-TC23
  it('US34-F05 (AC1): pending request hides the organiser form', async () => {
    mockApi({ changeRequests: [PENDING] });
    renderAs({ id: 1, roles: ['EVENT_ORGANISER'] });
    expect(await screen.findByRole('heading', { name: 'Change requests' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Request a change' })).not.toBeInTheDocument();
  });
});

describe('SCRUM-35 coordinator decide on the event page', () => {
  /*
   * AC:       SCRUM-35 AC1 + AC2
   * Scenario: Assigned coordinator approves the pending request.
   * Setup:    GET returns PENDING with proposed attendance 80.
   * Expected: POST decision { approve: true }.
   * Type:     normal
   */
  it('US35-F01 (AC1+AC2): assigned coordinator can approve a pending change', async () => {
    let decided = null;
    mockApi({
      changeRequests: [PENDING],
      onDecide: (body) => { decided = body; },
    });
    renderAs({ id: 2, roles: ['EVENT_COORDINATOR'] });
    const user = userEvent.setup();

    expect(await screen.findByText('Proposed attendance: 80')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Request a change' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve change' }));
    expect(decided).toEqual({ approve: true });
  });

  /*
   * AC:       SCRUM-35 AC2 + AC3
   * Scenario: Assigned coordinator rejects with an optional reason.
   * Setup:    Same PENDING row; reason typed.
   * Expected: POST { approve: false, reason } so the decision is recorded.
   * Type:     normal
   */
  it('US35-F02 (AC2): assigned coordinator can reject with an optional reason', async () => {
    let decided = null;
    mockApi({
      changeRequests: [PENDING],
      onDecide: (body) => { decided = body; },
    });
    renderAs({ id: 2, roles: ['EVENT_COORDINATOR'] });
    const user = userEvent.setup();

    await screen.findByRole('button', { name: 'Reject change' });
    await user.type(screen.getByLabelText('Reject reason (optional)'), 'Hall already booked');
    await user.click(screen.getByRole('button', { name: 'Reject change' }));
    expect(decided).toEqual({ approve: false, reason: 'Hall already booked' });
  });

  /*
   * AC:       SCRUM-35 AC1
   * Scenario: Another coordinator opens the event.
   * Setup:    user 9; event assigned to 2. The page does not fetch CRs for them.
   * Expected: No approve/reject change buttons (API would 403).
   * Type:     security
   */
  /*
   * AC:       SCRUM-69 AC2
   * Scenario: Assigned coordinator approves, but the API refuses invalid requested values.
   * Setup:    Decision POST throws VALIDATION_ERROR with the server message (start in the past).
   * Expected: That message is shown in the page alert so the coordinator sees why approve failed.
   * Type:     error
   */
  it('US36-F01 (AC2): approve error from the API is shown on the event page', async () => {
    mockApi({
      changeRequests: [PENDING],
      decideError: 'A change request cannot be approved with a start date/time in the past',
    });
    renderAs({ id: 2, roles: ['EVENT_COORDINATOR'] });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Approve change' }));
    expect(await screen.findByText(
      'A change request cannot be approved with a start date/time in the past'
    )).toBeInTheDocument();
  });

  it('US35-F03 (AC1): another coordinator does not see decide actions', async () => {
    mockApi({ changeRequests: [PENDING] });
    renderAs({ id: 9, roles: ['EVENT_COORDINATOR'] });
    expect(await screen.findByText('Leadership Forum')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Change requests' })).not.toBeInTheDocument();
  });
});

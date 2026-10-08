import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../auth';
import { api } from '../api';
import EventDetail from './EventDetail';

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
  id: 11,
  fullName: 'Ivy Tan',
  email: 'lead@connectsphere.sg',
  roles: ['EVENT_COORDINATOR_LEAD'],
  organisationId: null,
};

const coordinatorUser = {
  id: 2,
  fullName: 'Chloe Lim',
  email: 'coordinator@connectsphere.sg',
  roles: ['EVENT_COORDINATOR'],
  organisationId: null,
};

function mockAuth(sessionUser) {
  useAuth.mockReturnValue({
    user: sessionUser,
    hasRole: (...roles) => roles.some((role) => sessionUser.roles.includes(role)),
  });
}

function submittedUnassigned() {
  return {
    id: 3,
    name: 'Workshop',
    purpose: 'Learn',
    description: 'A workshop',
    status: 'SUBMITTED',
    coordinatorId: null,
    organiserId: 1,
    organisationName: 'Acme Holdings',
    category: 'WORKSHOP',
  };
}

function stubApi(sessionUser, eventData, extras = {}) {
  api.mockImplementation((path, options = {}) => {
    if (path === '/api/auth/me') return Promise.resolve({ user: sessionUser });
    if (path === '/api/events/3') return Promise.resolve({ event: eventData });
    if (path === '/api/events/3/history') return Promise.resolve({ history: [] });
    if (path === '/api/comments/3') return Promise.resolve({ comments: [] });
    if (path === '/api/venues') return Promise.resolve({ venues: [] });
    if (path === '/api/events/3/venue-bookings') return Promise.resolve({ bookings: [] });
    if (path === '/api/events/assignable-coordinators') {
      return Promise.resolve({
        coordinators: extras.coordinators || [
          { id: 2, fullName: 'Chloe Lim' },
          { id: 4, fullName: 'Daniel Ong' },
        ],
      });
    }
    if (path === '/api/events/3/assign-coordinator' && options.method === 'POST') {
      extras.assigned = options.body;
      return Promise.resolve({
        event: { ...eventData, coordinatorId: options.body.coordinatorId, status: 'UNDER_REVIEW' },
      });
    }
    return Promise.reject(new Error(`Unhandled api: ${path}`));
  });
}

function renderEvent() {
  return render(
    <MemoryRouter initialEntries={['/app/events/3']}>
      <AuthProvider>
        <Routes>
          <Route path="/app/events/:id" element={<EventDetail />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('SCRUM-71 assign coordinator (event page)', () => {
  beforeEach(() => {
    api.mockReset();
  });

  /*
   * AC: SCRUM-71 AC1, AC2
   * Scenario: A Lead opens a Submitted event that has no Coordinator.
   * Setup: Session is Lead. Event 3 is SUBMITTED with coordinatorId null. API lists two active Coordinators.
   * Expected: The assign card is shown and both active Coordinators are in the dropdown.
   * Type: normal
   */
  it('US71-F01: a Lead sees active Coordinators to assign on a Submitted unassigned event', async () => {
    mockAuth(leadUser);
    stubApi(leadUser, submittedUnassigned());
    renderEvent();

    expect(await screen.findByRole('heading', { name: /assign coordinator/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Chloe Lim' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Daniel Ong' })).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-71 AC1, AC3
   * Scenario: The Lead picks Chloe and submits.
   * Setup: Same Submitted unassigned event. Dropdown value 2.
   * Expected: POST /api/events/3/assign-coordinator with coordinatorId 2.
   * Type: normal
   */
  it('US71-F02: a Lead assigns the chosen Coordinator', async () => {
    const user = userEvent.setup();
    const extras = {};
    mockAuth(leadUser);
    stubApi(leadUser, submittedUnassigned(), extras);
    renderEvent();

    await screen.findByRole('heading', { name: /assign coordinator/i });
    await user.selectOptions(screen.getByLabelText(/coordinator/i), '2');
    await user.click(screen.getByRole('button', { name: /assign coordinator/i }));

    await waitFor(() => {
      expect(extras.assigned).toEqual({ coordinatorId: 2 });
    });
  });

  /*
   * AC: SCRUM-71 AC6
   * Scenario: A Coordinator opens the same Submitted unassigned event.
   * Setup: Session role is EVENT_COORDINATOR only.
   * Expected: No assign card. They cannot assign.
   * Type: error
   */
  it('US71-F03: a Coordinator does not see the assign action', async () => {
    mockAuth(coordinatorUser);
    stubApi(coordinatorUser, submittedUnassigned());
    renderEvent();

    expect(await screen.findByText('Workshop')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /assign coordinator/i })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-71 AC5
   * Scenario: A Lead opens an event that already has a Coordinator.
   * Setup: Event is still SUBMITTED but coordinatorId is already 2, so AC1 status is not what hides the card.
   * Expected: The assign card is hidden. Changing the Coordinator is reassignment, not this action.
   * Type: conflict
   */
  it('US71-F04: a Lead cannot assign through this action when the event already has a Coordinator', async () => {
    mockAuth(leadUser);
    stubApi(leadUser, { ...submittedUnassigned(), status: 'SUBMITTED', coordinatorId: 2 });
    renderEvent();

    expect(await screen.findByText('Workshop')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /assign coordinator/i })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-71 AC1
   * Scenario: A Lead opens a Draft that has no Coordinator.
   * Setup: status DRAFT, coordinatorId null.
   * Expected: The assign card is hidden. Only Submitted unassigned events can be assigned.
   * Type: error
   */
  it('US71-F05: a Lead cannot assign a Coordinator on a Draft', async () => {
    mockAuth(leadUser);
    stubApi(leadUser, { ...submittedUnassigned(), status: 'DRAFT' });
    renderEvent();

    expect(await screen.findByText('Workshop')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /assign coordinator/i })).not.toBeInTheDocument();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../../src/auth';
import { api } from '../../src/api';
import EventDetail from '../../src/pages/EventDetail';

jest.mock('../../src/api', () => ({
  api: jest.fn(),
}));

jest.mock('../../src/auth', () => {
  const original = jest.requireActual('../../src/auth');
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

function assignedEvent(status = 'UNDER_REVIEW') {
  return {
    id: 3,
    name: 'Leadership Forum',
    purpose: 'Plan',
    description: 'A forum',
    status,
    coordinatorId: 2,
    coordinatorName: 'Chloe Lim',
    organiserId: 1,
    organisationName: 'Acme Holdings',
    category: 'CONFERENCE',
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
    if (path === '/api/events/3/equipment-requests') return Promise.resolve({ requests: [] });
    if (path === '/api/events/assignable-coordinators') {
      return Promise.resolve({
        coordinators: [
          { id: 2, fullName: 'Chloe Lim' },
          { id: 4, fullName: 'Daniel Ong' },
        ],
      });
    }
    if (path === '/api/events/3/reassign-coordinator' && options.method === 'POST') {
      extras.posted = options.body;
      if (options.body.coordinatorId === eventData.coordinatorId) {
        return Promise.reject(new Error('This Coordinator is already assigned to the event'));
      }
      return Promise.resolve({
        event: { ...eventData, coordinatorId: options.body.coordinatorId, coordinatorName: 'Daniel Ong' },
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

describe('SCRUM-31 reassign coordinator (event page)', () => {
  beforeEach(() => {
    api.mockReset();
  });

  /*
   * AC: SCRUM-31 AC1
   * Scenario: A Lead opens an event that already has a Coordinator, including a finished one.
   * Setup: Session is a Lead. Event 3 is COMPLETED and held by Chloe (id 2). The active
   *   Coordinator list contains Chloe and Daniel. Completed is used because reassignment
   *   is allowed in any status (Shiyin, 24 Oct 2026).
   * Expected: The reassign card lists both active Coordinators.
   * Type: boundary
   */
  it('US31-F01: a Lead sees active Coordinators on an event that already has one', async () => {
    mockAuth(leadUser);
    stubApi(leadUser, assignedEvent('COMPLETED'));
    renderEvent();

    expect(await screen.findByRole('heading', { name: /^reassign$/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Chloe Lim' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Daniel Ong' })).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-31 AC1. The record update itself is US31-B01 and US31-R01, not this test.
   * Scenario: The Lead picks Daniel and confirms.
   * Setup: Event 3 is UNDER_REVIEW, held by Chloe. The dropdown value is 4.
   * Expected: POST /api/events/3/reassign-coordinator with coordinatorId 4.
   * Type: normal
   */
  it('US31-F02: a Lead reassigns the chosen Coordinator', async () => {
    const user = userEvent.setup();
    const extras = {};
    mockAuth(leadUser);
    stubApi(leadUser, assignedEvent(), extras);
    renderEvent();

    await screen.findByRole('heading', { name: /^reassign$/i });
    await user.selectOptions(screen.getByLabelText(/^coordinator$/i), '4');
    await user.click(screen.getByRole('button', { name: /reassign coordinator/i }));

    await waitFor(() => {
      expect(extras.posted).toEqual({ coordinatorId: 4 });
    });
  });

  /*
   * AC: SCRUM-31 AC4
   * Scenario: The Lead confirms the Coordinator who is already on the event.
   * Setup: Event 3 is held by Chloe (id 2). The Lead selects Chloe. The API rejects that id.
   * Expected: The page shows the rejection text, and the post body is coordinatorId 2.
   *   The unchanged event record is US31-B03 and US31-R02. This test does not read it.
   * Type: boundary
   */
  it('US31-F03: choosing the Coordinator already assigned shows the rejection', async () => {
    const user = userEvent.setup();
    const extras = {};
    mockAuth(leadUser);
    stubApi(leadUser, assignedEvent(), extras);
    renderEvent();

    await screen.findByRole('heading', { name: /^reassign$/i });
    await user.selectOptions(screen.getByLabelText(/^coordinator$/i), '2');
    await user.click(screen.getByRole('button', { name: /reassign coordinator/i }));

    expect(await screen.findByText('This Coordinator is already assigned to the event')).toBeInTheDocument();
    expect(extras.posted).toEqual({ coordinatorId: 2 });
  });

  /*
   * AC: SCRUM-31 AC1
   * Scenario: The assigned Coordinator opens the same event.
   * Setup: Session role is EVENT_COORDINATOR only. Event 3 is held by that user.
   *   The server refusal for a non-Lead is SCRUM-33; this checks the control is not offered.
   * Expected: The reassign card is absent.
   * Type: error
   */
  it('US31-F04: a Coordinator does not see the reassign action', async () => {
    mockAuth(coordinatorUser);
    stubApi(coordinatorUser, assignedEvent());
    renderEvent();

    expect(await screen.findByText('Leadership Forum')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^reassign$/i })).not.toBeInTheDocument();
  });
});

/**
 * SCRUM-42 AC2: EventDetail shows "Requires review" on flagged venue bookings and
 * equipment requests. The existing status badge is unchanged.
 * SCRUM-42 AC3: unflagged / non-critical rows do not show the label.
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
  equipmentNotes: '2 projectors',
};

function mockApi({ bookings, requests }) {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') return { event: EVENT };
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings };
    if (path === '/api/events/3/equipment-requests') return { requests };
    if (path === '/api/events/3/change-requests') return { changeRequests: [] };
    throw new Error(`Unexpected ${path}`);
  });
}

function renderCoordinator() {
  useAuth.mockReturnValue({
    user: { id: 21 },
    hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
  });
  render(
    <MemoryRouter initialEntries={['/app/events/3']}>
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SCRUM-42 Requires review on EventDetail', () => {
  /*
   * AC:       SCRUM-42 AC2
   * Scenario: A flagged approved booking and a flagged pending equipment request.
   * Setup:    Coordinator; booking needs_review true, status APPROVED; equipment
   *           needs_review true, status PENDING.
   * Expected: "Requires review" is shown; "Approved" / "PENDING" stay visible.
   * Type:     normal
   */
  it('AC3: flagged rows show Requires review next to the unchanged status', async () => {
    mockApi({
      bookings: [{
        id: 7, venue_id: 8, venue_name: 'Helix Hall', status: 'APPROVED', needs_review: true,
        start_at: EVENT.startAt, end_at: EVENT.endAt, setup_minutes: 0, teardown_minutes: 0,
      }],
      requests: [{
        id: 12, equipment_id: 4, equipment_name: 'Projector', quantity: 2, status: 'PENDING', needs_review: true,
      }],
    });
    renderCoordinator();

    expect(await screen.findByText('Helix Hall')).toBeInTheDocument();
    expect(screen.getAllByText('Requires review')).toHaveLength(2);
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Projector × 2: PENDING')).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-42 AC3
   * Scenario: Rows that are not flagged.
   * Setup:    Coordinator; needs_review false / omitted.
   * Expected: Status is shown; "Requires review" is not.
   * Type:     boundary
   */
  it('AC3: unflagged rows do not show Requires review', async () => {
    mockApi({
      bookings: [{ id: 7, venue_id: 8, venue_name: 'Helix Hall', status: 'APPROVED', needs_review: false }],
      requests: [{ id: 12, equipment_id: 4, equipment_name: 'Projector', quantity: 2, status: 'PENDING' }],
    });
    renderCoordinator();

    expect(await screen.findByText('Helix Hall')).toBeInTheDocument();
    expect(screen.queryByText('Requires review')).not.toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Projector × 2: PENDING')).toBeInTheDocument();
  });
});

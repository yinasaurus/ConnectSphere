/**
 * SCRUM-30 AC3: once a Coordinator is assigned, the event page no longer says Unassigned.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from '../../src/pages/EventDetail';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

/*
 * AC: SCRUM-30 AC3
 * Scenario: The organiser opens the event after the Lead has assigned a Coordinator.
 * Setup: Status UNDER_REVIEW, coordinatorId 2, coordinatorName Chloe Lim. Organiser owns the event.
 * Expected: People shows Chloe Lim. The word Unassigned is not on the page.
 * Type: normal
 */
// SCRUM-30-TC15
it('US30-F07: an assigned event shows the Coordinator name instead of Unassigned', async () => {
  useAuth.mockReturnValue({
    user: { id: 1, fullName: 'Aisha Rahman' },
    hasRole: (...roles) => roles.includes('EVENT_ORGANISER'),
  });
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') {
      return {
        event: {
          id: 3,
          name: 'Town Hall',
          status: 'UNDER_REVIEW',
          organiserId: 1,
          organiserName: 'Aisha Rahman',
          coordinatorId: 2,
          coordinatorName: 'Chloe Lim',
        },
      };
    }
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [] };
    if (path === '/api/events/3/equipment-requests') return { requests: [] };
    if (path === '/api/events/3/change-requests') return { changeRequests: [] };
    if (path === '/api/events/3/registrations') return { registrations: [] };
    return {};
  });

  render(
    <MemoryRouter initialEntries={['/app/events/3']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/app/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>
  );

  expect(await screen.findByText('Chloe Lim')).toBeInTheDocument();
  expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
});

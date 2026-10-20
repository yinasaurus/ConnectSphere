/**
 * SCRUM-40: NewEvent edit route refuses Confirmed (and closed) events for the assigned Coord.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import NewEvent from './NewEvent';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const CONFIRMED_EVENT = {
  id: 3,
  name: 'Confirmed workshop',
  status: 'CONFIRMED',
  organiserId: 1,
  coordinatorId: 2,
  purpose: 'Learn',
  description: 'A workshop',
  startAt: '2026-11-20T10:00:00Z',
  endAt: '2026-11-20T12:00:00Z',
  expectedAttendance: 40,
};

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({
    user: { id: 2, roles: ['EVENT_COORDINATOR'] },
    hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
  });
  api.mockImplementation(async (path) => {
    if (path === '/api/events') return { events: [] };
    if (path === '/api/events/3') return { event: CONFIRMED_EVENT };
    throw new Error(`Unexpected ${path}`);
  });
});

/*
 * AC:       SCRUM-40 AC3 / product 2A
 * Scenario: Assigned Coordinator opens /app/events/:id/edit on a Confirmed event.
 * Setup:    coordinatorId matches session; status CONFIRMED.
 * Expected: Form is not shown; locked message mentions change requests.
 * Type:     error / UI lock
 */
it('US40-F03 (AC3/2A): Confirmed edit URL shows the locked message instead of the form', async () => {
  render(
    <MemoryRouter
      initialEntries={['/app/events/3/edit']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/app/events/:id/edit" element={<NewEvent />} />
      </Routes>
    </MemoryRouter>
  );

  expect(
    await screen.findByText(/confirmed and closed events cannot be edited directly/i)
  ).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /edit event request/i })).not.toBeInTheDocument();
});

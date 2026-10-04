/**
 * SCRUM-5: the coordinator's "Needs attention" count covers the statuses where the
 * coordinator has the next step (Submitted, Under Review, Approved, Planning).
 */
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const STATUSES = [
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PLANNING', 'AWAITING_SAFETY_CHECK',
  'PREPARATION', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED',
];

it('US5-F06: "Needs attention" counts only events waiting on the coordinator', async () => {
  const events = STATUSES.map((status, index) => ({ id: index + 1, coordinatorId: 2, name: `Event ${status}`, status }));
  api.mockImplementation(async (path) => (path === '/api/events' ? { events } : { unread: 0 }));
  useAuth.mockReturnValue({
    user: { id: 2, fullName: 'Chloe Tan' },
    hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Dashboard />
    </MemoryRouter>
  );

  await screen.findByText('Event DRAFT');
  const card = screen.getByText('Needs attention').closest('.card');
  expect(card.querySelector('h2').textContent).toBe('4');
});

// AC5 · A status change made elsewhere shows up on the dashboard within 10 seconds, without
// a reload, and the dashboard stops polling once the user leaves it.
it('US5-F07: the dashboard picks up status changes every 10 seconds and stops when closed', async () => {
  jest.useFakeTimers();
  const events = [{ id: 1, coordinatorId: 2, name: 'Live event', status: 'UNDER_REVIEW' }];
  api.mockImplementation(async (path) => (path === '/api/events' ? { events: events.map((e) => ({ ...e })) } : { unread: 0 }));
  useAuth.mockReturnValue({
    user: { id: 2, fullName: 'Chloe Tan' },
    hasRole: (...roles) => roles.includes('EVENT_COORDINATOR'),
  });

  const { unmount } = render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Dashboard />
    </MemoryRouter>
  );
  // Flush the first load without moving the clock (findBy* would advance fake timers).
  await act(async () => {});
  expect(screen.getByText('Under Review')).toBeInTheDocument();

  events[0].status = 'APPROVED';
  await act(async () => { jest.advanceTimersByTime(9999); });
  expect(screen.queryByText('Approved')).not.toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(screen.getByText('Approved')).toBeInTheDocument();

  unmount();
  const callsAfterClose = api.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(api.mock.calls.length).toBe(callsAfterClose);
  jest.useRealTimers();
});

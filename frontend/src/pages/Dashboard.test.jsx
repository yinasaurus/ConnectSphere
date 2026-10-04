/**
 * SCRUM-5: the coordinator's "Needs attention" count covers the statuses where the
 * coordinator has the next step (Submitted, Under Review, Approved, Planning).
 */
import { render, screen } from '@testing-library/react';
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

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventDetail from './EventDetail';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({
  useAuth: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user: { id: 1 }, hasRole: (...roles) => roles.includes('EVENT_ORGANISER') });
});

it('loads an organiser event and its booking without requesting the restricted global queue', async () => {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') return { event: { id: 3, organiserId: 1, name: 'My event', status: 'PLANNING' } };
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [{ id: 7, venue_name: 'Hall', status: 'APPROVED' }] };
    throw new Error('You do not have access to this action');
  });
  render(
    <MemoryRouter initialEntries={['/app/events/3']}>
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
  expect(await screen.findByText('My event')).toBeInTheDocument();
  expect(screen.getByText('Hall: APPROVED')).toBeInTheDocument();
  expect(api).not.toHaveBeenCalledWith('/api/venues/bookings');
});

it('loads an attendee event without requesting restricted planning data', async () => {
  useAuth.mockReturnValue({ user: { id: 8 }, hasRole: (...roles) => roles.includes('ATTENDEE') });
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') return { event: { id: 3, name: 'Public event', status: 'CONFIRMED' } };
    if (path === '/api/events/3/venue-bookings') return { bookings: [] };
    throw new Error('Forbidden planning information');
  });
  render(
    <MemoryRouter initialEntries={['/app/events/3']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes><Route path="/app/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter>
  );
  expect(await screen.findByText('Public event')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();
  expect(screen.queryByText('Discussion')).not.toBeInTheDocument();
  expect(screen.queryByText('Status history')).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalledWith('/api/comments/3');
  expect(api).not.toHaveBeenCalledWith('/api/events/3/history');
});

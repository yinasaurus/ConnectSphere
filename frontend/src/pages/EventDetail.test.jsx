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

/*
 * AC:       SCRUM-39 AC1 + AC2 (test first added with role access in 5dce993, which has no story key)
 * Scenario: The event's own Organiser opens a Planning event.
 * Setup:    Organiser user 1; event 3 owned by user 1; one APPROVED booking at "Hall"; no
 *           equipment requests. Any other path fails, as the API would refuse it.
 * Expected: The event and its booking ("Hall: APPROVED") are shown, and the page never asks
 *           for the global bookings queue, which Organisers aren't allowed to see.
 * Type:     normal
 */
it('loads an organiser event and its booking without requesting the restricted global queue', async () => {
  api.mockImplementation(async (path) => {
    if (path === '/api/events/3') return { event: { id: 3, organiserId: 1, name: 'My event', status: 'PLANNING' } };
    if (path === '/api/events/3/history') return { history: [] };
    if (path === '/api/comments/3') return { comments: [] };
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/events/3/venue-bookings') return { bookings: [{ id: 7, venue_name: 'Hall', status: 'APPROVED' }] };
    // SCRUM-39: the page now also loads the event's equipment requests for planning roles.
    if (path === '/api/events/3/equipment-requests') return { requests: [] };
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

/*
 * AC:       SCRUM-39 AC1 (agreed decision: Attendees keep the public view; test first added
 *           with role access in 5dce993, which has no story key)
 * Scenario: An Attendee opens a Confirmed event.
 * Setup:    Attendee user 8; event 3 Confirmed with no bookings. Any planning path fails
 *           with "Forbidden planning information".
 * Expected: The event and the Register button are shown; no Discussion or Status history;
 *           comments, history and equipment requests are never requested, so a forbidden
 *           call can't break the page or leak planning data.
 * Type:     boundary
 */
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
  // SCRUM-39: attendees don't get planning details, so equipment is never requested.
  expect(api).not.toHaveBeenCalledWith('/api/events/3/equipment-requests');
});

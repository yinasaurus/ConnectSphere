import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Venues from './Venues';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const SEARCH_RESULT_VENUE = {
  id: 1,
  name: 'Helix Hall',
  location: 'ConnectSphere Campus, Level 2',
  capacity: 180,
  facilities: 'Projector, lecture capture, hearing loop, stage',
  accessibility: 'Wheelchair access, accessible washrooms, lift',
  operatingHours: '08:00-22:00',
  setupMinutes: 45,
  teardownMinutes: 30,
  layouts: ['THEATRE', 'CLASSROOM'],
};

function mockApi(searchResponse) {
  api.mockImplementation(async (path) => {
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/venues/bookings') return { bookings: [] };
    if (path.startsWith('/api/venues/search')) return searchResponse;
    throw new Error(`Unexpected call: ${path}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ hasRole: () => false });
});

it('shows name, location, capacity, facilities, accessibility and layouts for each result (AC1-AC4)', async () => {
  mockApi({ venues: [SEARCH_RESULT_VENUE] });
  render(<Venues />);

  await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));

  expect(await screen.findByText('Helix Hall')).toBeInTheDocument();
  expect(screen.getByText('ConnectSphere Campus, Level 2')).toBeInTheDocument();
  expect(screen.getByText('Capacity 180')).toBeInTheDocument();
  expect(screen.getByText('Facilities: Projector, lecture capture, hearing loop, stage')).toBeInTheDocument();
  expect(screen.getByText('Accessibility: Wheelchair access, accessible washrooms, lift')).toBeInTheDocument();
  expect(screen.getByText('THEATRE', { selector: '.pill' })).toBeInTheDocument();
  expect(screen.getByText('CLASSROOM', { selector: '.pill' })).toBeInTheDocument();
});

it('lets the coordinator select a result to view more details, and close it again (AC5)', async () => {
  mockApi({ venues: [SEARCH_RESULT_VENUE] });
  render(<Venues />);

  await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));
  await userEvent.click(await screen.findByRole('button', { name: 'View details' }));

  expect(await screen.findByText('Operating hours: 08:00-22:00')).toBeInTheDocument();
  expect(screen.getByText('Setup time: 45 min · Turnaround time: 30 min')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByText('Operating hours: 08:00-22:00')).not.toBeInTheDocument();
});

it('shows a clear message when no venue matches (AC: no-results)', async () => {
  mockApi({ venues: [] });
  render(<Venues />);

  await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));

  expect(await screen.findByText('No venues match your selected filters.')).toBeInTheDocument();
});

it('always renders whatever the latest search response says, not a stale previous one (AC6)', async () => {
  mockApi({ venues: [SEARCH_RESULT_VENUE] });
  render(<Venues />);

  await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));
  expect(await screen.findByText('Capacity 180')).toBeInTheDocument();

  mockApi({ venues: [{ ...SEARCH_RESULT_VENUE, capacity: 200 }] });
  await userEvent.click(screen.getByRole('button', { name: 'Search venues' }));

  expect(await screen.findByText('Capacity 200')).toBeInTheDocument();
  expect(screen.queryByText('Capacity 180')).not.toBeInTheDocument();
});

it('clears the selected venue detail panel when a new search is run', async () => {
  mockApi({ venues: [SEARCH_RESULT_VENUE] });
  render(<Venues />);

  await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));
  await userEvent.click(await screen.findByRole('button', { name: 'View details' }));
  expect(await screen.findByText('Operating hours: 08:00-22:00')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Search venues' }));
  expect(screen.queryByText('Operating hours: 08:00-22:00')).not.toBeInTheDocument();
});

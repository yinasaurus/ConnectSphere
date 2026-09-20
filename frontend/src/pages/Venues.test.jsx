import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api';
import { useAuth } from '../auth';
import Venues from './Venues';

jest.mock('../api', () => ({
  api: jest.fn(),
}));

jest.mock('../auth', () => ({
  useAuth: jest.fn(),
}));

const database = {
  venues: [{
    id: 1,
    name: 'Helix Hall',
    location: 'ConnectSphere Campus, Level 2',
    capacity: 180,
    facilities: 'Projector and stage',
    accessibility: 'Wheelchair access',
    operatingHours: '08:00 - 22:00',
    setupMinutes: 30,
    teardownMinutes: 30,
    isActive: true,
    updatedAt: '2026-09-20T10:00:00.000Z',
    layouts: ['THEATRE', 'CLASSROOM'],
    layoutDetails: [
      { id: 10, venue_id: 1, layout: 'THEATRE' },
      { id: 11, venue_id: 1, layout: 'CLASSROOM' },
    ],
  }],
  bookings: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mockDatabaseApi({ validateUpdate = false } = {}) {
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/api/venues' && options.method === 'POST') {
      const created = {
        ...options.body,
        id: 2,
        isActive: true,
        layouts: options.body.layouts || [],
        layoutDetails: [],
      };
      database.venues.push(created);
      return { venue: clone(created) };
    }

    if (path === '/api/venues' && !options.method) {
      return { venues: clone(database.venues) };
    }

    if (path === '/api/venues/bookings') {
      return { bookings: clone(database.bookings) };
    }

    const updateMatch = path.match(/^\/api\/venues\/(\d+)$/);
    if (updateMatch && options.method === 'PATCH') {
      if (validateUpdate) {
        const { name, capacity, setupMinutes, teardownMinutes, isActive, operatingHours } = options.body;
        const details = [];
        if (!name?.trim()) details.push({ field: 'name', message: 'Venue name is required' });
        if (!Number.isInteger(capacity) || capacity < 0) {
          details.push({ field: 'capacity', message: 'Capacity must be a non-negative integer' });
        }
        if (!Number.isInteger(setupMinutes) || setupMinutes < 0) {
          details.push({ field: 'setupMinutes', message: 'Setup minutes must be a non-negative integer' });
        }
        if (!Number.isInteger(teardownMinutes) || teardownMinutes < 0) {
          details.push({ field: 'teardownMinutes', message: 'Teardown minutes must be a non-negative integer' });
        }
        if (typeof isActive !== 'boolean') {
          details.push({ field: 'isActive', message: 'Active status must be true or false' });
        }
        if (operatingHours && !/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(operatingHours)) {
          details.push({ field: 'operatingHours', message: 'Use HH:MM - HH:MM format' });
        }
        if (details.length) {
          const error = new Error('Venue update validation failed');
          error.details = details;
          throw error;
        }
      }
      const venue = database.venues.find((item) => item.id === Number(updateMatch[1]));
      const { layouts, ...venueFields } = options.body;
      Object.assign(venue, venueFields);
      if (layouts) {
        venue.layoutDetails = layouts
          .filter((layout) => !layout.deleted)
          .map((layout, index) => ({
            id: layout.id || 20 + index,
            venue_id: venue.id,
            layout: layout.layout,
          }));
        venue.layouts = venue.layoutDetails.map((layout) => layout.layout);
      }
      return { venue: clone(venue) };
    }

    throw new Error(`Unhandled API call: ${path}`);
  });
}

function renderVenues() {
  return render(<Venues />);
}

describe('Venues page inputs', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = jest.fn();
    database.venues = [{
      id: 1,
      name: 'Helix Hall',
      location: 'ConnectSphere Campus, Level 2',
      capacity: 180,
      facilities: 'Projector and stage',
      accessibility: 'Wheelchair access',
      operatingHours: '08:00 - 22:00',
      setupMinutes: 30,
      teardownMinutes: 30,
      isActive: true,
      updatedAt: '2026-09-20T10:00:00.000Z',
      layouts: ['THEATRE', 'CLASSROOM'],
      layoutDetails: [
        { id: 10, venue_id: 1, layout: 'THEATRE' },
        { id: 11, venue_id: 1, layout: 'CLASSROOM' },
      ],
    }];
    database.bookings = [];
    useAuth.mockReturnValue({ hasRole: () => true });
    api.mockReset();
    mockDatabaseApi();
  });

  it('loads venue catalogue data into the page', async () => {
    renderVenues();

    expect(await screen.findByRole('heading', { name: 'Helix Hall' })).toBeInTheDocument();
    expect(screen.getByText('Capacity 180')).toBeInTheDocument();
    expect(screen.getAllByText('THEATRE').length).toBeGreaterThan(0);
  });

  it('accepts add-venue input values and sends them to the mocked database', async () => {
    const user = userEvent.setup();
    renderVenues();
    await screen.findByRole('heading', { name: 'Helix Hall' });

    const nameInput = screen.getByPlaceholderText('Name');
    const locationInput = screen.getByPlaceholderText('Location');
    await user.type(nameInput, 'Orchid Boardroom');
    await user.type(locationInput, 'ConnectSphere Campus, Level 8');
    await user.clear(screen.getAllByRole('spinbutton')[0]);
    await user.type(screen.getAllByRole('spinbutton')[0], '16');
    await user.click(screen.getByRole('button', { name: 'Save venue' }));

    await waitFor(() => {
      expect(database.venues).toHaveLength(2);
    });
    expect(api).toHaveBeenCalledWith('/api/venues', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        name: 'Orchid Boardroom',
        location: 'ConnectSphere Campus, Level 8',
        capacity: 16,
      }),
    }));
  });

  it('loads selected venue values into update inputs and sends edited values', async () => {
    const user = userEvent.setup();
    renderVenues();
    await user.click(await screen.findByRole('button', { name: /Helix Hall/i }));

    const nameInput = screen.getByDisplayValue('Helix Hall');
    const facilitiesInput = screen.getByDisplayValue('Projector and stage');
    await user.clear(nameInput);
    await user.type(nameInput, 'Helix Hall Updated');
    await user.clear(facilitiesInput);
    await user.type(facilitiesInput, 'Hybrid cameras');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(database.venues[0].name).toBe('Helix Hall Updated');
    });
    expect(database.venues[0].facilities).toBe('Hybrid cameras');
    expect(api).toHaveBeenCalledWith('/api/venues/1', expect.objectContaining({
      method: 'PATCH',
      body: expect.objectContaining({
        name: 'Helix Hall Updated',
        facilities: 'Hybrid cameras',
      }),
    }));
    expect(api.mock.calls.at(-1)[0]).toBe('/api/venues');
  });

  it.each([
    ['capacity', 'Capacity', 'capacity: Capacity must be a non-negative integer'],
    ['setup minutes', 'Setup (mins)', 'setupMinutes: Setup minutes must be a non-negative integer'],
    ['teardown minutes', 'Teardown (mins)', 'teardownMinutes: Teardown minutes must be a non-negative integer'],
  ])('shows a validation error when mandatory %s is empty', async (_field, label, expectedMessage) => {
    const user = userEvent.setup();
    mockDatabaseApi({ validateUpdate: true });
    renderVenues();
    await user.click(await screen.findByRole('button', { name: /Helix Hall/i }));

    const input = screen.getByLabelText(label);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(database.venues[0].name).toBe('Helix Hall');
  });

  it('shows a validation error when operating hours contain letters instead of a time range', async () => {
    const user = userEvent.setup();
    mockDatabaseApi({ validateUpdate: true });
    renderVenues();
    await user.click(await screen.findByRole('button', { name: /Helix Hall/i }));

    const hoursInput = screen.getByDisplayValue('08:00 - 22:00');
    await user.clear(hoursInput);
    await user.type(hoursInput, 'AbCd');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('operatingHours: Use HH:MM - HH:MM format')).toBeInTheDocument();
    expect(database.venues[0].operatingHours).toBe('08:00 - 22:00');
  });
});

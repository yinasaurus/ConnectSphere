import { render, screen, waitFor, within } from '@testing-library/react';
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

    const decisionMatch = path.match(/^\/api\/venues\/bookings\/(\d+)\/decision$/);
    if (decisionMatch && options.method === 'POST') {
      const bookingId = Number(decisionMatch[1]);
      const booking = database.bookings.find((item) => item.id === bookingId);
      if (booking) {
        booking.status = options.body.approve ? 'APPROVED' : 'REJECTED';
        booking.decision_reason = options.body.reason || null;
        booking.alternative_suggestion = options.body.alternativeSuggestion || null;
      }
      return { booking: clone(booking) };
    }

    if (path.startsWith('/api/venues/search')) {
      return { venues: clone(database.venues) };
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

// The page has an Add venue and an Update venue form with some of the same labels.
function formCard(heading) {
  return screen.getByRole('heading', { name: heading }).closest('.card');
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
    const capacityInput = within(formCard('Add venue')).getByLabelText('Capacity');
    await user.clear(capacityInput);
    await user.type(capacityInput, '16');
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

    const input = within(formCard('Update venue')).getByLabelText(label);
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

  /*
   * AC:       SCUM-7 AC1
   * Scenario: Venue Staff fill in every detail of a new venue in the Add venue form.
   * Setup:    Logged in as Venue Staff. The form starts with THEATRE ticked; the user ticks
   *           CLASSROOM and BOARDROOM and unticks THEATRE.
   * Expected: The POST body contains location, capacity, facilities, accessibility,
   *           operating hours and all chosen layouts, so a venue can be added complete in
   *           one step.
   * Type:     normal
   */
  it('sends every AC1 detail, including several layouts, when adding a venue', async () => {
    const user = userEvent.setup();
    renderVenues();
    await screen.findByRole('heading', { name: 'Helix Hall' });
    const add = within(formCard('Add venue'));

    await user.type(add.getByLabelText('Venue name'), 'Orchid Boardroom');
    await user.type(add.getByLabelText('Location'), 'Level 8');
    await user.clear(add.getByLabelText('Capacity'));
    await user.type(add.getByLabelText('Capacity'), '16');
    await user.type(add.getByLabelText('Operating hours'), '08:00 - 20:00');
    await user.type(add.getByLabelText('Facilities'), 'Video conferencing');
    await user.clear(add.getByLabelText('Accessibility'));
    await user.type(add.getByLabelText('Accessibility'), 'Lift access');
    await user.click(add.getByLabelText('THEATRE'));
    await user.click(add.getByLabelText('CLASSROOM'));
    await user.click(add.getByLabelText('BOARDROOM'));
    await user.click(add.getByRole('button', { name: 'Save venue' }));

    await waitFor(() => expect(database.venues).toHaveLength(2));
    expect(api).toHaveBeenCalledWith('/api/venues', {
      method: 'POST',
      body: {
        name: 'Orchid Boardroom',
        location: 'Level 8',
        capacity: 16,
        facilities: 'Video conferencing',
        accessibility: 'Lift access',
        operatingHours: '08:00 - 20:00',
        layouts: ['CLASSROOM', 'BOARDROOM'],
      },
    });
  });

  /*
   * AC:       SCUM-7 AC4
   * Scenario: Venue Staff clear the capacity box and try to save a new venue.
   * Setup:    The API rejects the POST with the field error the real validator returns
   *           ("Capacity is required"), as it does for an empty capacity.
   * Expected: The page shows which field is wrong, and the catalogue isn't changed.
   * Type:     error
   */
  it('shows the field error when a new venue is rejected for missing capacity', async () => {
    const user = userEvent.setup();
    const normal = api.getMockImplementation();
    api.mockImplementation(async (path, options = {}) => {
      if (path === '/api/venues' && options.method === 'POST') {
        const error = new Error('Capacity is required');
        error.details = [{ field: 'capacity', message: 'Capacity is required' }];
        throw error;
      }
      return normal(path, options);
    });
    renderVenues();
    await screen.findByRole('heading', { name: 'Helix Hall' });
    const add = within(formCard('Add venue'));

    await user.type(add.getByLabelText('Venue name'), 'Orchid Boardroom');
    await user.clear(add.getByLabelText('Capacity'));
    await user.click(add.getByRole('button', { name: 'Save venue' }));

    expect(await screen.findByText('capacity: Capacity is required')).toBeInTheDocument();
    // The empty box is sent as '' so the server, not the browser, decides it's invalid.
    expect(api).toHaveBeenCalledWith('/api/venues', expect.objectContaining({
      body: expect.objectContaining({ capacity: '' }),
    }));
    expect(database.venues).toHaveLength(1);
  });

  /*
   * AC:       SCUM-7 AC2 (editing layouts)
   * Scenario: Venue Staff rename one layout, remove another and add a new one.
   * Setup:    Helix Hall has THEATRE (id 10) and CLASSROOM (id 11).
   * Expected: The PATCH sends the rename and the delete with their ids and the new layout
   *           without one, which is how the API tells the three changes apart.
   * Type:     normal
   */
  it('sends layout renames, removals and additions when updating a venue', async () => {
    const user = userEvent.setup();
    renderVenues();
    await user.click(await screen.findByRole('button', { name: /Helix Hall/i }));
    const update = within(formCard('Update venue'));

    const theatre = update.getByDisplayValue('THEATRE');
    await user.clear(theatre);
    await user.type(theatre, 'THEATRE STYLE');
    await user.click(update.getByRole('button', { name: 'Delete CLASSROOM' }));
    await user.type(update.getByPlaceholderText('Add layout'), 'BANQUET');
    await user.click(update.getByRole('button', { name: 'Add layout' }));
    await user.click(update.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(database.venues[0].layouts).toEqual(['THEATRE STYLE', 'BANQUET']));
    expect(api).toHaveBeenCalledWith('/api/venues/1', expect.objectContaining({
      method: 'PATCH',
      body: expect.objectContaining({
        layouts: [
          { id: 10, layout: 'THEATRE STYLE' },
          { id: 11, layout: 'CLASSROOM', deleted: true },
          { layout: 'BANQUET' },
        ],
      }),
    }));
  });

  /*
   * AC:       SCUM-7 AC2
   * Scenario: Venue Staff deactivate a venue from the Update venue form.
   * Setup:    Helix Hall is active.
   * Expected: Unticking "Venue is active" and saving sends isActive: false, which keeps the
   *           record but takes it out of the active catalogue.
   * Type:     normal
   */
  it('sends isActive false when the venue is deactivated', async () => {
    const user = userEvent.setup();
    renderVenues();
    await user.click(await screen.findByRole('button', { name: /Helix Hall/i }));
    const update = within(formCard('Update venue'));

    await user.click(update.getByLabelText('Venue is active'));
    expect(update.getByText('Inactive')).toBeInTheDocument();
    await user.click(update.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(database.venues[0].isActive).toBe(false));
    expect(api).toHaveBeenCalledWith('/api/venues/1', expect.objectContaining({
      method: 'PATCH',
      body: expect.objectContaining({ isActive: false }),
    }));
  });

  /*
   * AC:       SCUM-7 AC2
   * Scenario: Venue Staff open a venue whose optional details were never filled in.
   * Setup:    A venue with only id, name and layouts as plain names (no ids, no capacity,
   *           times or text fields), as an older record might be.
   * Expected: The Update form opens with empty boxes, default setup/teardown of 30, and the
   *           layouts listed, instead of showing "undefined" or crashing.
   * Type:     boundary
   */
  it('opens a venue with missing details using empty values and defaults', async () => {
    const user = userEvent.setup();
    database.venues = [{ id: 3, name: 'Bare Room', layouts: ['BANQUET'] }];
    renderVenues();
    await user.click(await screen.findByRole('button', { name: /Bare Room/i }));
    const update = within(formCard('Update venue'));

    expect(update.getByLabelText('Location')).toHaveValue('');
    expect(update.getByLabelText('Facilities')).toHaveValue('');
    expect(update.getByLabelText('Setup (mins)')).toHaveValue(30);
    expect(update.getByLabelText('Teardown (mins)')).toHaveValue(30);
    expect(update.getByText('BANQUET')).toBeInTheDocument();
  });

  /*
   * AC:       SCUM-7 AC2
   * Scenario: Venue Staff open a venue for editing, then cancel.
   * Setup:    Helix Hall selected and its name changed in the form.
   * Expected: The form closes without sending anything, and the saved venue is unchanged.
   * Type:     boundary
   */
  it('closes the update form without saving when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderVenues();
    await user.click(await screen.findByRole('button', { name: /Helix Hall/i }));
    await user.type(screen.getByDisplayValue('Helix Hall'), ' draft');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Select a venue card from the catalogue above to edit its details.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Update venue' })).not.toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('/api/venues/1', expect.anything());
    expect(database.venues[0].name).toBe('Helix Hall');
  });
});

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

function mockSearchApi(searchResponse) {
  api.mockImplementation(async (path) => {
    if (path === '/api/venues') return { venues: [] };
    if (path === '/api/venues/bookings') return { bookings: [] };
    if (path.startsWith('/api/venues/search')) return searchResponse;
    throw new Error(`Unexpected call: ${path}`);
  });
}

describe('SCUM-24 venue search results', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.mockReturnValue({ hasRole: () => false });
  });

  /*
   * AC:       SCUM-24 AC1-AC4
   * Scenario: Coordinator runs a search and reads a result card
   * Setup:    Search returns Helix Hall with facilities, accessibility and layouts
   * Expected: The card shows name, location, capacity, facilities, accessibility and layout pills
   * Type:     normal
   */
  it('shows name, location, capacity, facilities, accessibility and layouts for each result', async () => {
    mockSearchApi({ venues: [SEARCH_RESULT_VENUE] });
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

  /*
   * AC:       SCUM-24 AC5
   * Scenario: Coordinator opens and closes extra details on a result
   * Setup:    Search returns Helix Hall; they click View details then Close
   * Expected: Operating hours and setup/turnaround appear, then disappear
   * Type:     normal
   */
  it('lets the coordinator select a result to view more details, and close it again', async () => {
    mockSearchApi({ venues: [SEARCH_RESULT_VENUE] });
    render(<Venues />);

    await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));
    await userEvent.click(await screen.findByRole('button', { name: 'View details' }));

    expect(await screen.findByText('Operating hours: 08:00-22:00')).toBeInTheDocument();
    expect(screen.getByText('Setup time: 45 min · Turnaround time: 30 min')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Operating hours: 08:00-22:00')).not.toBeInTheDocument();
  });

  /*
   * AC:       SCUM-24 (empty results)
   * Scenario: Search matches nothing
   * Setup:    Search API returns an empty list
   * Expected: "No venues match your selected filters."
   * Type:     boundary
   */
  it('shows a clear message when no venue matches', async () => {
    mockSearchApi({ venues: [] });
    render(<Venues />);

    await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));

    expect(await screen.findByText('No venues match your selected filters.')).toBeInTheDocument();
  });

  /*
   * AC:       SCUM-24 AC6
   * Scenario: A second search returns updated catalogue data
   * Setup:    First search capacity 180, second search capacity 200
   * Expected: The page shows 200 and not 180
   * Type:     normal
   */
  it('always renders whatever the latest search response says, not a stale previous one', async () => {
    mockSearchApi({ venues: [SEARCH_RESULT_VENUE] });
    render(<Venues />);

    await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));
    expect(await screen.findByText('Capacity 180')).toBeInTheDocument();

    mockSearchApi({ venues: [{ ...SEARCH_RESULT_VENUE, capacity: 200 }] });
    await userEvent.click(screen.getByRole('button', { name: 'Search venues' }));

    expect(await screen.findByText('Capacity 200')).toBeInTheDocument();
    expect(screen.queryByText('Capacity 180')).not.toBeInTheDocument();
  });

  /*
   * AC:       SCUM-24 AC5
   * Scenario: Coordinator had details open and runs a new search
   * Setup:    View details is open, then Search venues is clicked again
   * Expected: The detail panel closes
   * Type:     boundary
   */
  it('clears the selected venue detail panel when a new search is run', async () => {
    mockSearchApi({ venues: [SEARCH_RESULT_VENUE] });
    render(<Venues />);

    await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));
    await userEvent.click(await screen.findByRole('button', { name: 'View details' }));
    expect(await screen.findByText('Operating hours: 08:00-22:00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Search venues' }));
    expect(screen.queryByText('Operating hours: 08:00-22:00')).not.toBeInTheDocument();
  });
});

describe('SCRUM-18 Venue Staff booking queue & independent decisions', () => {
  const pending1 = {
    id: 101,
    event_id: 50,
    venue_id: 1,
    status: 'PENDING',
    event_name: 'Tech Symposium',
    venue_name: 'Innovation Hall',
    start_at: '2026-10-20T09:00:00.000Z',
    end_at: '2026-10-20T12:00:00.000Z',
    event_start_at: '2026-10-20T08:00:00.000Z',
    event_end_at: '2026-10-20T18:00:00.000Z',
  };

  const pending2 = {
    id: 102,
    event_id: 51,
    venue_id: 1,
    status: 'PENDING',
    event_name: 'Design Workshop',
    venue_name: 'Innovation Hall',
    start_at: '2026-10-21T14:00:00.000Z',
    end_at: '2026-10-21T17:00:00.000Z',
    event_start_at: '2026-10-21T13:00:00.000Z',
    event_end_at: '2026-10-21T18:00:00.000Z',
  };

  beforeEach(() => {
    database.venues = [{
      id: 1,
      name: 'Innovation Hall',
      location: 'Level 2',
      capacity: 100,
      facilities: 'Projector',
      accessibility: 'Ramp',
      operatingHours: '08:00 - 22:00',
      setupMinutes: 30,
      teardownMinutes: 30,
      isActive: true,
      layouts: ['THEATRE'],
      layoutDetails: [{ id: 10, venue_id: 1, layout: 'THEATRE' }],
    }];
    database.bookings = [clone(pending1), clone(pending2)];
    useAuth.mockReturnValue({ hasRole: (role) => role === 'VENUE_STAFF' });
    api.mockReset();
    mockDatabaseApi();
  });

  /*
   * AC:       SCRUM-18 AC1 & AC2
   * Scenario: Venue Staff views pending booking queue
   * Setup:    Signed in as Venue Staff with two pending bookings
   * Expected: Pending list shows event name, venue name, booking window, and event date for each request
   * Type:     normal
   */
  it('US18-UI01 (AC1+AC2): pending queue shows event, venue, date and time for each booking', async () => {
    renderVenues();

    expect(await screen.findByTestId('pending-booking-101')).toBeInTheDocument();
    expect(screen.getByText(/Pending approval/)).toBeInTheDocument();
    expect(screen.getByText('Tech Symposium')).toBeInTheDocument();
    expect(screen.getByText('Design Workshop')).toBeInTheDocument();

    const card101 = screen.getByTestId('pending-booking-101');
    expect(within(card101).getByText('Tech Symposium')).toBeInTheDocument();
    expect(within(card101).getByText('Innovation Hall')).toBeInTheDocument();
    expect(within(card101).getByText(/Booking window:/i)).toBeInTheDocument();
    expect(within(card101).getByText(/Event date:/i)).toBeInTheDocument();

    const card102 = screen.getByTestId('pending-booking-102');
    expect(within(card102).getByText('Design Workshop')).toBeInTheDocument();
    expect(within(card102).getByText('Innovation Hall')).toBeInTheDocument();
    expect(within(card102).getByText(/Booking window:/i)).toBeInTheDocument();
    expect(within(card102).getByText(/Event date:/i)).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-18 AC3, AC5 & AC9
   * Scenario: Venue Staff approves a pending booking
   * Setup:    Two pending bookings (101 and 102) in database
   * Expected: Clicking Approve on booking 101 sends decision to endpoint for booking 101 only; booking 102 remains pending
   * Type:     normal
   */
  it('US18-UI02 (AC3+AC5+AC9): approving booking 101 hits decision endpoint for 101 only and keeps 102 pending', async () => {
    const user = userEvent.setup();
    renderVenues();

    expect(await screen.findByTestId('pending-booking-101')).toBeInTheDocument();
    expect(screen.getByTestId('pending-booking-102')).toBeInTheDocument();

    const card101 = screen.getByTestId('pending-booking-101');
    const approveBtn101 = within(card101).getByRole('button', { name: 'Approve' });
    await user.click(approveBtn101);

    await waitFor(() => {
      const decisionCalls = api.mock.calls.filter(([path]) => path.includes('/decision'));
      expect(decisionCalls).toHaveLength(1);
      expect(decisionCalls[0][0]).toBe('/api/venues/bookings/101/decision');
      expect(decisionCalls[0][1].body).toEqual({
        approve: true,
        reason: undefined,
        alternativeSuggestion: undefined,
      });
    });

    // Booking 101 is now approved and moved to decided bookings table
    await waitFor(() => {
      expect(screen.queryByTestId('pending-booking-101')).not.toBeInTheDocument();
    });
    // Booking 102 remains in pending queue
    expect(screen.getByTestId('pending-booking-102')).toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-18 AC3, AC4, AC5 & AC9
   * Scenario: Venue Staff rejects a pending booking with reason and suggested alternative
   * Setup:    Two pending bookings (101 and 102) in database
   * Expected: Typing reason and alternative in card 102 and clicking Reject sends decision to endpoint for 102 only
   * Type:     normal
   */
  it('US18-UI03 (AC3+AC4+AC9): rejecting booking 102 sends reason and alternative for 102 only', async () => {
    const user = userEvent.setup();
    renderVenues();

    expect(await screen.findByTestId('pending-booking-102')).toBeInTheDocument();
    const card102 = screen.getByTestId('pending-booking-102');

    const reasonInput = within(card102).getByPlaceholderText('Explain why the booking is rejected, if applicable');
    const altInput = within(card102).getByPlaceholderText('e.g. Orchid Room on the same date');
    const rejectBtn = within(card102).getByRole('button', { name: 'Reject' });

    await user.type(reasonInput, 'Maintenance scheduled on lighting rig');
    await user.type(altInput, 'Seminar Room 3');
    await user.click(rejectBtn);

    await waitFor(() => {
      const decisionCalls = api.mock.calls.filter(([path]) => path.includes('/decision'));
      expect(decisionCalls).toHaveLength(1);
      expect(decisionCalls[0][0]).toBe('/api/venues/bookings/102/decision');
      expect(decisionCalls[0][1].body).toEqual({
        approve: false,
        reason: 'Maintenance scheduled on lighting rig',
        alternativeSuggestion: 'Seminar Room 3',
      });
    });

    // Booking 102 is removed from pending queue
    await waitFor(() => {
      expect(screen.queryByTestId('pending-booking-102')).not.toBeInTheDocument();
    });
    // Booking 101 remains untouched in pending queue
    expect(screen.getByTestId('pending-booking-101')).toBeInTheDocument();
  });
});

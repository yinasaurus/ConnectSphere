import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// Search requests stay pending until the test resolves or rejects them, so responses can
// be made to arrive late or out of order.
function mockDeferredSearchApi() {
  const pending = [];
  api.mockImplementation((path) => {
    if (path === '/api/venues') return Promise.resolve({ venues: [] });
    if (path === '/api/venues/bookings') return Promise.resolve({ bookings: [] });
    if (path.startsWith('/api/venues/search')) {
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    }
    return Promise.reject(new Error(`Unexpected call: ${path}`));
  });
  return pending;
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

  /*
   * AC:       SCUM-24 AC3, AC4
   * Scenario: A result has no facilities, accessibility or layouts on file
   * Setup:    Search returns Bare Room with facilities '', accessibility null, layouts []
   *           and no operating hours; the coordinator also opens its details
   * Expected: Card and detail panel both say "None listed"; no layout pills or hours line
   * Type:     boundary
   */
  it('shows "None listed" and no layout pills for a venue with no facilities, accessibility or layouts', async () => {
    const bareVenue = {
      id: 2,
      name: 'Bare Room',
      location: 'Annex',
      capacity: 20,
      facilities: '',
      accessibility: null,
      setupMinutes: 30,
      teardownMinutes: 30,
      layouts: [],
    };
    mockSearchApi({ venues: [bareVenue] });
    const { container } = render(<Venues />);

    await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));
    expect(await screen.findByText('Facilities: None listed')).toBeInTheDocument();
    expect(screen.getByText('Accessibility: None listed')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(screen.getAllByText('Facilities: None listed')).toHaveLength(2);
    expect(screen.getAllByText('Accessibility: None listed')).toHaveLength(2);
    expect(container.querySelectorAll('.pill')).toHaveLength(0);
    expect(screen.queryByText(/Operating hours/)).not.toBeInTheDocument();
  });

  /*
   * AC:       SCUM-24 AC5
   * Scenario: Coordinator has details open and clicks Clear
   * Setup:    Search returns Helix Hall; View details is open
   * Expected: The detail panel and the results are both gone
   * Type:     normal
   */
  it('closes the detail panel and the results when Clear is clicked', async () => {
    mockSearchApi({ venues: [SEARCH_RESULT_VENUE] });
    render(<Venues />);

    await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));
    await userEvent.click(await screen.findByRole('button', { name: 'View details' }));
    expect(await screen.findByText('Operating hours: 08:00-22:00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('Operating hours: 08:00-22:00')).not.toBeInTheDocument();
    expect(screen.queryByText('Helix Hall')).not.toBeInTheDocument();
  });

  /*
   * AC:       SCUM-24 AC5
   * Scenario: Coordinator compares two results by opening each one's details
   * Setup:    Search returns Helix Hall and Orchid Room with different hours and times
   * Expected: The panel shows the venue that was clicked, and switches when another is clicked
   * Type:     normal
   */
  it('shows the details of whichever result is selected, and switches between results', async () => {
    const otherVenue = {
      ...SEARCH_RESULT_VENUE,
      id: 3,
      name: 'Orchid Room',
      operatingHours: '09:00-18:00',
      setupMinutes: 15,
      teardownMinutes: 10,
    };
    mockSearchApi({ venues: [SEARCH_RESULT_VENUE, otherVenue] });
    render(<Venues />);

    await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));
    const [helixButton, orchidButton] = await screen.findAllByRole('button', { name: 'View details' });

    await userEvent.click(orchidButton);
    expect(screen.getByText('Operating hours: 09:00-18:00')).toBeInTheDocument();
    expect(screen.getByText('Setup time: 15 min · Turnaround time: 10 min')).toBeInTheDocument();
    expect(screen.queryByText('Operating hours: 08:00-22:00')).not.toBeInTheDocument();

    await userEvent.click(helixButton);
    expect(screen.getByText('Operating hours: 08:00-22:00')).toBeInTheDocument();
    expect(screen.queryByText('Operating hours: 09:00-18:00')).not.toBeInTheDocument();
  });

  /*
   * AC:       SCUM-24 AC6
   * Scenario: Coordinator clicks Clear while a search is still loading
   * Setup:    The search response is held back until after Clear
   * Expected: The late response is ignored, so no results reappear; Search is usable again
   * Type:     error
   */
  it('ignores a search response that arrives after Clear was pressed', async () => {
    const pending = mockDeferredSearchApi();
    render(<Venues />);

    await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: 'Search venues' })).toBeEnabled();

    await act(async () => pending[0].resolve({ venues: [SEARCH_RESULT_VENUE] }));
    expect(screen.queryByText('Helix Hall')).not.toBeInTheDocument();
  });

  /*
   * AC:       SCUM-24 AC6
   * Scenario: Two searches overlap and the older one finishes last
   * Setup:    The newer search returns capacity 200 first, then the older returns 180
   * Expected: The page keeps showing 200, not the stale 180
   * Type:     error
   */
  it('keeps the newer results when an older search finishes last', async () => {
    const pending = mockDeferredSearchApi();
    const { container } = render(<Venues />);
    const form = container.querySelector('form');

    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => pending[1].resolve({ venues: [{ ...SEARCH_RESULT_VENUE, capacity: 200 }] }));
    await act(async () => pending[0].resolve({ venues: [SEARCH_RESULT_VENUE] }));

    expect(screen.getByText('Capacity 200')).toBeInTheDocument();
    expect(screen.queryByText('Capacity 180')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search venues' })).toBeEnabled();
  });

  /*
   * AC:       SCUM-24 AC6
   * Scenario: The latest search fails
   * Setup:    The search request is rejected with "Search failed"
   * Expected: The error is still shown and Search is usable again
   * Type:     error
   */
  it('still shows the error when the latest search fails', async () => {
    const pending = mockDeferredSearchApi();
    render(<Venues />);

    await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));
    await waitFor(() => expect(pending).toHaveLength(1));

    await act(async () => pending[0].reject(new Error('Search failed')));
    expect(screen.getByText('Search failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search venues' })).toBeEnabled();
  });

  /*
   * AC:       SCUM-24 AC6
   * Scenario: A search fails after the coordinator already clicked Clear
   * Setup:    The search request is rejected only after Clear
   * Expected: No error message appears for the abandoned search
   * Type:     error
   */
  it('ignores a failed search that finishes after Clear was pressed', async () => {
    const pending = mockDeferredSearchApi();
    render(<Venues />);

    await userEvent.click(await screen.findByRole('button', { name: 'Search venues' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await act(async () => pending[0].reject(new Error('Search failed')));
    expect(screen.queryByText('Search failed')).not.toBeInTheDocument();
  });
});

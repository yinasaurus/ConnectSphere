/**
 * SCRUM-21: Technical Support sees whether a pending request can be fulfilled.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Equipment from '../../src/pages/Equipment';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';

jest.mock('../../src/api', () => ({ api: jest.fn() }));
jest.mock('../../src/auth', () => ({ useAuth: jest.fn() }));

const REQUEST = {
  id: 20,
  event_id: 8,
  equipment_id: 1,
  equipment_name: 'Wireless handheld mic',
  quantity: 2,
  status: 'PENDING',
};

const WINDOW = { from: '2026-11-12T09:00:00.000Z', to: '2026-11-12T17:00:00.000Z' };
const CHECKED_WINDOW = `${new Date(WINDOW.from).toLocaleString()} – ${new Date(WINDOW.to).toLocaleString()}`;

const SUFFICIENT = {
  sufficient: true,
  indication: 'SUFFICIENT',
  requestedQuantity: 2,
  availableQuantity: 6,
  equipment: { name: 'Wireless handheld mic', type: 'AUDIO' },
  ...WINDOW,
};

function asRole(...roles) {
  useAuth.mockReturnValue({
    hasRole: (...allowed) => allowed.some((role) => roles.includes(role)),
  });
}

function mockLists({ requests = [REQUEST] } = {}) {
  api.mockImplementation(async (path) => {
    if (path === '/api/equipment') return { equipment: [] };
    if (path === '/api/equipment/requests') return { requests };
    if (path === '/api/equipment/requests/20/availability') return SUFFICIENT;
    throw new Error(`Unexpected ${path}`);
  });
}

describe('SCRUM-21 Equipment availability on the request list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    asRole('TECHNICAL_SUPPORT');
  });

  /*
   * AC: SCRUM-21 AC5, AC7
   * Scenario: Tech opens Equipment and a pending request can be fulfilled.
   * Setup: GET requests returns one PENDING mic × 2; availability returns sufficient with 6 free.
   * Expected: The page asks for that request's availability and shows Sufficient with the numbers
   * and the checked from–to window (AC1).
   * Type: normal
   */
  // SCRUM-21-TC28
  it('AC5/AC7: shows Sufficient when the request can be fulfilled', async () => {
    mockLists();
    render(<Equipment />);
    expect(await screen.findByText(/Sufficient — 6 free, 2 needed/i)).toBeInTheDocument();
    expect(screen.getByText(CHECKED_WINDOW)).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/api/equipment/requests/20/availability');
  });

  /*
   * AC: SCRUM-21 AC6, AC7
   * Scenario: Tech opens a pending request that cannot be fulfilled.
   * Setup: Availability returns insufficient (1 free, 2 needed).
   * Expected: Insufficient is shown so they can choose Unavailable or change the request.
   * Type: normal
   */
  // SCRUM-21-TC29
  it('AC6/AC7: shows Insufficient when free stock is below the request', async () => {
    api.mockImplementation(async (path) => {
      if (path === '/api/equipment') return { equipment: [] };
      if (path === '/api/equipment/requests') return { requests: [REQUEST] };
      if (path === '/api/equipment/requests/20/availability') {
        return {
          sufficient: false,
          indication: 'INSUFFICIENT',
          requestedQuantity: 2,
          availableQuantity: 1,
          equipment: { name: 'Wireless handheld mic' },
          ...WINDOW,
        };
      }
      throw new Error(`Unexpected ${path}`);
    });
    render(<Equipment />);
    expect(await screen.findByText(/Insufficient — 1 free, 2 needed/i)).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-21 AC2, AC6
   * Scenario: The catalogue item is not currently available (maintenance).
   * Setup: indication UNAVAILABLE.
   * Expected: Unavailable copy, not a false “sufficient”.
   * Type: error
   */
  // SCRUM-21-TC30
  it('AC2/AC6: shows Unavailable when the catalogue item is not in service', async () => {
    api.mockImplementation(async (path) => {
      if (path === '/api/equipment') return { equipment: [] };
      if (path === '/api/equipment/requests') return { requests: [REQUEST] };
      if (path === '/api/equipment/requests/20/availability') {
        return {
          sufficient: false,
          indication: 'UNAVAILABLE',
          requestedQuantity: 2,
          availableQuantity: 0,
          equipment: { name: 'Wireless handheld mic' },
          ...WINDOW,
        };
      }
      throw new Error(`Unexpected ${path}`);
    });
    render(<Equipment />);
    expect(await screen.findByText(/Unavailable — Wireless handheld mic is not currently available/i)).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-21 AC7
   * Scenario: Tech clicks Check availability again after arranging.
   * Setup: First load succeeds; button click returns a refreshed insufficient result.
   * Expected: The new indication replaces the old one.
   * Type: normal
   */
  // SCRUM-21-TC31
  it('AC7: Check availability refreshes the result for that request', async () => {
    let availability = SUFFICIENT;
    api.mockImplementation(async (path) => {
      if (path === '/api/equipment') return { equipment: [] };
      if (path === '/api/equipment/requests') return { requests: [REQUEST] };
      if (path === '/api/equipment/requests/20/availability') return availability;
      throw new Error(`Unexpected ${path}`);
    });
    render(<Equipment />);
    expect(await screen.findByText(/Sufficient — 6 free, 2 needed/i)).toBeInTheDocument();
    availability = {
      sufficient: false,
      indication: 'INSUFFICIENT',
      requestedQuantity: 2,
      availableQuantity: 0,
      equipment: { name: 'Wireless handheld mic' },
      ...WINDOW,
    };
    await userEvent.setup().click(screen.getByRole('button', { name: /check availability/i }));
    expect(await screen.findByText(/Insufficient — 0 free, 2 needed/i)).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-21 AC6, AC7
   * Scenario: The availability call fails (no event times, or the API errors).
   * Setup: GET availability throws.
   * Expected: The error is shown. Sufficient is not shown.
   * Type: error
   */
  // SCRUM-21-TC32
  it('AC6/AC7: shows the API error when the availability check fails', async () => {
    api.mockImplementation(async (path) => {
      if (path === '/api/equipment') return { equipment: [] };
      if (path === '/api/equipment/requests') return { requests: [REQUEST] };
      if (path === '/api/equipment/requests/20/availability') {
        throw new Error('The event has no date and time to check against');
      }
      throw new Error(`Unexpected ${path}`);
    });
    render(<Equipment />);
    expect(await screen.findByText(/The event has no date and time to check against/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sufficient/i)).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-21 AC1
   * Scenario: A Coordinator opens the same page.
   * Setup: Coordinator role; lists load.
   * Expected: Availability is not requested — the story is for Technical Support.
   * Type: error
   */
  // SCRUM-21-TC33
  it('AC1: Coordinators do not load availability', async () => {
    asRole('EVENT_COORDINATOR');
    mockLists();
    render(<Equipment />);
    expect(await screen.findByText(/Wireless handheld mic/i)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('/api/equipment/requests/20/availability');
    expect(screen.queryByRole('button', { name: /check availability/i })).not.toBeInTheDocument();
  });
});

describe('SCRUM-8 Equipment reserve on the request list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    asRole('TECHNICAL_SUPPORT');
  });

  /*
   * AC: SCRUM-8 AC1
   * Scenario: Tech clicks Reserve when the request can be fulfilled.
   * Setup: Lists load; POST decision approve true succeeds; reload returns RESERVED.
   * Expected: The decision is posted for that request and the row leaves PENDING.
   * Type: normal
   */
  it('AC1: Reserve posts a confirmation for that request', async () => {
    let reserved = false;
    api.mockImplementation(async (path, options = {}) => {
      if (path === '/api/equipment') return { equipment: [] };
      if (path === '/api/equipment/requests') {
        if (options.method === 'POST') throw new Error(`Unexpected POST ${path}`);
        return {
          requests: [reserved ? { ...REQUEST, status: 'RESERVED' } : REQUEST],
        };
      }
      if (path === '/api/equipment/requests/20/availability') return SUFFICIENT;
      if (path === '/api/equipment/requests/20/decision') {
        expect(options.method).toBe('POST');
        expect(options.body).toEqual({ approve: true });
        reserved = true;
        return { request: { ...REQUEST, status: 'RESERVED' } };
      }
      throw new Error(`Unexpected ${path}`);
    });
    render(<Equipment />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /^reserve$/i }));
    expect(api).toHaveBeenCalledWith('/api/equipment/requests/20/decision', {
      method: 'POST',
      body: { approve: true },
    });
    expect(await screen.findByText('RESERVED')).toBeInTheDocument();
    expect(screen.queryByText('PENDING')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reserve$/i })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-8 AC2
   * Scenario: Tech clicks Reserve when leftover stock is below the request.
   * Setup: POST decision throws the 409 message from the API.
   * Expected: That message is shown. The request stays PENDING (Reserve still there).
   * Type: error
   */
  it('AC2: shows the API error and keeps the request pending when reserve is blocked', async () => {
    api.mockImplementation(async (path, options = {}) => {
      if (path === '/api/equipment') return { equipment: [] };
      if (path === '/api/equipment/requests') return { requests: [REQUEST] };
      if (path === '/api/equipment/requests/20/availability') return SUFFICIENT;
      if (path === '/api/equipment/requests/20/decision' && options.body?.approve) {
        throw new Error('Requested quantity exceeds available equipment for this event (1 free, 2 needed)');
      }
      throw new Error(`Unexpected ${path}`);
    });
    render(<Equipment />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /^reserve$/i }));
    expect(await screen.findByText(/Requested quantity exceeds available equipment for this event/i)).toBeInTheDocument();
    expect(screen.getByText('PENDING')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reserve$/i })).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-8 AC3
   * Scenario: A Coordinator opens Equipment.
   * Setup: Coordinator role; lists load.
   * Expected: No Reserve button — only Tech may create a reservation.
   * Type: error
   */
  it('AC3: Coordinators do not see Reserve', async () => {
    asRole('EVENT_COORDINATOR');
    mockLists();
    render(<Equipment />);
    expect(await screen.findByText(/Wireless handheld mic/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reserve$/i })).not.toBeInTheDocument();
  });
});

describe('SCRUM-48 Technical Support manages equipment requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    asRole('TECHNICAL_SUPPORT');
  });

  /*
   * AC: SCRUM-48 AC1, AC2
   * Scenario: Tech opens Equipment and views equipment requirements, specs, and event name.
   * Expected: Event name, equipment name, technical requirements/specifications are rendered.
   */
  it('AC1/AC2: displays event details and technical specifications', async () => {
    const detailedRequest = {
      ...REQUEST,
      event_name: 'Tech Symposium',
      equipment_type: 'AUDIO',
      technical_requirements: 'UHF Wireless Mic with spare batteries',
    };
    mockLists({ requests: [detailedRequest] });
    render(<Equipment />);
    expect(await screen.findByText(/Tech Symposium \(Event #8\)/i)).toBeInTheDocument();
    expect(screen.getByText(/UHF Wireless Mic with spare batteries/i)).toBeInTheDocument();
    expect(screen.getByText(/AUDIO/i)).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-48 AC3
   * Scenario: Tech updates status to PREPARING with arrangement notes.
   * Expected: PATCH /api/equipment/requests/:id is sent and status is updated.
   */
  it('AC3: updates request status and arrangement notes', async () => {
    let currentStatus = 'PENDING';
    api.mockImplementation(async (path, options = {}) => {
      if (path === '/api/equipment') return { equipment: [] };
      if (path === '/api/equipment/requests') {
        return {
          requests: [{
            ...REQUEST,
            status: currentStatus,
            technical_requirements: 'Dual mic kit',
          }],
        };
      }
      if (path === '/api/equipment/requests/20/availability') return SUFFICIENT;
      if (path === '/api/equipment/requests/20' && options.method === 'PATCH') {
        currentStatus = options.body.status;
        return {
          request: {
            ...REQUEST,
            status: options.body.status,
            decision_reason: options.body.notes,
          },
        };
      }
      throw new Error(`Unexpected ${path}`);
    });

    render(<Equipment />);
    expect(await screen.findByText('PENDING')).toBeInTheDocument();

    const statusSelect = screen.getByLabelText(/Arrangement status/i);
    await userEvent.setup().selectOptions(statusSelect, 'PREPARING');

    const noteInput = screen.getByLabelText(/Arrangement note/i);
    await userEvent.setup().type(noteInput, 'Testing frequencies');

    const updateBtn = screen.getByRole('button', { name: /update status/i });
    await userEvent.setup().click(updateBtn);

    expect(api).toHaveBeenCalledWith('/api/equipment/requests/20', {
      method: 'PATCH',
      body: { status: 'PREPARING', notes: 'Testing frequencies' },
    });
  });

  /*
   * AC: SCRUM-48 AC1
   * Scenario: Tech filters requests by status.
   * Expected: Only matching requests are visible.
   */
  it('AC1: filters requests by status and searches by event', async () => {
    mockLists({
      requests: [
        { ...REQUEST, id: 20, event_id: 8, event_name: 'Alpha Forum', status: 'PENDING' },
        { ...REQUEST, id: 21, event_id: 9, event_name: 'Beta Showcase', status: 'READY' },
      ],
    });
    render(<Equipment />);
    expect(await screen.findByText(/Alpha Forum/i)).toBeInTheDocument();
    expect(screen.getByText(/Beta Showcase/i)).toBeInTheDocument();

    const filterSelect = screen.getByLabelText(/Filter by status/i);
    await userEvent.setup().selectOptions(filterSelect, 'READY');

    expect(screen.queryByText(/Alpha Forum/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Beta Showcase/i)).toBeInTheDocument();
  });
});

describe('SCRUM-58 review a marked reserved equipment request', () => {
  /*
   * AC:       SCRUM-58 AC6
   * Scenario: Technical Support open a request that is already reserved and marked for review.
   * Setup:    Signed in as Technical Support. The request status is RESERVED and needs_review.
   * Expected: Reserve is shown. Unavailable is not, so the request cannot be cancelled from here.
   * Type:     normal
   */
  // SCRUM-58-TC13
  it('US58-F02 (AC6): Reserve is shown for a reserved request that needs review', async () => {
    asRole('TECHNICAL_SUPPORT');
    mockLists({
      requests: [{ ...REQUEST, status: 'RESERVED', needs_review: true }],
    });
    render(<Equipment />);
    expect(await screen.findByRole('button', { name: /^reserve$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unavailable/i })).not.toBeInTheDocument();
    expect(screen.getByText('Requires review')).toBeInTheDocument();
  });
});

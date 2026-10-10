/**
 * SCRUM-21: Technical Support sees whether a pending request can be fulfilled.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Equipment from './Equipment';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const REQUEST = {
  id: 20,
  event_id: 8,
  equipment_id: 1,
  equipment_name: 'Wireless handheld mic',
  quantity: 2,
  status: 'PENDING',
};

const SUFFICIENT = {
  sufficient: true,
  indication: 'SUFFICIENT',
  requestedQuantity: 2,
  availableQuantity: 6,
  equipment: { name: 'Wireless handheld mic', type: 'AUDIO' },
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
   * Expected: The page asks for that request's availability and shows Sufficient with the numbers.
   * Type: normal
   */
  it('AC5/AC7: shows Sufficient when the request can be fulfilled', async () => {
    mockLists();
    render(<Equipment />);
    expect(await screen.findByText(/Sufficient — 6 free, 2 needed/i)).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/api/equipment/requests/20/availability');
  });

  /*
   * AC: SCRUM-21 AC6, AC7
   * Scenario: Tech opens a pending request that cannot be fulfilled.
   * Setup: Availability returns insufficient (1 free, 2 needed).
   * Expected: Insufficient is shown so they can choose Unavailable or change the request.
   * Type: normal
   */
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
    };
    await userEvent.setup().click(screen.getByRole('button', { name: /check availability/i }));
    expect(await screen.findByText(/Insufficient — 0 free, 2 needed/i)).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-21 AC1
   * Scenario: A Coordinator opens the same page.
   * Setup: Coordinator role; lists load.
   * Expected: Availability is not requested — the story is for Technical Support.
   * Type: error
   */
  it('AC1: Coordinators do not load availability', async () => {
    asRole('EVENT_COORDINATOR');
    mockLists();
    render(<Equipment />);
    expect(await screen.findByText(/Wireless handheld mic/i)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('/api/equipment/requests/20/availability');
    expect(screen.queryByRole('button', { name: /check availability/i })).not.toBeInTheDocument();
  });
});

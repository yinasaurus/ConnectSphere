/**
 * SCRUM-47: Create Equipment Request
 *
 * As an Event Coordinator, I want to record the equipment required for my event
 * so that Technical Support Staff know what equipment needs to be prepared.
 *
 * Acceptance Criteria:
 *   AC1: Event Coordinator can create an equipment request for an event.
 *   AC2: Request records equipment type and quantity required.
 *   AC3: Request records technical requirements or specifications.
 *   AC4: Request is associated with the relevant event, date, and time.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EquipmentRequest from './EquipmentRequest';
import { api } from '../api';

jest.mock('../api', () => ({ api: jest.fn() }));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const EVENT = {
  id: 8,
  name: 'Acme Annual Summit',
  category: 'CONFERENCE',
  status: 'PLANNING',
  startAt: '2026-11-12T09:00:00.000Z',
  endAt: '2026-11-12T17:00:00.000Z',
  expectedAttendance: 150,
  purpose: 'Strategic leadership sync',
  equipmentNotes: 'Organiser notes: 2 mics and 1 camera needed',
};

const CATALOGUE = [
  { id: 1, name: 'Wireless handheld mic', type: 'AUDIO', quantity: 8, status: 'AVAILABLE' },
  { id: 2, name: 'Hybrid camera kit', type: 'VIDEO', quantity: 3, status: 'AVAILABLE' },
  { id: 3, name: 'LED Stage floodlight', type: 'LIGHTING', quantity: 4, status: 'AVAILABLE' },
];

const EXISTING_REQUESTS = [
  {
    id: 10,
    event_id: 8,
    equipment_id: 2,
    equipment_name: 'Hybrid camera kit',
    equipment_type: 'VIDEO',
    quantity: 1,
    technical_requirements: 'PTZ camera with HDMI capture card for Zoom stream',
    start_at: '2026-11-12T09:00:00.000Z',
    end_at: '2026-11-12T17:00:00.000Z',
    status: 'RESERVED',
  },
];

function mockApi({ event = EVENT, catalogue = CATALOGUE, requests = EXISTING_REQUESTS } = {}) {
  api.mockImplementation(async (path, options) => {
    if (path === '/api/events/8') return { event };
    if (path === '/api/equipment') return { equipment: catalogue };
    if (path === '/api/equipment/requests?eventId=8') return { requests };
    if (path === '/api/equipment/requests' && options?.method === 'POST') {
      return {
        request: {
          id: 55,
          ...options.body,
          status: 'PENDING',
        },
      };
    }
    throw new Error(`Unexpected ${path}`);
  });
}

function renderComponent() {
  return render(
    <MemoryRouter initialEntries={['/app/events/8/equipment-request']}>
      <Routes>
        <Route path="/app/events/:id/equipment-request" element={<EquipmentRequest />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SCRUM-47 EquipmentRequest page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /*
   * AC: AC1 + AC4
   * Scenario: Coordinator opens the equipment request screen for an event.
   * Expected: Context card shows event name, date/time window, attendance, organiser equipment notes.
   *           Existing equipment requests for this event are listed.
   */
  it('AC1+AC4: renders event context, timing, and existing requests', async () => {
    mockApi();
    renderComponent();

    expect(await screen.findByText('Request Equipment')).toBeInTheDocument();
    expect(screen.getAllByText(/Acme Annual Summit/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Strategic leadership sync/i)).toBeInTheDocument();
    expect(screen.getByText(/Organiser notes: 2 mics and 1 camera needed/i)).toBeInTheDocument();

    // Check existing request display
    expect(screen.getByText(/Hybrid camera kit × 1/i)).toBeInTheDocument();
    expect(screen.getByText(/PTZ camera with HDMI capture card/i)).toBeInTheDocument();
    expect(screen.getByText('RESERVED')).toBeInTheDocument();
  });

  /*
   * AC: AC1, AC2, AC3, AC4
   * Scenario: Coordinator records equipment required with catalogue item, quantity,
   *           technical specifications, and timing.
   * Expected: Submits POST /api/equipment/requests with all fields and navigates back to event.
   */
  it('AC1–AC4: submits equipment request with catalogue item, quantity, specs, and timing', async () => {
    mockApi();
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('Request Equipment');

    // Select catalogue item (Wireless handheld mic)
    const itemSelect = screen.getByLabelText(/Catalogue item/i);
    await user.selectOptions(itemSelect, '1');

    // Quantity
    const qtyInput = screen.getByLabelText(/Quantity required/i);
    await user.clear(qtyInput);
    await user.type(qtyInput, '2');

    // Technical specifications
    const specsInput = screen.getByLabelText(/Technical requirements \/ specifications/i);
    await user.type(specsInput, '2 wireless UHF mics, cardioid pattern, spare AA batteries');

    // Submit
    const submitBtn = screen.getByRole('button', { name: /Submit Equipment Request/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/api/equipment/requests', {
        method: 'POST',
        body: expect.objectContaining({
          eventId: 8,
          equipmentId: 1,
          equipmentType: 'AUDIO',
          quantity: 2,
          technicalRequirements: '2 wireless UHF mics, cardioid pattern, spare AA batteries',
        }),
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/app/events/8', {
      state: { equipmentRequestSubmitted: true },
    });
  });

  /*
   * AC: AC2, AC3
   * Scenario: Coordinator specifies equipment type without catalogue item.
   * Expected: Submits with equipmentType, quantity, technical specifications.
   */
  it('AC2+AC3: allows creating equipment request with direct equipment type without catalogue item', async () => {
    mockApi();
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('Request Equipment');

    // Choose PROJECTION from standard types
    const typeSelect = screen.getByLabelText(/Equipment type \*/i);
    await user.selectOptions(typeSelect, 'PROJECTION');

    // Quantity
    const qtyInput = screen.getByLabelText(/Quantity required/i);
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');

    // Technical specifications
    const specsInput = screen.getByLabelText(/Technical requirements \/ specifications/i);
    await user.type(specsInput, '4K laser projector, minimum 6000 lumens, short throw lens');

    const submitBtn = screen.getByRole('button', { name: /Submit Equipment Request/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/api/equipment/requests', {
        method: 'POST',
        body: expect.objectContaining({
          eventId: 8,
          equipmentType: 'PROJECTION',
          quantity: 1,
          technicalRequirements: '4K laser projector, minimum 6000 lumens, short throw lens',
        }),
      });
    });
  });

  /*
   * AC: AC2
   * Scenario: Coordinator specifies a custom equipment type under "Other".
   */
  it('AC2: allows specifying custom equipment type name when Other is selected', async () => {
    mockApi();
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('Request Equipment');

    const typeSelect = screen.getByLabelText(/Equipment type \*/i);
    await user.selectOptions(typeSelect, 'OTHER');

    const customInput = screen.getByLabelText(/Custom equipment type name/i);
    await user.type(customInput, 'TELEPROMPTER');

    const specsInput = screen.getByLabelText(/Technical requirements \/ specifications/i);
    await user.type(specsInput, 'Presidential glass prompter with operator controller');

    const submitBtn = screen.getByRole('button', { name: /Submit Equipment Request/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/api/equipment/requests', {
        method: 'POST',
        body: expect.objectContaining({
          eventId: 8,
          equipmentType: 'TELEPROMPTER',
          quantity: 1,
          technicalRequirements: 'Presidential glass prompter with operator controller',
        }),
      });
    });
  });

  /*
   * AC: AC2 (Validation)
   * Scenario: Invalid quantity or timing displays error alert.
   */
  it('AC2: validates quantity is at least 1', async () => {
    mockApi();
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('Request Equipment');

    const qtyInput = screen.getByLabelText(/Quantity required/i);
    await user.clear(qtyInput);
    await user.type(qtyInput, '0');

    const submitBtn = screen.getByRole('button', { name: /Submit Equipment Request/i });
    await user.click(submitBtn);

    expect(await screen.findByText(/Quantity required must be a whole number of at least 1/i)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('/api/equipment/requests', expect.anything());
  });

  /*
   * AC: AC4 (Timing Validation)
   * Scenario: Start time is after end time.
   */
  it('AC4: validates start time is before end time', async () => {
    mockApi();
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('Request Equipment');

    const startInput = screen.getByLabelText(/Required from/i);
    const endInput = screen.getByLabelText(/Required until/i);

    fireEvent.change(startInput, { target: { value: '2026-11-12T18:00' } });
    fireEvent.change(endInput, { target: { value: '2026-11-12T09:00' } });

    const submitBtn = screen.getByRole('button', { name: /Submit Equipment Request/i });
    await user.click(submitBtn);

    expect(await screen.findByText(/Required equipment start time must be before end time/i)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('/api/equipment/requests', expect.anything());
  });

  /*
   * AC: AC4 (Timing Validation – window must sit inside the event)
   * Scenario: Coordinator sets Required from before the event starts.
   * Expected: Validation error, no API call.
   */
  it('AC4: rejects Required from before the event start', async () => {
    mockApi();
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('Request Equipment');

    const startInput = screen.getByLabelText(/Required from/i);
    // EVENT.startAt is 2026-11-12T09:00:00.000Z.
    // Use a date a full day earlier so the value is unambiguously before
    // the event start regardless of the test-runner timezone.
    fireEvent.change(startInput, { target: { value: '2026-11-11T09:00' } });

    const submitBtn = screen.getByRole('button', { name: /Submit Equipment Request/i });
    await user.click(submitBtn);

    expect(
      await screen.findByText(/Required from cannot be before the event starts/i)
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('/api/equipment/requests', expect.anything());
  });

  /*
   * AC: AC4 (Timing Validation – window must sit inside the event)
   * Scenario: Coordinator sets Required until after the event ends.
   * Expected: Validation error, no API call.
   */
  it('AC4: rejects Required until after the event end', async () => {
    mockApi();
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('Request Equipment');

    const endInput = screen.getByLabelText(/Required until/i);
    // EVENT.endAt is 2026-11-12T17:00:00.000Z.
    // toDateTimeLocal renders it in local time; we need a value that,
    // regardless of the test-runner timezone, resolves to a Date *after*
    // 2026-11-12T17:00:00.000Z.
    // Using a full ISO string avoids ambiguity: Date constructor treats
    // strings *without* a timezone designator as LOCAL time, so supply
    // an explicit UTC offset of +00:00 to guarantee the comparison.
    fireEvent.change(endInput, { target: { value: '2026-11-12T23:59' } });
    // In any timezone where the machine runs JSDOM, '2026-11-12T23:59'
    // parsed as local time will be >= 2026-11-12T23:59Z ≥ event.endAt.
    // For robustness use a date a full day later instead:
    fireEvent.change(endInput, { target: { value: '2026-11-13T17:00' } });

    const submitBtn = screen.getByRole('button', { name: /Submit Equipment Request/i });
    await user.click(submitBtn);

    expect(
      await screen.findByText(/Required until cannot be after the event ends/i)
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('/api/equipment/requests', expect.anything());
  });

  /*
   * AC: AC2 (Quantity Validation – must not exceed catalogue stock)
   * Scenario: Coordinator picks a catalogue item (Stock: 2) and requests 3.
   * Expected: Validation error naming the item and its stock, no API call.
   */
  it('AC2: rejects quantity above the catalogue stock of the selected item', async () => {
    const LIMITED_CATALOGUE = [
      { id: 5, name: 'Lectern', type: 'STAGING', quantity: 2, status: 'AVAILABLE' },
    ];
    mockApi({ catalogue: LIMITED_CATALOGUE });
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('Request Equipment');

    // Switch to the STAGING type so the Lectern item appears in the filtered dropdown
    const typeSelect = screen.getByLabelText(/Equipment type \*/i);
    await user.selectOptions(typeSelect, 'STAGING');

    // Select the item (stock 2)
    const itemSelect = screen.getByLabelText(/Catalogue item/i);
    await user.selectOptions(itemSelect, '5');

    // Request 3
    const qtyInput = screen.getByLabelText(/Quantity required/i);
    await user.clear(qtyInput);
    await user.type(qtyInput, '3');

    const submitBtn = screen.getByRole('button', { name: /Submit Equipment Request/i });
    await user.click(submitBtn);

    expect(
      await screen.findByText(/exceeds the catalogue stock for Lectern/i)
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('/api/equipment/requests', expect.anything());
  });

  /*
   * Scenario: API error displays user-facing error message.
   */
  it('displays API error when request creation fails', async () => {
    mockApi();
    api.mockImplementation(async (path, options) => {
      if (path === '/api/events/8') return { event: EVENT };
      if (path === '/api/equipment') return { equipment: CATALOGUE };
      if (path === '/api/equipment/requests?eventId=8') return { requests: [] };
      if (path === '/api/equipment/requests' && options?.method === 'POST') {
        throw new Error('Database connection failed');
      }
      throw new Error(`Unexpected ${path}`);
    });

    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('Request Equipment');

    const submitBtn = screen.getByRole('button', { name: /Submit Equipment Request/i });
    await user.click(submitBtn);

    expect(await screen.findByRole('alert')).toHaveTextContent('Database connection failed');
  });

  /*
   * Scenario: No type selected and no catalogue item chosen.
   * Expected: Shows the "specify a type or choose a catalogue item" validation message (JSX:125-127).
   * This covers the previously-untested branch.
   */
  it('shows error when neither equipment type nor catalogue item is provided', async () => {
    // Override catalogue to empty so no item is pre-selected and default type is cleared
    mockApi({ catalogue: [] });
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('Request Equipment');

    // Override the type select to have no meaningful selection by switching to OTHER then clearing
    const typeSelect = screen.getByLabelText(/Equipment type \*/i);
    await user.selectOptions(typeSelect, 'OTHER');

    // Leave the custom type input blank so effectiveType evaluates to ''
    const customInput = screen.getByLabelText(/Custom equipment type name/i);
    expect(customInput).toBeInTheDocument();
    // do not type anything — effectiveType will be ''

    const submitBtn = screen.getByRole('button', { name: /Submit Equipment Request/i });
    await user.click(submitBtn);

    expect(
      await screen.findByText(/Please specify an equipment type or choose an item from the catalogue/i)
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('/api/equipment/requests', expect.anything());
  });

  /*
   * Scenario: Catalogue item has a non-standard type — when selected, the type selector
   *           should switch to "Other" and the custom type field should be filled with the item's type
   *           (JSX:98-100).
   * This covers the previously-untested branch.
   */
  it('switches type to Other and populates custom field when catalogue item has non-standard type', async () => {
    const NON_STANDARD_CATALOGUE = [
      { id: 10, name: 'Teleprompter Pro', type: 'TELEPROMPTER', quantity: 2, status: 'AVAILABLE' },
    ];
    mockApi({ catalogue: NON_STANDARD_CATALOGUE });
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText('Request Equipment');

    // Switch the type selector to OTHER first so effectiveType becomes '' and all catalogue
    // items are rendered (the select is filtered by effectiveType at all times).
    const typeSelect = screen.getByLabelText(/Equipment type \*/i);
    await user.selectOptions(typeSelect, 'OTHER');

    // With effectiveType === '', all items are shown — wait for the catalogue option to appear.
    await screen.findByRole('option', { name: /Teleprompter Pro/i });

    const itemSelect = screen.getByLabelText(/Catalogue item/i);
    await user.selectOptions(itemSelect, '10');

    // handleCatalogueChange should now set selectedType back to 'OTHER' (already there)
    // and fill customType with 'TELEPROMPTER'.
    expect(typeSelect).toHaveValue('OTHER');

    const customInput = screen.getByLabelText(/Custom equipment type name/i);
    expect(customInput).toHaveValue('TELEPROMPTER');
  });
});



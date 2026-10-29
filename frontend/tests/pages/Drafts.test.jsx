import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../src/auth';
import { api } from '../../src/api';
import NewEvent from '../../src/pages/NewEvent';
import Drafts from '../../src/pages/Drafts';
import ProtectedRoute from '../../src/components/ProtectedRoute';
import { ROLES } from '../../src/constants';

jest.mock('../../src/api', () => ({
  api: jest.fn(),
}));

const mockUser = {
  id: 1,
  fullName: 'Aisha Rahman',
  email: 'organiser@acme.example',
  roles: ['EVENT_ORGANISER'],
  organisationId: 10,
};

function setupAuth() {
  return Promise.resolve({ user: mockUser });
}

describe('TC-DRAFT-04 (Draft Saving & Resuming)', () => {
  beforeEach(() => {
    api.mockReset();
    api.mockImplementation((path, options = {}) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/events' && !options.method) {
        return Promise.resolve({ events: [] });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });
  });

  it('enters partial details and selects "Save as Draft": persists without validation errors', async () => {
    const user = userEvent.setup();
    let savedPayload = null;

    api.mockImplementation((path, options = {}) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/events' && !options.method) return Promise.resolve({ events: [] });
      if (path === '/api/events' && options.method === 'POST') {
        savedPayload = options.body;
        return Promise.resolve({
          event: {
            id: 123,
            name: options.body.name,
            purpose: options.body.purpose,
            status: 'DRAFT',
            organiserId: 1,
          },
        });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={['/app/events/new']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/events/new" element={<NewEvent />} />
            <Route path="/app/drafts" element={<div>My Drafts Page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Verify form rendered
    expect(await screen.findByRole('heading', { name: /new event request/i })).toBeInTheDocument();

    // Enter partial details only (e.g. name and purpose, leaving description, dates, venue, accessibility blank)
    const nameInput = screen.getByLabelText(/event name \*/i);
    const purposeInput = screen.getByLabelText(/purpose \*/i);

    await user.type(nameInput, 'AI Innovation Hackathon');
    await user.type(purposeInput, 'Quarterly engineering showcase');

    // Click "Save as draft"
    const saveDraftBtn = screen.getByRole('button', { name: /save as draft/i });
    await user.click(saveDraftBtn);

    // Verify API called with POST and partial payload
    await waitFor(() => {
      expect(savedPayload).toBeTruthy();
      expect(savedPayload.name).toBe('AI Innovation Hackathon');
      expect(savedPayload.purpose).toBe('Quarterly engineering showcase');
    });

    // Verify no validation errors were shown
    expect(screen.queryByText(/is required/i)).not.toBeInTheDocument();

    // Verify redirected to drafts page
    expect(await screen.findByText('My Drafts Page')).toBeInTheDocument();
  });

  it('resumes editing a saved draft without triggering validation errors', async () => {
    const draftEvent = {
      id: 123,
      name: 'AI Innovation Hackathon',
      purpose: 'Quarterly engineering showcase',
      description: null,
      status: 'DRAFT',
      category: 'WORKSHOP',
      startAt: null,
      endAt: null,
      expectedAttendance: null,
      accessibilityNeeds: null,
      layoutPreference: 'THEATRE',
      venueRequirements: null,
      equipmentNotes: null,
      specialRequests: null,
      registrationRequired: true,
      clonedFromEventId: null,
      organiserId: 1,
    };

    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/events' && !path.includes('123')) return Promise.resolve({ events: [draftEvent] });
      if (path === '/api/events/123') return Promise.resolve({ event: draftEvent });
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={['/app/events/123/edit']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/events/:id/edit" element={<NewEvent />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Check that the form loads with previous partial data
    expect(await screen.findByDisplayValue('AI Innovation Hackathon')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Quarterly engineering showcase')).toBeInTheDocument();

    // Check that NO validation errors are triggered upon loading
    expect(screen.queryByText(/is required/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /*
  * AC:       SCRUM-15 (AC3: Organiser can continue editing and later submit the draft as a complete request)
  * Scenario: A previously-saved partial draft is resumed, completed, and submitted through the form.
  * Setup:    draftEvent (same partial draft as the "resumes editing" test above) is loaded for editing; every remaining compulsory field is filled in; "Submit for review" is clicked.
  * Expected: PATCH /api/events/123 sends the completed fields; POST /api/events/123/submit is called; page navigates to the event detail page.
  * Type:     normal
  */
  // SCRUM-15-TC06
  it('completing and submitting a resumed draft saves and submits through the UI', async () => {
    const draftEvent = {
      id: 123,
      name: 'AI Innovation Hackathon',
      purpose: 'Quarterly engineering showcase',
      description: null,
      status: 'DRAFT',
      category: 'WORKSHOP',
      startAt: null,
      endAt: null,
      expectedAttendance: null,
      accessibilityNeeds: null,
      layoutPreference: 'THEATRE',
      venueRequirements: null,
      equipmentNotes: null,
      specialRequests: null,
      registrationRequired: true,
      clonedFromEventId: null,
      organiserId: 1,
    };

    const user = userEvent.setup();
    let patchPayload = null;
    let submitCalled = false;

    api.mockImplementation((path, options = {}) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/events' && !options.method) return Promise.resolve({ events: [draftEvent] });
      if (path === '/api/events/123' && options.method === 'PATCH') {
        patchPayload = options.body;
        return Promise.resolve({ event: { ...draftEvent, ...options.body, id: 123 } });
      }
      if (path === '/api/events/123' && !options.method) return Promise.resolve({ event: draftEvent });
      if (path === '/api/events/123/submit' && options.method === 'POST') {
        submitCalled = true;
        return Promise.resolve({ event: { id: 123, status: 'SUBMITTED' } });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path} ${options.method || 'GET'}`));
    });

    render(
      <MemoryRouter initialEntries={['/app/events/123/edit']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/events/:id/edit" element={<NewEvent />} />
            <Route path="/app/events/:id" element={<div>Event Detail Page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByDisplayValue('AI Innovation Hackathon')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/description \*/i), 'Full agenda for the hackathon.');
    fireEvent.change(screen.getByLabelText(/start \*/i), { target: { value: '2026-12-01T09:00' } });
    fireEvent.change(screen.getByLabelText(/end \*/i), { target: { value: '2026-12-01T11:00' } });
    await user.type(screen.getByLabelText(/venue requirements \*/i), 'Auditorium with stage');
    await user.type(screen.getByLabelText(/accessibility needs \*/i), 'None');

    await user.click(screen.getByRole('button', { name: /submit for review/i }));

    await waitFor(() => expect(patchPayload).toBeTruthy());
    expect(patchPayload.description).toBe('Full agenda for the hackathon.');
    await waitFor(() => expect(submitCalled).toBe(true));
    expect(await screen.findByText('Event Detail Page')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-28 AC1, AC4
   * Scenario: Organiser opens the new-request form and reads what submit vs draft will do.
   * Setup: Empty new-event page (no ACTION_REQUIRED event).
   * Expected: Copy says submit goes to the unassigned queue, and does not promise auto-assignment.
   * Type: normal
   */
  it('tells the organiser that submit queues the request instead of auto-assigning a Coordinator', async () => {
    render(
      <MemoryRouter initialEntries={['/app/events/new']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/events/new" element={<NewEvent />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText(/unassigned queue for the Event Coordinator Lead/i)).toBeInTheDocument();
    expect(screen.queryByText(/auto-assigns/i)).not.toBeInTheDocument();
  });
});

describe('Drafts list page (client-side filtering)', () => {
  /*
   * AC:       SCRUM-15 (AC1/AC4: Draft requests exist as a distinct, Organiser-owned set; also guards the client-side organiserId filter in Drafts.jsx)
   * Scenario: The signed-in Organiser's drafts list is rendered alongside another Organiser's draft.
   * Setup:    /api/events?status=DRAFT returns two drafts — one owned by the caller (organiserId: 1), one owned by someone else (organiserId: 99).
   * Expected: Only the caller's own draft is shown; the other Organiser's is filtered out.
   * Type:     normal
   */
  // SCRUM-15-TC07
  it("shows only the signed-in organiser's own drafts, not another organiser's", async () => {
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/events?status=DRAFT') {
        return Promise.resolve({
          events: [
            { id: 1, name: 'My Draft', purpose: 'Mine', organiserId: 1, updatedAt: '2026-10-20T10:00:00Z' },
            { id: 2, name: "Someone Else's Draft", purpose: 'Not mine', organiserId: 99, updatedAt: '2026-10-20T10:00:00Z' },
          ],
        });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={['/app/drafts']}>
        <AuthProvider>
          <Routes><Route path="/app/drafts" element={<ProtectedRoute allowedRoles={[ROLES.EVENT_ORGANISER]}><Drafts /></ProtectedRoute>} /></Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('My Draft')).toBeInTheDocument();
    expect(screen.queryByText("Someone Else's Draft")).not.toBeInTheDocument();
  });

  /*
   * AC:       SCRUM-15 (AC1/AC4: Draft requests exist as a distinct set — empty-state case)
   * Scenario: The Organiser has no saved drafts.
   * Setup:    /api/events?status=DRAFT returns an empty list.
   * Expected: The "No drafts yet..." empty-state message is shown.
   * Type:     boundary
   */
  // SCRUM-15-TC08
  it('shows the empty-state message when the organiser has no drafts', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/events?status=DRAFT') return Promise.resolve({ events: [] });
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={['/app/drafts']}>
        <AuthProvider>
          <Routes><Route path="/app/drafts" element={<ProtectedRoute allowedRoles={[ROLES.EVENT_ORGANISER]}><Drafts /></ProtectedRoute>} /></Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText(/no drafts yet/i)).toBeInTheDocument();
  });
});

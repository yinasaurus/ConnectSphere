import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth';
import { api } from '../api';
import NewEvent from './NewEvent';

jest.mock('../api', () => ({
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
});

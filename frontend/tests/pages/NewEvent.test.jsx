import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../src/auth';
import { api } from '../../src/api';
import NewEvent from '../../src/pages/NewEvent';

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

function renderNewEvent() {
  return render(
    <MemoryRouter initialEntries={['/app/events/new']}>
      <AuthProvider>
        <Routes>
          <Route path="/app/events/new" element={<NewEvent />} />
          <Route path="/app/events/:id" element={<div>Event Detail Page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

/**
 * SCRUM-14: compulsory fields are enforced client-side before a request can be submitted
 * for review. Draft-saving itself (which deliberately skips this check, SCRUM-15) is
 * already covered by Drafts.test.jsx - this file covers the submit-validation path only,
 * which had no test coverage at all before this.
 */
describe('SCRUM-14 NewEvent compulsory-field validation on submit', () => {
  beforeEach(() => {
    api.mockReset();
    api.mockImplementation((path, options = {}) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/events' && !options.method) return Promise.resolve({ events: [] });
      return Promise.reject(new Error(`Unhandled api call: ${path} ${options.method || 'GET'}`));
    });
  });

  // SCRUM-14-TC14
  it('blocks submission and shows every missing required field, without calling the API', async () => {
    const user = userEvent.setup();
    renderNewEvent();
    expect(await screen.findByRole('heading', { name: /new event request/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /submit for review/i }));

    expect(screen.getByText('Event name is required.')).toBeInTheDocument();
    expect(screen.getByText('Purpose is required.')).toBeInTheDocument();
    expect(screen.getByText('Description is required.')).toBeInTheDocument();
    expect(screen.getByText('Start date/time is required.')).toBeInTheDocument();
    expect(screen.getByText('End date/time is required.')).toBeInTheDocument();
    expect(screen.getByText('Venue requirements is required.')).toBeInTheDocument();
    expect(screen.getByText(/Accessibility requirements is required/)).toBeInTheDocument();

    expect(api).not.toHaveBeenCalledWith('/api/events', expect.objectContaining({ method: 'POST' }));
  });

  // SCRUM-14-TC15
  it("fixing one field clears only that field's error, leaving the others", async () => {
    const user = userEvent.setup();
    renderNewEvent();
    await user.click(await screen.findByRole('button', { name: /submit for review/i }));
    expect(screen.getByText('Event name is required.')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/event name \*/i), 'Town Hall');

    expect(screen.queryByText('Event name is required.')).not.toBeInTheDocument();
    expect(screen.getByText('Purpose is required.')).toBeInTheDocument();
  });

  // SCRUM-14-TC16
  it('submitting with every compulsory field filled in saves, submits, and navigates to the event', async () => {
    const user = userEvent.setup();
    let postPayload = null;
    let submitCalled = false;
    api.mockImplementation((path, options = {}) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/events' && !options.method) return Promise.resolve({ events: [] });
      if (path === '/api/events' && options.method === 'POST') {
        postPayload = options.body;
        return Promise.resolve({ event: { id: 77, name: options.body.name, organiserId: 1, status: 'DRAFT' } });
      }
      if (path === '/api/events/77/submit' && options.method === 'POST') {
        submitCalled = true;
        return Promise.resolve({ event: { id: 77, status: 'SUBMITTED' } });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path} ${options.method || 'GET'}`));
    });

    renderNewEvent();
    await user.type(await screen.findByLabelText(/event name \*/i), 'Town Hall');
    await user.type(screen.getByLabelText(/purpose \*/i), 'Quarterly update');
    await user.type(screen.getByLabelText(/description \*/i), 'All-hands meeting for the team.');
    fireEvent.change(screen.getByLabelText(/start \*/i), { target: { value: '2026-12-01T09:00' } });
    fireEvent.change(screen.getByLabelText(/end \*/i), { target: { value: '2026-12-01T11:00' } });
    await user.type(screen.getByLabelText(/venue requirements \*/i), 'Projector and stage');
    await user.type(screen.getByLabelText(/accessibility needs \*/i), 'None');

    await user.click(screen.getByRole('button', { name: /submit for review/i }));

    await waitFor(() => expect(postPayload).toBeTruthy());
    expect(postPayload.name).toBe('Town Hall');
    expect(postPayload.startAt).toBe(new Date('2026-12-01T09:00').toISOString());
    await waitFor(() => expect(submitCalled).toBe(true));
    expect(await screen.findByText('Event Detail Page')).toBeInTheDocument();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth';
import { api } from '../api';
import EventDetail from './EventDetail';

jest.mock('../api', () => ({
  api: jest.fn(),
}));

describe('SCUM-16 (Event Clarification & Review Panel)', () => {
  const coordinatorUser = {
    id: 10,
    fullName: 'Chloe Lim',
    email: 'coordinator@connectsphere.sg',
    roles: ['EVENT_COORDINATOR'],
    organisationId: null,
  };

  const organiserUser = {
    id: 20,
    fullName: 'Aisha Rahman',
    email: 'organiser@acme.example',
    roles: ['EVENT_ORGANISER'],
    organisationId: 1,
  };

  beforeEach(() => {
    api.mockReset();
  });

  it('allows coordinator to view review panel and request clarification with remarks', async () => {
    const user = userEvent.setup();
    let sentRemarks = null;

    const eventData = {
      id: 5,
      name: 'Global AI Summit',
      purpose: 'Tech showcase',
      description: 'Annual gathering',
      status: 'UNDER_REVIEW',
      subState: 'IN_REVIEW',
      reviewRemarks: null,
      coordinatorId: 10,
      organiserId: 20,
      organisationName: 'Acme Corp',
      coordinatorName: 'Chloe Lim',
      organiserName: 'Aisha Rahman',
    };

    api.mockImplementation((path, options = {}) => {
      if (path === '/api/auth/me') return Promise.resolve({ user: coordinatorUser });
      if (path === '/api/events/5') return Promise.resolve({ event: eventData });
      if (path === '/api/events/5/history') return Promise.resolve({ history: [] });
      if (path === '/api/comments/5') return Promise.resolve({ comments: [] });
      if (path === '/api/venues') return Promise.resolve({ venues: [] });
      if (path === '/api/venues/bookings') return Promise.resolve({ bookings: [] });
      if (path === '/api/events/5/clarification' && options.method === 'POST') {
        sentRemarks = options.body.remarks;
        return Promise.resolve({
          event: { ...eventData, subState: 'ACTION_REQUIRED', reviewRemarks: sentRemarks },
        });
      }
      return Promise.reject(new Error(`Unhandled api: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={['/app/events/5']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/events/:id" element={<EventDetail />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Wait for event to load
    expect(await screen.findByText('Global AI Summit')).toBeInTheDocument();
    expect(screen.getByText(/coordinator review actions/i)).toBeInTheDocument();

    // Click "Request Clarification / Amendments"
    const reqBtn = screen.getByRole('button', { name: /request clarification \/ amendments/i });
    await user.click(reqBtn);

    // Enter review remarks
    const textarea = screen.getByPlaceholderText(/state incomplete details or amendments needed/i);
    await user.type(textarea, 'Please provide stage layout preference and catering headcount.');

    // Click "Send Clarification Request"
    const sendBtn = screen.getByRole('button', { name: /send clarification request/i });
    await user.click(sendBtn);

    await waitFor(() => {
      expect(sentRemarks).toBe('Please provide stage layout preference and catering headcount.');
    });
  });

  it('displays attention card to organizer when ACTION_REQUIRED and allows submitting clarification response', async () => {
    const user = userEvent.setup();
    let sentResponse = null;

    const eventNeedingAttention = {
      id: 5,
      name: 'Global AI Summit',
      purpose: 'Tech showcase',
      description: 'Annual gathering',
      status: 'UNDER_REVIEW',
      subState: 'ACTION_REQUIRED',
      reviewRemarks: 'Please clarify attendance numbers and seating layout.',
      coordinatorId: 10,
      organiserId: 20,
      organisationName: 'Acme Corp',
      coordinatorName: 'Chloe Lim',
      organiserName: 'Aisha Rahman',
    };

    api.mockImplementation((path, options = {}) => {
      if (path === '/api/auth/me') return Promise.resolve({ user: organiserUser });
      if (path === '/api/events/5') return Promise.resolve({ event: eventNeedingAttention });
      if (path === '/api/events/5/history') return Promise.resolve({ history: [] });
      if (path === '/api/comments/5') return Promise.resolve({ comments: [] });
      if (path === '/api/venues') return Promise.resolve({ venues: [] });
      if (path === '/api/venues/bookings') return Promise.resolve({ bookings: [] });
      if (path === '/api/events/5/clarification/respond' && options.method === 'POST') {
        sentResponse = options.body.response;
        return Promise.resolve({
          event: { ...eventNeedingAttention, subState: 'CLARIFICATION_PROVIDED', clarificationResponse: sentResponse },
        });
      }
      return Promise.reject(new Error(`Unhandled api: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={['/app/events/5']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/events/:id" element={<EventDetail />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Verify organizer sees the Action Required attention card
    expect(await screen.findByText(/action required: clarification requested/i)).toBeInTheDocument();
    expect(screen.getByText('Please clarify attendance numbers and seating layout.')).toBeInTheDocument();

    // Verify option to edit & amend details is present
    expect(screen.getByRole('link', { name: /edit & amend details/i })).toHaveAttribute(
      'href',
      '/app/events/5/edit'
    );

    // Click "Send Clarification Response"
    const openFormBtn = screen.getByRole('button', { name: /send clarification response/i });
    await user.click(openFormBtn);

    // Type response notes
    const responseInput = screen.getByPlaceholderText(/describe the changes made or answer/i);
    await user.type(responseInput, 'Attendance adjusted to 150 with banquet layout.');

    // Submit response
    const submitBtn = screen.getByRole('button', { name: /submit response/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(sentResponse).toBe('Attendance adjusted to 150 with banquet layout.');
    });
  });
});

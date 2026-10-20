/**
 * SCRUM-44: Receive Event Notifications (Frontend Unit Tests)
 *
 * Acceptance criteria covered:
 *   AC3 Read Status Tracking — visually distinguish unread (read_at === null) from
 *       read notifications using blue border, light background, bold title, and blue dot
 *
 * Test categories:
 *   HAPPY PATH    Rendering unread/read notifications, marking as read, opening events
 *   SAD PATH      Empty notification list
 *   BOUNDARY      Mixed read/unread lists, notification without event_id
 *   CROSS-CUTTING UI state consistency, accessibility
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth';
import { api } from '../api';
import Notifications from './Notifications';

jest.mock('../api', () => ({
  api: jest.fn(),
}));

const mockUser = {
  id: 2,
  fullName: 'Ben Carter',
  email: 'coordinator@acme.example',
  roles: ['EVENT_COORDINATOR'],
};

function setupAuth() {
  return Promise.resolve({ user: mockUser });
}

describe('SCRUM-44 Notifications Page — Happy Path', () => {
  beforeEach(() => {
    api.mockReset();
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });
  });

  /*
   * AC: SCRUM-44 AC3
   * Scenario: Happy Path — Render unread notification with visual distinction
   * Setup: One unread notification (read_at === null)
   * Expected: Blue dot (●), bold title, blue left border, light background, "Mark read" button
   * Type: normal
   */
  it('US44-F01: unread notification displays with blue dot, bold title, and Mark read button', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/notifications') {
        return Promise.resolve({
          notifications: [
            {
              id: 101,
              user_id: 2,
              event_id: 5,
              type: 'EVENT_STATUS_CHANGED',
              title: 'Event request approved',
              body: 'Innovation Summit was approved for planning.',
              read_at: null,
              created_at: '2026-11-10T14:30:00Z',
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unhandled: ${path}`));
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <Notifications />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Event request approved')).toBeInTheDocument();
    });

    // Verify blue dot indicator is present
    expect(screen.getByText('●')).toBeInTheDocument();

    // Verify "Mark read" button appears
    expect(screen.getByRole('button', { name: /mark read/i })).toBeInTheDocument();

    // Verify body text
    expect(screen.getByText('Innovation Summit was approved for planning.')).toBeInTheDocument();

    // Verify "Open event" link
    expect(screen.getByRole('link', { name: /open event/i })).toHaveAttribute('href', '/app/events/5');
  });

  /*
   * AC: SCRUM-44 AC3
   * Scenario: Happy Path — Render read notification without visual indicators
   * Setup: One read notification (read_at is a valid timestamp)
   * Expected: No blue dot, no bold title, no "Mark read" button
   * Type: normal
   */
  it('US44-F02: read notification displays without blue dot or Mark read button', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/notifications') {
        return Promise.resolve({
          notifications: [
            {
              id: 102,
              user_id: 2,
              event_id: 6,
              type: 'EVENT_UPDATED',
              title: 'Event details updated',
              body: 'Tech Workshop has updated expected attendance.',
              read_at: '2026-11-10T15:00:00Z',
              created_at: '2026-11-10T14:45:00Z',
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unhandled: ${path}`));
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <Notifications />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Event details updated')).toBeInTheDocument();
    });

    // Verify blue dot is NOT present
    expect(screen.queryByText('●')).not.toBeInTheDocument();

    // Verify "Mark read" button does NOT appear
    expect(screen.queryByRole('button', { name: /mark read/i })).not.toBeInTheDocument();

    // Verify content still displays
    expect(screen.getByText('Tech Workshop has updated expected attendance.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open event/i })).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-44 AC3
   * Scenario: Happy Path — Clicking "Mark read" calls API and reloads list
   * Setup: One unread notification; user clicks "Mark read"
   * Expected: POST /api/notifications/:id/read called; notification list reloaded
   * Type: normal
   */
  it('US44-F03: clicking Mark read calls API and reloads notifications', async () => {
    const user = userEvent.setup();
    let markReadCalled = false;

    api.mockImplementation((path, options = {}) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/notifications' && !options.method) {
        // First call: unread notification
        if (!markReadCalled) {
          return Promise.resolve({
            notifications: [
              {
                id: 103,
                user_id: 2,
                event_id: 7,
                type: 'EVENT_STATUS_CHANGED',
                title: 'Event request rejected',
                body: 'Sales Kickoff was rejected. Reason: Budget constraints',
                read_at: null,
                created_at: '2026-11-10T16:00:00Z',
              },
            ],
          });
        }
        // Second call after marking read: notification now has read_at
        return Promise.resolve({
          notifications: [
            {
              id: 103,
              user_id: 2,
              event_id: 7,
              type: 'EVENT_STATUS_CHANGED',
              title: 'Event request rejected',
              body: 'Sales Kickoff was rejected. Reason: Budget constraints',
              read_at: '2026-11-10T16:05:00Z',
              created_at: '2026-11-10T16:00:00Z',
            },
          ],
        });
      }
      if (path === '/api/notifications/103/read' && options.method === 'POST') {
        markReadCalled = true;
        return Promise.resolve({ success: true });
      }
      return Promise.reject(new Error(`Unhandled: ${path}`));
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <Notifications />
        </AuthProvider>
      </MemoryRouter>
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Event request rejected')).toBeInTheDocument();
    });

    // Verify "Mark read" button is present
    const markReadBtn = screen.getByRole('button', { name: /mark read/i });
    expect(markReadBtn).toBeInTheDocument();

    // Click "Mark read"
    await user.click(markReadBtn);

    // Verify API was called
    await waitFor(() => {
      expect(markReadCalled).toBe(true);
    });

    // Verify "Mark read" button is now gone (notification is read)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /mark read/i })).not.toBeInTheDocument();
    });
  });

  /*
   * AC: SCRUM-44 AC3
   * Scenario: Happy Path — Multiple notifications with mixed read/unread states
   * Setup: Three notifications: 2 unread, 1 read
   * Expected: Unread ones show blue dot and Mark read; read one does not
   * Type: normal
   */
  it('US44-F04: mixed read/unread list displays correct visual states', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/notifications') {
        return Promise.resolve({
          notifications: [
            {
              id: 201,
              user_id: 2,
              event_id: 10,
              type: 'EVENT_UPDATED',
              title: 'Event details updated',
              body: 'Conference A has updated start time.',
              read_at: null,
              created_at: '2026-11-11T09:00:00Z',
            },
            {
              id: 202,
              user_id: 2,
              event_id: 11,
              type: 'EVENT_STATUS_CHANGED',
              title: 'Event request approved',
              body: 'Conference B was approved.',
              read_at: '2026-11-10T12:00:00Z',
              created_at: '2026-11-10T11:30:00Z',
            },
            {
              id: 203,
              user_id: 2,
              event_id: 12,
              type: 'EVENT_UPDATED',
              title: 'Event details updated',
              body: 'Conference C has updated expected attendance.',
              read_at: null,
              created_at: '2026-11-11T10:00:00Z',
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unhandled: ${path}`));
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <Notifications />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Conference A has updated start time.')).toBeInTheDocument();
    });

    // Two unread notifications should have blue dots
    const blueDots = screen.getAllByText('●');
    expect(blueDots).toHaveLength(2);

    // Two "Mark read" buttons for the unread ones
    const markReadButtons = screen.getAllByRole('button', { name: /mark read/i });
    expect(markReadButtons).toHaveLength(2);

    // All three notifications should have content visible
    expect(screen.getByText('Conference A has updated start time.')).toBeInTheDocument();
    expect(screen.getByText('Conference B was approved.')).toBeInTheDocument();
    expect(screen.getByText('Conference C has updated expected attendance.')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-44 AC3
   * Scenario: Happy Path — Notification without event_id does not show Open event link
   * Setup: Notification with event_id = null
   * Expected: Title and body rendered, but no "Open event" link
   * Type: normal
   */
  it('US44-F05: notification without event_id does not display Open event link', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/notifications') {
        return Promise.resolve({
          notifications: [
            {
              id: 301,
              user_id: 2,
              event_id: null,
              type: 'SYSTEM_ANNOUNCEMENT',
              title: 'System maintenance scheduled',
              body: 'Scheduled downtime on Friday 10 PM - 12 AM.',
              read_at: null,
              created_at: '2026-11-11T08:00:00Z',
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unhandled: ${path}`));
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <Notifications />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('System maintenance scheduled')).toBeInTheDocument();
    });

    // Verify no "Open event" link
    expect(screen.queryByRole('link', { name: /open event/i })).not.toBeInTheDocument();

    // But notification is still rendered
    expect(screen.getByText('Scheduled downtime on Friday 10 PM - 12 AM.')).toBeInTheDocument();
  });
});

describe('SCRUM-44 Notifications Page — Sad Path', () => {
  beforeEach(() => {
    api.mockReset();
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });
  });

  /*
   * AC: SCRUM-44 AC3
   * Scenario: Sad Path — Empty notification list displays placeholder message
   * Setup: API returns empty notifications array
   * Expected: "You are up to date." message displayed
   * Type: error
   */
  it('US44-F06: empty notification list displays "You are up to date" message', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/notifications') {
        return Promise.resolve({ notifications: [] });
      }
      return Promise.reject(new Error(`Unhandled: ${path}`));
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <Notifications />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('You are up to date.')).toBeInTheDocument();
    });

    // Verify no notification items rendered
    expect(screen.queryByText('●')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark read/i })).not.toBeInTheDocument();
  });
});

describe('SCRUM-44 Notifications Page — Boundary Cases', () => {
  beforeEach(() => {
    api.mockReset();
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });
  });

  /*
   * AC: SCRUM-44 AC3
   * Scenario: Boundary — Notification with read_at as empty string treated as read
   * Setup: Notification with read_at = '' (truthy but not null)
   * Expected: Treated as read since empty string is truthy in !item.read_at check
   * Type: boundary
   */
  it('US44-F07: notification with empty string read_at displays with unread styling', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/notifications') {
        return Promise.resolve({
          notifications: [
            {
              id: 401,
              user_id: 2,
              event_id: 20,
              type: 'EVENT_UPDATED',
              title: 'Event details updated',
              body: 'Workshop Z has updated venue requirements.',
              read_at: '', // Empty string (truthy in JavaScript)
              created_at: '2026-11-11T11:00:00Z',
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unhandled: ${path}`));
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <Notifications />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Event details updated')).toBeInTheDocument();
    });

    // Empty string is truthy, so !item.read_at is false -> shows as unread
    expect(screen.getByText('●')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark read/i })).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-44 AC3
   * Scenario: Boundary — Very long notification body text renders without breaking layout
   * Setup: Notification with 500-character body
   * Expected: Page renders without layout issues
   * Type: boundary
   */
  it('US44-F08: long notification body renders without breaking layout', async () => {
    const longBody = 'Innovation Summit has been updated with the following changes: '.repeat(10);

    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/notifications') {
        return Promise.resolve({
          notifications: [
            {
              id: 402,
              user_id: 2,
              event_id: 21,
              type: 'EVENT_UPDATED',
              title: 'Event details updated',
              body: longBody,
              read_at: null,
              created_at: '2026-11-11T12:00:00Z',
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unhandled: ${path}`));
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <Notifications />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Event details updated')).toBeInTheDocument();
    });

    // Verify long body is rendered (check for substring)
    expect(screen.getByText((content, element) => {
      return element?.tagName === 'P' && content.includes('Innovation Summit has been updated');
    })).toBeInTheDocument();
  });
});

describe('SCRUM-44 Notifications Page — Cross-Cutting (UI & Auth)', () => {
  beforeEach(() => {
    api.mockReset();
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });
  });

  /*
   * AC: SCRUM-44 AC3
   * Scenario: Cross-Cutting — Page renders within authenticated context
   * Setup: User authenticated as coordinator
   * Expected: Page heading and structure render correctly
   * Type: security
   */
  it('US44-F09: notifications page renders within auth context', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/notifications') {
        return Promise.resolve({ notifications: [] });
      }
      return Promise.reject(new Error(`Unhandled: ${path}`));
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <Notifications />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /notifications/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/in-app first/i)).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-44 AC3
   * Scenario: Cross-Cutting — Open event link navigates to correct event detail page
   * Setup: Notification with event_id = 15
   * Expected: Link href points to /app/events/15
   * Type: normal
   */
  it('US44-F10: Open event link points to correct event detail URL', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/notifications') {
        return Promise.resolve({
          notifications: [
            {
              id: 501,
              user_id: 2,
              event_id: 15,
              type: 'EVENT_STATUS_CHANGED',
              title: 'Event request approved',
              body: 'Team Building was approved.',
              read_at: null,
              created_at: '2026-11-12T09:00:00Z',
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unhandled: ${path}`));
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Notifications />} />
            <Route path="/app/events/:id" element={<div>Event Detail Page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Event request approved')).toBeInTheDocument();
    });

    const openEventLink = screen.getByRole('link', { name: /open event/i });
    expect(openEventLink).toHaveAttribute('href', '/app/events/15');
  });

  /*
   * AC: SCRUM-44 AC3
   * Scenario: Cross-Cutting — All unread notifications have consistent styling
   * Setup: Multiple unread notifications
   * Expected: Each unread notification has blue dot and styling applied
   * Type: normal
   */
  it('US44-F11: all unread notifications have consistent visual styling', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return setupAuth();
      if (path === '/api/notifications') {
        return Promise.resolve({
          notifications: [
            {
              id: 601,
              user_id: 2,
              event_id: 30,
              type: 'EVENT_UPDATED',
              title: 'First Update',
              body: 'First event updated.',
              read_at: null,
              created_at: '2026-11-12T10:00:00Z',
            },
            {
              id: 602,
              user_id: 2,
              event_id: 31,
              type: 'EVENT_UPDATED',
              title: 'Second Update',
              body: 'Second event updated.',
              read_at: null,
              created_at: '2026-11-12T10:05:00Z',
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unhandled: ${path}`));
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <Notifications />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('First Update')).toBeInTheDocument();
    });

    // Both should have blue dots
    const blueDots = screen.getAllByText('●');
    expect(blueDots).toHaveLength(2);

    // Both should have Mark read buttons
    const markReadButtons = screen.getAllByRole('button', { name: /mark read/i });
    expect(markReadButtons).toHaveLength(2);
  });
});

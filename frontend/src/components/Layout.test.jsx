import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Layout from './Layout';
import { useAuth } from '../auth';

jest.mock('../auth', () => ({ useAuth: jest.fn() }));

function mount(roles) {
  useAuth.mockReturnValue({
    user: { fullName: 'Test User', roles },
    logout: jest.fn(),
    hasRole: (...allowed) => roles.some((role) => allowed.includes(role)),
  });
  render(
    <MemoryRouter initialEntries={['/app']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/app" element={<Layout />}>
          <Route index element={<p>Home</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('SCRUM-54 layout role recognition and nav limits', () => {
  /*
   * AC: SCRUM-54 AC1
   * Scenario: A Lead is signed in and looking at the chrome.
   * Setup: Session roles are only EVENT_COORDINATOR_LEAD.
   * Expected: The header shows the Lead label, and Lead-only nav is present.
   * Type: normal
   */
  it('shows the Lead label and Lead-only links after a Lead logs in', () => {
    mount(['EVENT_COORDINATOR_LEAD']);
    expect(screen.getByText('Lead')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Unassigned queue' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Assignments' })).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC1
   * Scenario: A Safety Officer is signed in.
   * Setup: Session roles are only SAFETY_OFFICER.
   * Expected: The header shows "Safety Officer". They do not get Lead-only nav.
   * Type: normal
   */
  it('shows the Safety Officer label and not Lead-only links', () => {
    mount(['SAFETY_OFFICER']);
    expect(screen.getByText('Safety Officer')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Unassigned queue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Assignments' })).not.toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC2
   * Scenario: A Coordinator + Lead hybrid uses the same session.
   * Setup: Both EVENT_COORDINATOR and EVENT_COORDINATOR_LEAD.
   * Expected: Both role pills show, and they get Coordinator drafts plus Lead queue links.
   * Type: normal
   */
  it('shows functions of every held role for a Coordinator + Lead hybrid', () => {
    mount(['EVENT_COORDINATOR', 'EVENT_COORDINATOR_LEAD']);
    expect(screen.getByText('Event Coordinator')).toBeInTheDocument();
    expect(screen.getByText('Lead')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My drafts' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Unassigned queue' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Assignments' })).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-54 AC3
   * Scenario: An Event Coordinator who is not a Lead looks at the nav.
   * Setup: Session role EVENT_COORDINATOR only.
   * Expected: Unassigned queue and Assignments links are not offered.
   * Type: error
   */
  it('hides the unassigned queue and assignment overview from a Coordinator who is not a Lead', () => {
    mount(['EVENT_COORDINATOR']);
    expect(screen.queryByRole('link', { name: 'Unassigned queue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Assignments' })).not.toBeInTheDocument();
  });
});

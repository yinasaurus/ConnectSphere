import { render, screen } from '@testing-library/react';
import EventRegistrationsCard from '../../src/components/EventRegistrationsCard';

/**
 * SCRUM-74: what the Organiser/assigned Coordinator's Registrations card shows. The
 * eligibility rules themselves are checked by the API (backend/tests/registrations.list.test.js).
 */
function data(overrides = {}) {
  return {
    registrations: [
      { id: 10, attendee_name: 'Hari Patel', attendee_email: 'attendee@example.com', status: 'REGISTERED' },
      { id: 11, attendee_name: 'Ben Tan', attendee_email: 'ben@example.com', status: 'WITHDRAWN' },
    ],
    activeCount: 1,
    capacity: 50,
    ...overrides,
  };
}

describe('SCRUM-74 EventRegistrationsCard', () => {
  /*
  * AC:       SCRUM-74 (AC1: The Organiser of an event can view its registrations, including each attendee
  *           and their registration status.) (AC3: The view shows the number of active registrations against
  *           the event's maximum capacity. Withdrawn registrations are listed with their status but not counted.)
  * Scenario: An Organiser opens the card for an event with a registered and a withdrawn attendee.
  * Setup:    data() returns 2 registrations (1 REGISTERED, 1 WITHDRAWN), activeCount 1, capacity 50.
  * Expected: both attendees are listed with their status, and the active count (1) is shown
  *           against capacity (50) — the withdrawn one isn't counted.
  * Type:     normal
  */
  // SCRUM-74-TC14
  it('lists every attendee with their status and the active count against capacity', () => {
    render(<EventRegistrationsCard data={data()} />);

    expect(screen.getByText('Hari Patel')).toBeInTheDocument();
    expect(screen.getByText('Registered')).toBeInTheDocument();
    expect(screen.getByText('Ben Tan')).toBeInTheDocument();
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
    expect(screen.getByText('1 of 50')).toBeInTheDocument();
  });

  /*
  * AC:       SCRUM-74 (AC4: An event with no registrations shows a count of zero.)
  * Scenario: An event with no registrations at all.
  * Setup:    data overridden with registrations: [], activeCount: 0, capacity: 50.
  * Expected: a count of zero is shown, not a blank card, with an explicit "no one yet" message.
  * Type:     boundary
  */
  // SCRUM-74-TC15
  it('shows a count of zero when nobody has registered', () => {
    render(<EventRegistrationsCard data={{ registrations: [], activeCount: 0, capacity: 50 }} />);

    expect(screen.getByText('0 of 50')).toBeInTheDocument();
    expect(screen.getByText('No one has registered for this event yet.')).toBeInTheDocument();
  });

  /*
  * AC:       SCRUM-74 (defensive boundary for the SCRUM-63 interaction)
  * Scenario: registration was never enabled (SCRUM-63), so there is no capacity to show.
  * Setup:    data overridden with registrations: [], activeCount: 0, capacity: null.
  * Expected: the card says so instead of claiming a capacity of zero.
  * Type:     boundary
  */
  // SCRUM-74-TC16
  it('explains when registration has not been enabled yet, instead of showing 0 capacity', () => {
    render(<EventRegistrationsCard data={{ registrations: [], activeCount: 0, capacity: null }} />);
    expect(screen.getByText('0 (registration not yet enabled)')).toBeInTheDocument();
  });

  /*
  * AC:       SCRUM-74 (generic UI robustness, the actual AC5 rejection is enforced and tested on
  *           the backend route (see TC10, TC13)
  * Scenario: the data couldn't be loaded (e.g. the API rejected the request, for any reason).
  * Setup:    data prop passed as null (simulating a failed load).
  * Expected: the card says so rather than rendering nothing or crashing.
  * Type:     error
  */
  // SCRUM-74-TC17
  it('says so when registration details cannot be loaded', () => {
    render(<EventRegistrationsCard data={null} />);
    expect(screen.getByText('Registration details are not available right now.')).toBeInTheDocument();
  });

  /*
  * AC:       SCRUM-74 (defensive UI fallback)
  * Scenario: A registration row with no attendee_name or attendee_email (bad/partial data).
  * Setup:    data() overridden with a row where attendee_name and attendee_email are null.
  * Expected: the card falls back to "Unnamed attendee" instead of rendering blank or crashing.
  * Type:     boundary
  */
  // SCRUM-74-TC18
  it('falls back to "Unnamed attendee" when the name is missing', () => {
    render(<EventRegistrationsCard data={data({
      registrations: [{ id: 12, attendee_name: null, attendee_email: null, status: 'REGISTERED' }],
    })}
    />);
    expect(screen.getByText('Unnamed attendee')).toBeInTheDocument();
  });
});

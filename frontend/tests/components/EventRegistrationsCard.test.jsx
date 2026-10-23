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
   * AC: SCRUM-74 AC1, AC3
   * Scenario: An Organiser opens the card for an event with a registered and a withdrawn attendee.
   * Expected: both attendees are listed with their status, and the active count (1) is shown
   *   against capacity (50) — the withdrawn one isn't counted.
   */
  // SCRUM-74-TC12
  it('US74-F01: lists every attendee with their status and the active count against capacity', () => {
    render(<EventRegistrationsCard data={data()} />);

    expect(screen.getByText('Hari Patel')).toBeInTheDocument();
    expect(screen.getByText('Registered')).toBeInTheDocument();
    expect(screen.getByText('Ben Tan')).toBeInTheDocument();
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
    expect(screen.getByText('1 of 50')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-74 AC4
   * Scenario: An event with no registrations at all.
   * Expected: a count of zero is shown, not a blank card, with an explicit "no one yet" message.
   */
  // SCRUM-74-TC13
  it('US74-F02: shows a count of zero when nobody has registered', () => {
    render(<EventRegistrationsCard data={{ registrations: [], activeCount: 0, capacity: 50 }} />);

    expect(screen.getByText('0 of 50')).toBeInTheDocument();
    expect(screen.getByText('No one has registered for this event yet.')).toBeInTheDocument();
  });

  /*
   * Scenario: registration was never enabled (SCRUM-63), so there is no capacity to show.
   * Expected: the card says so instead of claiming a capacity of zero.
   */
  // SCRUM-74-TC14
  it('US74-F03: explains when registration has not been enabled yet, instead of showing 0 capacity', () => {
    render(<EventRegistrationsCard data={{ registrations: [], activeCount: 0, capacity: null }} />);
    expect(screen.getByText('0 (registration not yet enabled)')).toBeInTheDocument();
  });

  /*
   * AC: SCRUM-74 AC5
   * Scenario: the data couldn't be loaded (e.g. the API rejected the request).
   * Expected: the card says so rather than rendering nothing or crashing.
   */
  // SCRUM-74-TC15
  it('US74-F04: says so when registration details cannot be loaded', () => {
    render(<EventRegistrationsCard data={null} />);
    expect(screen.getByText('Registration details are not available right now.')).toBeInTheDocument();
  });

  // SCRUM-74-TC16
  it('US74-F05: falls back to "Unnamed attendee" when the name is missing', () => {
    render(<EventRegistrationsCard data={data({
      registrations: [{ id: 12, attendee_name: null, attendee_email: null, status: 'REGISTERED' }],
    })}
    />);
    expect(screen.getByText('Unnamed attendee')).toBeInTheDocument();
  });
});

/**
 * SCRUM-5: every lifecycle status is shown to users with its AC1 name.
 */
import { render, screen } from '@testing-library/react';
import StatusBadge from '../../src/components/StatusBadge';

describe('SCRUM-5 StatusBadge labels', () => {
  // AC1 · Each of the 11 statuses shows the name used in the story.
  it.each([
    // SCRUM-5-TC36
    ['DRAFT', 'Draft'],
    // SCRUM-5-TC37
    ['SUBMITTED', 'Submitted'],
    // SCRUM-5-TC38
    ['UNDER_REVIEW', 'Under Review'],
    // SCRUM-5-TC39
    ['APPROVED', 'Approved'],
    // SCRUM-5-TC40
    ['PLANNING', 'Planning'],
    // SCRUM-5-TC41
    ['AWAITING_SAFETY_CHECK', 'Awaiting Safety Check'],
    // SCRUM-5-TC42
    ['PREPARATION', 'Preparation'],
    // SCRUM-5-TC43
    ['CONFIRMED', 'Confirmed'],
    // SCRUM-5-TC44
    ['COMPLETED', 'Completed'],
    // SCRUM-5-TC45
    ['CANCELLED', 'Cancelled'],
    // SCRUM-5-TC46
    ['REJECTED', 'Rejected'],
  ])('US5-F01: %s is shown as "%s"', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  // A status with no label (e.g. old data) is shown as its raw value instead of a blank badge.
  // SCRUM-5-TC47
  it('US5-F04: an unknown status falls back to its stored value', () => {
    render(<StatusBadge status="VENUE_SECURED" />);
    expect(screen.getByText('VENUE_SECURED')).toBeInTheDocument();
  });
});

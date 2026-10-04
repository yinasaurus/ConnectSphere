/**
 * SCRUM-5: every lifecycle status is shown to users with its AC1 name.
 */
import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';

describe('SCRUM-5 StatusBadge labels', () => {
  // AC1 · Each of the 11 statuses shows the name used in the story.
  it.each([
    ['DRAFT', 'Draft'],
    ['SUBMITTED', 'Submitted'],
    ['UNDER_REVIEW', 'Under Review'],
    ['APPROVED', 'Approved'],
    ['PLANNING', 'Planning'],
    ['AWAITING_SAFETY_CHECK', 'Awaiting Safety Check'],
    ['PREPARATION', 'Preparation'],
    ['CONFIRMED', 'Confirmed'],
    ['COMPLETED', 'Completed'],
    ['CANCELLED', 'Cancelled'],
    ['REJECTED', 'Rejected'],
  ])('US5-F01: %s is shown as "%s"', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  // A status with no label (e.g. old data) is shown as its raw value instead of a blank badge.
  it('US5-F04: an unknown status falls back to its stored value', () => {
    render(<StatusBadge status="VENUE_SECURED" />);
    expect(screen.getByText('VENUE_SECURED')).toBeInTheDocument();
  });
});

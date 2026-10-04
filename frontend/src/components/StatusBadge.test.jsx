/**
 * SCRUM-5: users see the lifecycle in the acceptance criterion's wording, even though the
 * stored values are UNDER_REVIEW / PLANNING / VENUE_SECURED.
 */
import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';

describe('SCRUM-5 StatusBadge labels', () => {
  // AC1 · Each stored status shows the label from the AC's lifecycle.
  it.each([
    ['DRAFT', 'Draft'],
    ['UNDER_REVIEW', 'Pending review'],
    ['PLANNING', 'Approved - pending venue'],
    ['VENUE_SECURED', 'Venue secured'],
    ['CONFIRMED', 'Confirmed'],
    ['COMPLETED', 'Completed'],
    ['REJECTED', 'Rejected'],
    ['CANCELLED', 'Cancelled'],
  ])('US5-F01: %s is shown as "%s"', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

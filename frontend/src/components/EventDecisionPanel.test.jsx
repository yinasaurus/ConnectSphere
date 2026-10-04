/**
 * SCRUM-17: Approve or Reject Event Request (frontend unit tests for the review panel)
 *
 * Acceptance criteria covered:
 *   AC1  Explicit "Approve" and "Reject" buttons for events under review.
 *   AC2  Rejecting requires a reason of at least 10 characters; a shorter one is blocked
 *        with the inline message "Rejection reason must be at least 10 characters".
 *   AC3  Approving sends an APPROVE decision (the backend moves the event to PLANNING).
 *
 * Labels: US17-F01 to US17-F11 (this file), US17-F12 to US17-F16 (EventDetail.test.jsx).
 *
 * The panel never calls the API itself. It calls `onDecide(decision, reason)`, so each
 * test checks whether onDecide was called, and with what.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventDecisionPanel from './EventDecisionPanel';

// Typed out (not imported) so the test fails if the on-screen message drifts from AC2.
const REASON_ERROR = 'Rejection reason must be at least 10 characters';

function renderPanel(onDecide = jest.fn().mockResolvedValue()) {
  render(<EventDecisionPanel onDecide={onDecide} />);
  return { onDecide, user: userEvent.setup() };
}

describe('SCRUM-17 EventDecisionPanel', () => {
  // AC1 · Happy path: both decision buttons are visible straight away.
  it('US17-F01: shows explicit Approve and Reject buttons', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  // AC3 · Happy path: the optional comment is trimmed before it's sent with APPROVE.
  it('US17-F02: approving sends APPROVE with the trimmed optional comment', async () => {
    const { onDecide, user } = renderPanel();
    await user.type(screen.getByLabelText(/comment for the organiser/i), '  Looks good  ');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('APPROVE', 'Looks good');
  });

  // AC3 · Edge case: approval works with no comment (the comment is optional).
  it('US17-F03: approving without a comment is allowed', async () => {
    const { onDecide, user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('APPROVE', '');
  });

  // AC2 · Flow: Reject does not reject immediately. It opens the reason box first,
  // so a coordinator can't reject by accident without giving a reason.
  it('US17-F04: clicking Reject asks for a reason before anything is sent', async () => {
    const { onDecide, user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByLabelText('Rejection reason')).toBeInTheDocument();
    expect(onDecide).not.toHaveBeenCalled();
  });

  // AC2 · Boundary (minimum - 1) and trimming. Mirrors manual test case IS212-US17-TC1:
  //   - "Too short" is 9 characters
  //   - spaces around it prove the count ignores leading/trailing whitespace
  // The inline error must show and nothing is sent.
  it.each([
    ['"Too short" (9 characters, boundary - 1)', 'Too short'],
    ['spaces around a short reason', '     Too short     '],
  ])('US17-F05: a rejection reason of %s is blocked with an inline error', async (_label, text) => {
    const { onDecide, user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText('Rejection reason'), text);
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(screen.getByRole('alert')).toHaveTextContent(REASON_ERROR);
    expect(onDecide).not.toHaveBeenCalled();
  });

  // AC2 · Negative: confirming with an empty box is blocked the same way.
  it('US17-F06: an empty rejection reason is blocked', async () => {
    const { onDecide, user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(screen.getByRole('alert')).toHaveTextContent(REASON_ERROR);
    expect(onDecide).not.toHaveBeenCalled();
  });

  // AC2 · Boundary (= minimum): "Incomplete" is exactly 10 characters and is sent.
  it('US17-F07: a rejection reason of exactly 10 characters is sent (boundary)', async () => {
    const { onDecide, user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText('Rejection reason'), 'Incomplete');
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(onDecide).toHaveBeenCalledWith('REJECT', 'Incomplete');
  });

  // AC2 · Usability: a live counter tells the coordinator how close they are to the
  // minimum ("Missing" is 7 characters).
  it('US17-F08: shows a live character counter for the reason', async () => {
    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText('Rejection reason'), 'Missing');
    expect(screen.getByText('7 / 10 characters minimum')).toBeInTheDocument();
  });

  // AC2 · Usability: once the coordinator starts fixing the reason, the error goes away.
  it('US17-F09: typing after an error clears the inline error', async () => {
    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Rejection reason'), 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // AC1 · Flow: Cancel backs out of rejecting, shows Approve / Reject again, and
  // doesn't keep a half-written reason for next time.
  it('US17-F10: Cancel returns to the Approve / Reject choice and discards the reason', async () => {
    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText('Rejection reason'), 'Some reason text');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByLabelText('Rejection reason')).toHaveValue('');
  });

  // Edge case: while the request is in flight the buttons are disabled, so a double
  // click can't send two decisions. onDecide is held open until `finish()` is called.
  it('US17-F11: buttons are disabled while the decision is being saved', async () => {
    let finish;
    const onDecide = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { user } = renderPanel(onDecide);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
  });
});

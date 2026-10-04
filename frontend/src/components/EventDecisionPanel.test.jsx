import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventDecisionPanel from './EventDecisionPanel';

const REASON_ERROR = 'Rejection reason must be at least 10 characters';

function renderPanel(onDecide = jest.fn().mockResolvedValue()) {
  render(<EventDecisionPanel onDecide={onDecide} />);
  return { onDecide, user: userEvent.setup() };
}

describe('SCRUM-17 EventDecisionPanel', () => {
  it('US17-F01: shows explicit Approve and Reject buttons', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('US17-F02: approving sends APPROVE with the trimmed optional comment', async () => {
    const { onDecide, user } = renderPanel();
    await user.type(screen.getByLabelText(/comment for the organiser/i), '  Looks good  ');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('APPROVE', 'Looks good');
  });

  it('US17-F03: approving without a comment is allowed', async () => {
    const { onDecide, user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('APPROVE', '');
  });

  it('US17-F04: clicking Reject asks for a reason before anything is sent', async () => {
    const { onDecide, user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByLabelText('Rejection reason')).toBeInTheDocument();
    expect(onDecide).not.toHaveBeenCalled();
  });

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

  it('US17-F06: an empty rejection reason is blocked', async () => {
    const { onDecide, user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(screen.getByRole('alert')).toHaveTextContent(REASON_ERROR);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('US17-F07: a rejection reason of exactly 10 characters is sent (boundary)', async () => {
    const { onDecide, user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText('Rejection reason'), 'Incomplete');
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(onDecide).toHaveBeenCalledWith('REJECT', 'Incomplete');
  });

  it('US17-F08: shows a live character counter for the reason', async () => {
    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText('Rejection reason'), 'Missing');
    expect(screen.getByText('7 / 10 characters minimum')).toBeInTheDocument();
  });

  it('US17-F09: typing after an error clears the inline error', async () => {
    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Rejection reason'), 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('US17-F10: Cancel returns to the Approve / Reject choice and discards the reason', async () => {
    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText('Rejection reason'), 'Some reason text');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByLabelText('Rejection reason')).toHaveValue('');
  });

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

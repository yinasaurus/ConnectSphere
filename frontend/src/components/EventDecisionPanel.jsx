import { useState } from 'react';
import { MIN_REJECTION_REASON_LENGTH } from '../constants';

const REASON_ERROR = `Rejection reason must be at least ${MIN_REJECTION_REASON_LENGTH} characters`;

export default function EventDecisionPanel({ onDecide }) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reasonLength = reason.trim().length;

  async function decide(decision, text) {
    setSubmitting(true);
    try {
      await onDecide(decision, text);
    } finally {
      setSubmitting(false);
    }
  }

  function confirmRejection() {
    if (reasonLength < MIN_REJECTION_REASON_LENGTH) {
      setReasonError(REASON_ERROR);
      return;
    }
    setReasonError('');
    decide('REJECT', reason.trim());
  }

  function cancelRejection() {
    setRejecting(false);
    setReason('');
    setReasonError('');
  }

  if (rejecting) {
    return (
      <div className="stack">
        <label htmlFor="rejection-reason">Rejection reason</label>
        <textarea
          id="rejection-reason"
          value={reason}
          aria-invalid={Boolean(reasonError)}
          className={reasonError ? 'field-error' : ''}
          onChange={(e) => {
            setReason(e.target.value);
            if (reasonError) setReasonError('');
          }}
          placeholder="Tell the organiser what needs to change before resubmitting"
        />
        <p className="muted">
          {reasonLength} / {MIN_REJECTION_REASON_LENGTH} characters minimum
        </p>
        {reasonError && <p className="field-error" role="alert">{reasonError}</p>}
        <div className="actions">
          <button className="btn danger" disabled={submitting} onClick={confirmRejection}>
            {submitting ? 'Rejecting…' : 'Confirm rejection'}
          </button>
          <button className="btn ghost" disabled={submitting} onClick={cancelRejection}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <label htmlFor="approval-comment">Comment for the organiser (optional)</label>
      <textarea
        id="approval-comment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="actions">
        <button className="btn" disabled={submitting} onClick={() => decide('APPROVE', comment.trim())}>
          {submitting ? 'Approving…' : 'Approve'}
        </button>
        <button className="btn danger" disabled={submitting} onClick={() => setRejecting(true)}>
          Reject
        </button>
      </div>
    </div>
  );
}

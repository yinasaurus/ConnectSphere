import { useState } from 'react';
import Button from './Button';
import FieldError from './FieldError';
import { MIN_REJECTION_REASON_LENGTH } from '../constants';

const REASON_ERROR = `Rejection reason must be at least ${MIN_REJECTION_REASON_LENGTH} characters`;

export default function EventDecisionPanel({ onDecide, extra = null }) {
  const [mode, setMode] = useState(null);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reasonLength = reason.trim().length;

  function openMode(next) {
    setMode(next);
  }

  async function decide(decision, text) {
    setSubmitting(true);
    try {
      await onDecide(decision, text);
    } finally {
      setSubmitting(false);
      setMode(null);
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

  function closeForm() {
    setMode(null);
    setComment('');
    setReason('');
    setReasonError('');
  }

  return (
    <div className="review-actions">
      <Button disabled={submitting} onClick={() => openMode('approve')}>
        Approve
      </Button>
      <Button variant="danger" disabled={submitting} onClick={() => openMode('reject')}>
        Reject
      </Button>
      {extra}
      {mode === 'approve' && (
        <div className="review-inline">
          <label htmlFor="approval-comment">Comment for the organiser (optional)</label>
          <textarea
            id="approval-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a note for the organiser"
          />
          <div className="actions">
            <Button disabled={submitting} onClick={() => decide('APPROVE', comment.trim())}>
              {submitting ? 'Approving…' : 'Confirm approval'}
            </Button>
            <Button variant="ghost" disabled={submitting} onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {mode === 'reject' && (
        <div className="review-inline">
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
          <FieldError>{reasonError}</FieldError>
          <div className="actions">
            <Button variant="danger" disabled={submitting} onClick={confirmRejection}>
              {submitting ? 'Rejecting…' : 'Confirm rejection'}
            </Button>
            <Button variant="ghost" disabled={submitting} onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

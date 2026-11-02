import { useState } from 'react';
import ConfirmModal from './ConfirmModal';
import Button from './Button';
import FieldError from './FieldError';
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

  return (
    <div className="review-decision">
      <div className="review-approval">
        <label htmlFor="approval-comment">Comment for the organiser (sent with Approve)</label>
        <textarea
          id="approval-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <Button disabled={submitting} onClick={() => decide('APPROVE', comment.trim())}>
          {submitting ? 'Approving…' : 'Approve'}
        </Button>
      </div>
      <Button variant="danger" disabled={submitting} onClick={() => setRejecting(true)}>
        Reject
      </Button>
      <ConfirmModal
        open={rejecting}
        title="Reject this event?"
        confirmLabel={submitting ? 'Rejecting…' : 'Confirm rejection'}
        busy={submitting}
        onConfirm={confirmRejection}
        onCancel={cancelRejection}
      >
        <div className="confirm-modal-body">
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
        </div>
      </ConfirmModal>
    </div>
  );
}

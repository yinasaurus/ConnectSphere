import { useState } from 'react';
import ConfirmModal from './ConfirmModal';
import Button from './Button';
import FieldError from './FieldError';
import { MIN_REJECTION_REASON_LENGTH } from '../constants';

const REASON_ERROR = `Rejection reason must be at least ${MIN_REJECTION_REASON_LENGTH} characters`;

export default function EventDecisionPanel({ onDecide }) {
  const [mode, setMode] = useState(null);
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

  function closeDialog() {
    setMode(null);
    setComment('');
    setReason('');
    setReasonError('');
  }

  return (
    <div className="actions">
      <Button disabled={submitting} onClick={() => setMode('approve')}>
        Approve
      </Button>
      <Button variant="danger" disabled={submitting} onClick={() => setMode('reject')}>
        Reject
      </Button>
      <ConfirmModal
        open={mode === 'approve'}
        title="Approve this event?"
        confirmLabel={submitting ? 'Approving…' : 'Confirm approval'}
        confirmVariant="primary"
        busy={submitting}
        onConfirm={() => decide('APPROVE', comment.trim())}
        onCancel={closeDialog}
      >
        <div className="confirm-modal-body">
          <label htmlFor="approval-comment">Comment for the organiser (optional)</label>
          <textarea
            id="approval-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a note for the organiser"
          />
        </div>
      </ConfirmModal>
      <ConfirmModal
        open={mode === 'reject'}
        title="Reject this event?"
        confirmLabel={submitting ? 'Rejecting…' : 'Confirm rejection'}
        busy={submitting}
        onConfirm={confirmRejection}
        onCancel={closeDialog}
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

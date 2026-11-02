import { STATUS_LABELS, SUB_STATE_LABELS } from '../constants';

// A hold is stored as TENTATIVE and shown as HELD. Other booking statuses keep their stored word.
const BOOKING_LABELS = { TENTATIVE: 'HELD' };

export default function StatusBadge({ status, subState, kind = 'event' }) {
  if (kind === 'booking') {
    return (
      <span className={`badge badge-booking ${status || ''}`}>
        {BOOKING_LABELS[status] || status}
      </span>
    );
  }
  if (status === 'UNDER_REVIEW' && subState && subState !== 'IN_REVIEW') {
    return (
      <span className={`badge ${subState}`} title={`Status: Under review (${SUB_STATE_LABELS[subState] || subState})`}>
        {SUB_STATE_LABELS[subState] || subState}
      </span>
    );
  }
  return <span className={`badge ${status}`}>{STATUS_LABELS[status] || status}</span>;
}

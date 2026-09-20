import { STATUS_LABELS, SUB_STATE_LABELS } from '../constants';

export default function StatusBadge({ status, subState }) {
  if (status === 'UNDER_REVIEW' && subState && subState !== 'IN_REVIEW') {
    return (
      <span className={`badge ${subState}`} title={`Status: Under review (${SUB_STATE_LABELS[subState] || subState})`}>
        {SUB_STATE_LABELS[subState] || subState}
      </span>
    );
  }
  return <span className={`badge ${status}`}>{STATUS_LABELS[status] || status}</span>;
}

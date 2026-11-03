import { STATUS_LABELS, SUB_STATE_LABELS } from '../constants';

// A hold is stored as TENTATIVE and shown as HELD. Other booking statuses keep their stored word.
const BOOKING_LABELS = { TENTATIVE: 'HELD' };

const REGISTRATION_LABELS = {
  REGISTERED: 'Registered',
  WAITLISTED: 'Waitlisted',
  WITHDRAWN: 'Withdrawn',
  ATTENDED: 'Attended',
  NO_SHOW: 'Did not attend',
};

export default function StatusBadge({ status, subState, kind = 'event' }) {
  if (kind === 'booking') {
    return (
      <span className={`badge badge-booking ${status || ''}`}>
        {BOOKING_LABELS[status] || status}
      </span>
    );
  }
  if (kind === 'registration') {
    return (
      <span className={`badge ${status || ''}`}>
        {REGISTRATION_LABELS[status] || status}
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

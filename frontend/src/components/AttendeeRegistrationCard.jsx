const STATE_TEXT = {
  OPEN: 'Registration is open.',
  FULL: 'This event is full.',
  NOT_OPEN: 'Registration is not open for this event.',
  STARTED: 'This event has already started, so registration is closed.',
};

const MY_STATUS_TEXT = {
  REGISTERED: 'Registered',
  WAITLISTED: 'Waitlisted',
  WITHDRAWN: 'Withdrawn',
  ATTENDED: 'Attended',
  NO_SHOW: 'Did not attend',
};

function when(value) {
  return new Date(value).toLocaleString();
}

function stateText(status) {
  if (status.state === 'NOT_YET_OPEN') return `Registration opens on ${when(status.opensAt)}.`;
  if (status.state === 'CLOSED') return `Registration closed on ${when(status.closesAt)}.`;
  return STATE_TEXT[status.state];
}

function myRegistrationText(mine) {
  if (!mine) return 'Not registered';
  const label = MY_STATUS_TEXT[mine.status] || mine.status;
  if (mine.status === 'WITHDRAWN' && mine.withdrawnAt) return `${label} on ${when(mine.withdrawnAt)}`;
  if (mine.status === 'REGISTERED') return `${label} on ${when(mine.registeredAt)}`;
  return label;
}

/**
 * Purpose: the Attendee's view of registration for one event: whether they can register,
 *   the window and places left, and their own current registration status.
 * AC: SCRUM-51 AC1 (event registration information), AC2 (own registration status);
 *   SCRUM-52 (Register button), SCRUM-53 (Withdraw button).
 * Inputs: status (from GET /api/events/:id/registration-status, or null while it can't be
 *   loaded), registering (true while a Register request is running), onRegister(), onWithdraw().
 *   The server still checks every rule.
 */
export default function AttendeeRegistrationCard({ status, registering = false, onRegister, onWithdraw }) {
  if (!status) {
    return (
      <div className="card stack">
        <h3>Registration</h3>
        <p className="muted">Registration details are not available right now.</p>
      </div>
    );
  }

  const mine = status.myRegistration;
  const hasActiveRegistration = Boolean(mine) && ['REGISTERED', 'WAITLISTED'].includes(mine.status);
  const canRegister = status.state === 'OPEN' && (!mine || mine.status === 'WITHDRAWN');

  return (
    <div className="card stack">
      <h3>Registration</h3>
      <p>{stateText(status)}</p>
      {status.opensAt && (
        <>
          <p><strong>Opens:</strong> {when(status.opensAt)}</p>
          <p><strong>Closes:</strong> {when(status.closesAt)}</p>
          <p><strong>Places left:</strong> {status.placesLeft} of {status.capacity}</p>
        </>
      )}
      <p><strong>Your registration:</strong> {myRegistrationText(mine)}</p>
      {(canRegister || hasActiveRegistration) && (
        <div className="actions">
          {canRegister && (
            <button className="btn" onClick={onRegister} disabled={registering}>
              {registering ? 'Registering...' : 'Register'}
            </button>
          )}
          {hasActiveRegistration && <button className="btn ghost" onClick={onWithdraw}>Withdraw</button>}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';

/**
 * Purpose: Safety Officer screen to open a safety check and record its outcome.
 * AC: SCRUM-54 AC4, AC7
 * Business rule: W7 #6
 * Inputs: event id from the route; GET then POST /api/events/:id/safety-check.
 * Output: the check form. Failure: 403 shows the server message and no extra
 * event details from the blocked response.
 */
export default function SafetyCheck() {
  const { id } = useParams();
  const [check, setCheck] = useState(null);
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    api(`/api/events/${id}/safety-check`)
      .then((data) => setCheck(data.safetyCheck))
      .catch((err) => setError(err.message));
  }, [id]);

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const data = await api(`/api/events/${id}/safety-check`, {
        method: 'POST',
        body: { outcome },
      });
      setCheck(data.safetyCheck);
      setMessage('Safety check outcome recorded.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Safety check</h1>
          <p>Only a Safety Officer can open this check or record its outcome.</p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      {message && <div className="alert success">{message}</div>}
      {check && (
        <form className="card stack" onSubmit={onSubmit} style={{ maxWidth: 520 }}>
          <p><strong>Event:</strong> {check.eventName || `Event ${check.eventId}`}</p>
          <label htmlFor="safety-outcome">Outcome</label>
          <textarea
            id="safety-outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="Record the safety-check outcome"
          />
          <div className="actions">
            <button className="btn" type="submit" disabled={!outcome.trim()}>Record outcome</button>
            <Link className="btn ghost" to={`/app/events/${id}`}>Back to event</Link>
          </div>
        </form>
      )}
    </>
  );
}

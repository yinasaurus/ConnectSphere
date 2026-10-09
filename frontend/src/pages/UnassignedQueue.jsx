import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

/**
 * Purpose: format start/end so the Lead can compare request times at a glance.
 * AC: SCRUM-65 AC4 — the queue shows each request's date/time.
 * Inputs: ISO start/end. Outputs: a locale string, or TBC when the start is missing.
 */
function formatQueueDateTime(startAt, endAt) {
  if (!startAt) return 'TBC';
  const start = new Date(startAt).toLocaleString();
  if (!endAt) return start;
  return `${start} – ${new Date(endAt).toLocaleString()}`;
}

/**
 * Purpose: show venue/equipment text, or an em dash when the organiser left it blank.
 * AC: SCRUM-65 AC4 — the column is always present even when the value is empty.
 * Inputs: a string or null. Outputs: the trimmed text, or '—'.
 */
function displayNeed(value) {
  const text = value == null ? '' : String(value).trim();
  return text || '—';
}

/**
 * Purpose: Lead's unassigned queue — every Submitted request that still has no Coordinator.
 * AC: SCRUM-65 AC1, AC2, AC3, AC4, AC5
 * Business rule: W7 #5 — the Lead sees basic event information before choosing a Coordinator.
 * Inputs: GET /api/events/unassigned-queue (Lead-only). Membership is enforced by the API.
 * Outputs: a table of queued requests; the event name opens full details (AC5).
 * Failure: a load error is shown in place of the table; an empty list shows a waiting message.
 */
export default function UnassignedQueue() {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/events/unassigned-queue')
      .then((data) => setEvents(data.events || []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Unassigned queue</h1>
          <p>Submitted requests with no Coordinator yet. Open a request to see the full details before you assign someone.</p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Organiser</th>
              <th>Date/time</th>
              <th>Expected attendance</th>
              <th>Venue needs</th>
              <th>Equipment needs</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>
                  <Link to={`/app/events/${event.id}`}>{event.name}</Link>
                </td>
                <td>{event.organiserName || '—'}</td>
                <td>{formatQueueDateTime(event.startAt, event.endAt)}</td>
                <td>{event.expectedAttendance ?? '—'}</td>
                <td>{displayNeed(event.venueRequirements)}</td>
                <td>{displayNeed(event.equipmentNotes)}</td>
              </tr>
            ))}
            {!events.length && !error && (
              <tr>
                <td colSpan="6" className="muted">No submitted requests are waiting for a Coordinator.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

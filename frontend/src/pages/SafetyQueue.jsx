import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

/**
 * Purpose: Safety Officer list of events awaiting a safety check.
 * AC: SCRUM-55 AC1 — only events already awaiting whose venues are approved and
 *     equipment reserved appear (membership enforced by the API).
 *     SCRUM-55 AC2 — opening a row goes to the review page.
 * Inputs: GET /api/events/safety-queue.
 * Failure: load error is shown; empty list shows a waiting message.
 */
export default function SafetyQueue() {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/events/safety-queue')
      .then((data) => setEvents(data.events || []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Safety queue</h1>
          <p>
            Events awaiting a safety check after venue and equipment arrangements are in place.
            Open a row to review attendance, venues and equipment before recording an outcome.
          </p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Date/time</th>
              <th>Expected attendance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>
                  <Link to={`/app/events/${event.id}/safety-check`}>{event.name}</Link>
                </td>
                <td>{event.startAt ? new Date(event.startAt).toLocaleString() : 'TBC'}</td>
                <td>{event.expectedAttendance ?? '—'}</td>
                <td>{event.status}</td>
              </tr>
            ))}
            {!events.length && !error && (
              <tr>
                <td colSpan="4" className="muted">No events are waiting for a safety check.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';

/**
 * Purpose: Lead-only list of events that still have no assigned coordinator.
 * AC: SCRUM-54 AC3, AC7
 * Business rule: W7 #5
 * Inputs: GET /api/events/unassigned-queue. Output: the queue table, or an error
 * that does not invent event details. Failure: 403 shows the server message only.
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
          <p>Events waiting for a coordinator. Only an Event Coordinator Lead can open this list.</p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      {!error && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td><Link to={`/app/events/${event.id}`}>{event.name}</Link></td>
                  <td><StatusBadge status={event.status} /></td>
                </tr>
              ))}
              {!events.length && (
                <tr><td colSpan="2" className="muted">No unassigned events.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

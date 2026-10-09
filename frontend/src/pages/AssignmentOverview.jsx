import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';

/**
 * Purpose: Lead-only overview of which coordinator is assigned to each event.
 * AC: SCRUM-54 AC3, AC7
 * Business rule: W7 #5
 * Inputs: GET /api/assignments/overview. Output: the assignment table, or an
 * error with no assignment rows. Failure: 403 shows the server message only.
 */
export default function AssignmentOverview() {
  const [assignments, setAssignments] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/assignments/overview')
      .then((data) => setAssignments(data.assignments || []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Coordinator assignments</h1>
          <p>Overview of all coordinator assignments. Only an Event Coordinator Lead can open this.</p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      {!error && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Coordinator</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((row) => (
                <tr key={row.eventId}>
                  <td><Link to={`/app/events/${row.eventId}`}>{row.eventName}</Link></td>
                  <td>{row.coordinatorName || '—'}</td>
                  <td><StatusBadge status={row.status} /></td>
                </tr>
              ))}
              {!assignments.length && (
                <tr><td colSpan="3" className="muted">No coordinator assignments yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

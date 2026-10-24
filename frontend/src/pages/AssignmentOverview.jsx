import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';

/**
 * Purpose: show this Lead the Coordinators they assigned and the events those
 * Coordinators still hold. The API already limits the rows to this Lead.
 * AC: SCRUM-57 AC1. SCRUM-54 AC3, AC7 — only a Lead can open the page.
 * Business rule: W7 #5. Week 9, Jin Hong — each Lead supervises their own allocations.
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
          <p>Coordinators you assigned, and the events you assigned to them. Only an Event Coordinator Lead can open this.</p>
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

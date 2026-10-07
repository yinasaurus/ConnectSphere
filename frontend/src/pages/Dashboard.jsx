import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import StatusBadge from '../components/StatusBadge';
import { ROLES } from '../constants';

export default function Dashboard() {
  const { user, hasRole } = useAuth();
  const [events, setEvents] = useState([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api('/api/events').then((data) => setEvents(data.events || []));
    api('/api/notifications').then((data) => setUnread(data.unread || 0));
  }, []);

  const mine = hasRole(ROLES.EVENT_COORDINATOR)
    ? events.filter((event) => event.coordinatorId === user.id)
    : events;

  const clarificationNeeded = events.filter(
    (event) => event.organiserId === user.id && event.status === 'UNDER_REVIEW' && event.subState === 'ACTION_REQUIRED'
  );

  const needsAttention = hasRole(ROLES.EVENT_ORGANISER)
    ? clarificationNeeded
    : mine.filter((event) => ['SUBMITTED', 'UNDER_REVIEW', 'PLANNING'].includes(event.status));

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Good to see you, {user.fullName.split(' ')[0]}.</h1>
          <p>This home view is role-aware. Wire more widgets here as stories land.</p>
        </div>
        {hasRole(ROLES.EVENT_ORGANISER) && (
          <Link className="btn" to="/app/events/new">New event request</Link>
        )}
      </div>
      <div className="grid-3">
        <div className="card">
          <p className="muted">Visible events</p>
          <h2>{events.length}</h2>
        </div>
        <div className="card">
          <p className="muted">Needs attention</p>
          <h2>{needsAttention.length}</h2>
        </div>
        <div className="card">
          <p className="muted">Unread notifications</p>
          <h2>{unread}</h2>
        </div>
      </div>

      {hasRole(ROLES.EVENT_ORGANISER) && clarificationNeeded.length > 0 && (
        <div className="card attention-card" style={{ marginTop: 18 }}>
          <div className="row-between">
            <h3 style={{ margin: 0, color: '#92400e' }}>
              Requests Needing Attention ({clarificationNeeded.length})
            </h3>
            <span className="badge ACTION_REQUIRED">Action Required</span>
          </div>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            The coordinator has requested clarification or amendments on the following requests.
          </p>
          <div className="stack">
            {clarificationNeeded.map((event) => (
              <div key={event.id} style={{ padding: '12px 14px', background: 'var(--white)', borderRadius: 10, border: '1px solid var(--line)' }}>
                <div className="row-between">
                  <strong><Link to={`/app/events/${event.id}`}>{event.name}</Link></strong>
                  <StatusBadge status={event.status} subState={event.subState} />
                </div>
                {event.reviewRemarks && (
                  <p style={{ fontSize: '0.88rem', margin: '6px 0 10px', color: '#92400e' }}>
                    <strong>Coordinator remarks:</strong> {event.reviewRemarks}
                  </p>
                )}
                <div className="actions" style={{ marginTop: 6 }}>
                  <Link className="btn" to={`/app/events/${event.id}/edit`} style={{ padding: '6px 14px', fontSize: '0.85rem' }}>
                    Amend Request Details
                  </Link>
                  <Link className="btn secondary" to={`/app/events/${event.id}`} style={{ padding: '6px 14px', fontSize: '0.85rem' }}>
                    View & Respond
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <div className="row-between">
          <h3>Upcoming</h3>
          <Link to="/app/events">View all</Link>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Status</th>
              <th>When</th>
              <th>Coordinator</th>
            </tr>
          </thead>
          <tbody>
            {mine.slice(0, 8).map((event) => (
              <tr key={event.id}>
                <td><Link to={`/app/events/${event.id}`}>{event.name}</Link></td>
                <td><StatusBadge status={event.status} subState={event.subState} /></td>
                <td>{event.startAt ? new Date(event.startAt).toLocaleString() : 'TBC'}</td>
                <td>{event.coordinatorName || 'Unassigned'}</td>
              </tr>
            ))}
            {!mine.length && (
              <tr><td colSpan="4" className="muted">Nothing to show for this role yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

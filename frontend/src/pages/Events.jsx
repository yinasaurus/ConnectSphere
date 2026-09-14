import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';
import { STATUS_LABELS, ROLES } from '../constants';
import { useAuth } from '../auth';

export default function Events() {
  const { hasRole } = useAuth();
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    api(`/api/events?${params.toString()}`).then((data) => setEvents(data.events || []));
  }, [status, q]);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Events</h1>
          <p>Filtered by your role: organisers see their organisation, staff see the planning calendar.</p>
        </div>
        {hasRole(ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR) && (
          <Link className="btn" to="/app/events/new">Create</Link>
        )}
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="actions">
          <input placeholder="Search name or purpose" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.keys(STATUS_LABELS).map((key) => (
              <option key={key} value={key}>{STATUS_LABELS[key]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="cards">
        {events.map((event) => (
          <Link key={event.id} to={`/app/events/${event.id}`} className="card" style={{ textDecoration: 'none' }}>
            <StatusBadge status={event.status} />
            <h3>{event.name}</h3>
            <p className="muted">{event.organisationName || 'ConnectSphere'} · {event.category}</p>
            <p>{event.startAt ? new Date(event.startAt).toLocaleString() : 'Dates to be confirmed'}</p>
          </Link>
        ))}
        {!events.length && <div className="card muted">No events match these filters.</div>}
      </div>
    </>
  );
}

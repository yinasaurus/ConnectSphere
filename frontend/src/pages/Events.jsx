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
  const [subState, setSubState] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (subState) params.set('subState', subState);
    if (q) params.set('q', q);
    api(`/api/events?${params.toString()}`).then((data) => setEvents(data.events || []));
  }, [status, subState, q]);

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
          <select
            value={subState === 'ACTION_REQUIRED' ? 'ACTION_REQUIRED' : status}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'ACTION_REQUIRED') {
                setStatus('UNDER_REVIEW');
                setSubState('ACTION_REQUIRED');
              } else {
                setStatus(val);
                setSubState('');
              }
            }}
          >
            <option value="">All statuses</option>
            <option value="ACTION_REQUIRED">Needs Attention (Clarification Requested)</option>
            {Object.keys(STATUS_LABELS).map((key) => (
              <option key={key} value={key}>{STATUS_LABELS[key]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="cards">
        {events.map((event) => (
          <Link
            key={event.id}
            to={`/app/events/${event.id}`}
            className={`card ${event.subState === 'ACTION_REQUIRED' ? 'attention-card' : ''}`}
            style={{ textDecoration: 'none' }}
          >
            <div className="row-between" style={{ marginBottom: 6 }}>
              <StatusBadge status={event.status} subState={event.subState} />
              {event.subState === 'ACTION_REQUIRED' && (
                <span style={{ fontSize: '0.8rem', color: '#92400e', fontWeight: 600 }}>Action Required</span>
              )}
            </div>
            <h3>{event.name}</h3>
            <p className="muted">{event.organisationName || 'ConnectSphere'} · {event.category}</p>
            <p>{event.startAt ? new Date(event.startAt).toLocaleString() : 'Dates to be confirmed'}</p>
            {/*
              Purpose: flag a newly submitted request as Unassigned on the organiser's event list.
              AC: SCRUM-30 AC1 (every submitted event with no Coordinator shows Unassigned)
                  and AC3 (the flag is gone once a Coordinator id is stored).
              Business rule: W7 #5 — Unassigned is the default for every new request, not only
              when nobody is free. Drafts are not flagged (SCRUM-28). The queue and assignment
              themselves stay in SCRUM-65 and SCRUM-71.
              Inputs: event.status and event.coordinatorId from GET /api/events.
              Output: the Coordinator line, or nothing. Failure: none.
            */}
            {event.status === 'SUBMITTED' && event.coordinatorId == null && (
              <p><strong>Coordinator:</strong> {'Unassigned'}</p>
            )}
          </Link>
        ))}
        {!events.length && <div className="card muted">No events match these filters.</div>}
      </div>
    </>
  );
}

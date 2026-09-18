import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import StatusBadge from '../components/StatusBadge';
import { ROLES } from '../constants';

export default function EventDetail() {
  const { id } = useParams();
  const { user, hasRole } = useAuth();
  const [event, setEvent] = useState(null);
  const [history, setHistory] = useState([]);
  const [comments, setComments] = useState([]);
  const [venues, setVenues] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [comment, setComment] = useState('');
  const [venueId, setVenueId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const reload = useCallback(async () => {
    const [eventRes, historyRes, commentRes, venueRes, bookingRes] = await Promise.all([
      api(`/api/events/${id}`),
      api(`/api/events/${id}/history`),
      api(`/api/comments/${id}`),
      api('/api/venues'),
      api('/api/venues/bookings'),
    ]);
    setEvent(eventRes.event);
    setHistory(historyRes.history || []);
    setComments(commentRes.comments || []);
    setVenues(venueRes.venues || []);
    setBookings((bookingRes.bookings || []).filter((row) => String(row.event_id) === String(id)));
  }, [id]);

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [reload]);

  async function run(action) {
    setError('');
    setMessage('');
    try {
      await action();
      setMessage('Updated.');
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!event) return <p className="muted">{error || 'Loading event…'}</p>;

  const isOrganiser = event.organiserId === user.id;
  const isCoordinator = event.coordinatorId === user.id;
  const assignedBooking = bookings[0];

  return (
    <>
      <div className="topbar">
        <div>
          <p className="muted">{event.organisationName} · {event.category}</p>
          <h1>{event.name}</h1>
          <p>{event.purpose}</p>
        </div>
        <StatusBadge status={event.status} />
      </div>
      {error && <div className="alert">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <h3>Request details</h3>
            <p>{event.description || 'No description yet.'}</p>
            <p><strong>When:</strong> {event.startAt ? `${new Date(event.startAt).toLocaleString()} – ${new Date(event.endAt).toLocaleString()}` : 'TBC'}</p>
            <p><strong>Attendance:</strong> {event.expectedAttendance || '—'}</p>
            <p><strong>Layout:</strong> {event.layoutPreference || '—'}</p>
            <p><strong>Accessibility:</strong> {event.accessibilityNeeds || 'None recorded'}</p>
            <p><strong>Venue needs:</strong> {event.venueRequirements || '—'}</p>
            <p><strong>Equipment:</strong> {event.equipmentNotes || '—'}</p>
            {event.rejectionReason && <p><strong>Rejection reason:</strong> {event.rejectionReason}</p>}
          </div>

          {isOrganiser && event.status === 'DRAFT' && (
            <div className="card actions">
              <Link className="btn secondary" to={`/app/events/${id}/edit`}>Continue editing</Link>
              <button className="btn" onClick={() => run(() => api(`/api/events/${id}/submit`, { method: 'POST' }))}>
                Submit for review
              </button>
            </div>
          )}

          {isCoordinator && (
            <div className="card stack">
              <h3>Coordinator actions</h3>
              {event.status === 'UNDER_REVIEW' && (
                <div className="actions">
                  <button className="btn" onClick={() => run(() => api(`/api/events/${id}/status`, { method: 'POST', body: { status: 'PLANNING' } }))}>
                    Approve for planning
                  </button>
                  <button className="btn danger" onClick={() => run(() => api(`/api/events/${id}/status`, { method: 'POST', body: { status: 'REJECTED', reason: reason || 'Returned for rework' } }))}>
                    Reject / return
                  </button>
                </div>
              )}
              {event.status === 'PLANNING' && (
                <button className="btn" onClick={() => run(() => api(`/api/events/${id}/status`, { method: 'POST', body: { status: 'CONFIRMED' } }))}>
                  Confirm event
                </button>
              )}
              {event.status === 'CONFIRMED' && (
                <button className="btn secondary" onClick={() => run(() => api(`/api/events/${id}/status`, { method: 'POST', body: { status: 'COMPLETED' } }))}>
                  Mark completed
                </button>
              )}
              <label>Reason / note</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              {event.status === 'PLANNING' && (
                <>
                  <label>Request a venue</label>
                  <select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                    <option value="">Select venue</option>
                    {venues.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.name} · cap {venue.capacity}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn secondary"
                    disabled={!venueId || !event.startAt}
                    onClick={() => run(() => api('/api/venues/bookings', {
                      method: 'POST',
                      body: {
                        eventId: Number(id),
                        venueId: Number(venueId),
                        startAt: event.startAt,
                        endAt: event.endAt,
                      },
                    }))}
                  >
                    Send booking request
                  </button>
                </>
              )}
            </div>
          )}

          {hasRole(ROLES.VENUE_STAFF) && assignedBooking && assignedBooking.status === 'PENDING' && (
            <div className="card actions">
              <button className="btn" onClick={() => run(() => api(`/api/venues/bookings/${assignedBooking.id}/decision`, { method: 'POST', body: { approve: true } }))}>
                Approve venue
              </button>
              <button className="btn danger" onClick={() => run(() => api(`/api/venues/bookings/${assignedBooking.id}/decision`, { method: 'POST', body: { approve: false, reason: reason || 'Venue not suitable' } }))}>
                Reject venue
              </button>
            </div>
          )}

          {hasRole(ROLES.ATTENDEE) && event.status === 'CONFIRMED' && (
            <div className="card actions">
              <button className="btn" onClick={() => run(() => api(`/api/events/${id}/registrations`, { method: 'POST' }))}>Register</button>
              <button className="btn ghost" onClick={() => run(() => api(`/api/events/${id}/registrations/withdraw`, { method: 'POST' }))}>Withdraw</button>
            </div>
          )}

          <div className="card">
            <h3>Discussion</h3>
            {comments.map((item) => (
              <div className="comment" key={item.id}>
                <strong>{item.author_name}</strong>
                <p>{item.body}</p>
              </div>
            ))}
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Leave a planning note" />
            <button className="btn secondary" onClick={() => run(async () => {
              await api(`/api/comments/${id}`, { method: 'POST', body: { body: comment } });
              setComment('');
            })}
            >
              Post comment
            </button>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h3>People</h3>
            <p><strong>Organiser:</strong> {event.organiserName}</p>
            <p><strong>Coordinator:</strong> {event.coordinatorName || 'Will be auto-assigned on submit'}</p>
          </div>
          <div className="card">
            <h3>Venue booking</h3>
            {bookings.length ? bookings.map((booking) => (
              <p key={booking.id}>{booking.venue_name}: {booking.status}</p>
            )) : <p className="muted">No booking yet. Essential arrangements must be approved before confirmation.</p>}
          </div>
          <div className="card">
            <h3>Status history</h3>
            {history.map((item) => (
              <p key={item.id}>
                {item.from_status || '—'} → {item.to_status}
                <span className="muted"> · {item.actor_name}</span>
              </p>
            ))}
            {!history.length && <p className="muted">No transitions yet.</p>}
          </div>
        </div>
      </div>
    </>
  );
}

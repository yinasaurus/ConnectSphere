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
  const [showClarificationInput, setShowClarificationInput] = useState(false);
  const [clarificationNotes, setClarificationNotes] = useState('');
  const [showRespondForm, setShowRespondForm] = useState(false);
  const [clarificationReply, setClarificationReply] = useState('');

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
        <StatusBadge status={event.status} subState={event.subState} />
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

          {isOrganiser && event.status === 'UNDER_REVIEW' && event.subState === 'ACTION_REQUIRED' && (
            <div className="card attention-card stack">
              <div className="row-between">
                <h3 style={{ margin: 0, color: '#92400e' }}>Action Required: Clarification Requested</h3>
                <StatusBadge status={event.status} subState={event.subState} />
              </div>
              <p>The event coordinator has reviewed your request and needs additional details or amendments before moving to planning.</p>
              <div className="alert warning" style={{ whiteSpace: 'pre-wrap', margin: '4px 0 12px' }}>
                <strong>Coordinator review remarks:</strong>
                <p style={{ marginTop: 4 }}>{event.reviewRemarks}</p>
              </div>
              <div className="actions">
                <Link className="btn" to={`/app/events/${id}/edit`}>Edit & Amend Details</Link>
                <button className="btn secondary" onClick={() => setShowRespondForm(!showRespondForm)}>
                  {showRespondForm ? 'Close Response Form' : 'Send Clarification Response'}
                </button>
              </div>

              {showRespondForm && (
                <div className="stack" style={{ marginTop: 12, padding: 12, background: 'var(--paper)', borderRadius: 12 }}>
                  <label><strong>Your response / clarification notes</strong></label>
                  <textarea
                    value={clarificationReply}
                    onChange={(e) => setClarificationReply(e.target.value)}
                    placeholder="Describe the changes made or answer the coordinator's questions..."
                  />
                  <div className="actions">
                    <button
                      className="btn"
                      disabled={!clarificationReply.trim()}
                      onClick={() => run(async () => {
                        await api(`/api/events/${id}/clarification/respond`, {
                          method: 'POST',
                          body: { response: clarificationReply },
                        });
                        setClarificationReply('');
                        setShowRespondForm(false);
                      })}
                    >
                      Submit Response
                    </button>
                    <button className="btn ghost" onClick={() => setShowRespondForm(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {isOrganiser && event.status === 'UNDER_REVIEW' && event.subState === 'CLARIFICATION_PROVIDED' && (
            <div className="card alert info stack">
              <strong>Clarification Provided</strong>
              <p>Your clarification notes have been submitted to the coordinator for evaluation.</p>
              {event.clarificationResponse && (
                <p className="muted" style={{ fontSize: '0.88rem' }}><strong>Your note:</strong> {event.clarificationResponse}</p>
              )}
            </div>
          )}

          {isCoordinator && (
            <div className="card stack review-panel">
              <h3>Coordinator review actions</h3>
              {event.status === 'UNDER_REVIEW' && (
                <>
                  <div style={{ padding: '8px 12px', background: 'var(--paper)', borderRadius: 10, fontSize: '0.9rem' }}>
                    <p style={{ margin: '0 0 4px' }}>
                      <strong>Current review phase:</strong>{' '}
                      <StatusBadge status={event.status} subState={event.subState} />
                    </p>
                    {event.reviewRemarks && (
                      <p style={{ margin: '4px 0' }} className="muted">
                        <strong>Requested clarification:</strong> {event.reviewRemarks}
                      </p>
                    )}
                    {event.clarificationResponse && (
                      <p style={{ margin: '4px 0', color: '#075985' }}>
                        <strong>Organizer response:</strong> {event.clarificationResponse}
                      </p>
                    )}
                  </div>
                  <div className="actions">
                    <button className="btn" onClick={() => run(() => api(`/api/events/${id}/status`, { method: 'POST', body: { status: 'PLANNING' } }))}>
                      Approve for planning
                    </button>
                    <button className="btn secondary" onClick={() => setShowClarificationInput(!showClarificationInput)}>
                      {event.subState === 'ACTION_REQUIRED' ? 'Update Clarification' : 'Request Clarification / Amendments'}
                    </button>
                    <button className="btn danger" onClick={() => run(() => api(`/api/events/${id}/status`, { method: 'POST', body: { status: 'REJECTED', reason: reason || 'Returned for rework' } }))}>
                      Reject / return
                    </button>
                  </div>

                  {showClarificationInput && (
                    <div className="stack" style={{ marginTop: 8, padding: 12, background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12 }}>
                      <label style={{ margin: 0 }}><strong>Review remarks / requested amendments *</strong></label>
                      <textarea
                        value={clarificationNotes}
                        onChange={(e) => setClarificationNotes(e.target.value)}
                        placeholder="State incomplete details or amendments needed from the organizer..."
                      />
                      <div className="actions">
                        <button
                          className="btn"
                          disabled={!clarificationNotes.trim()}
                          onClick={() => run(async () => {
                            await api(`/api/events/${id}/clarification`, {
                              method: 'POST',
                              body: { remarks: clarificationNotes },
                            });
                            setClarificationNotes('');
                            setShowClarificationInput(false);
                          })}
                        >
                          Send Clarification Request
                        </button>
                        <button className="btn ghost" onClick={() => setShowClarificationInput(false)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </>
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

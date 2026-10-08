import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import EventDecisionPanel from '../components/EventDecisionPanel';
import StatusBadge from '../components/StatusBadge';
import { ROLES } from '../constants';

/** SCRUM-18: colour-coded booking status badge. */
function BookingStatusBadge({ status }) {
  const colours = {
    PENDING: '#b45309',
    APPROVED: '#15803d',
    REJECTED: '#b91c1c',
    TENTATIVE: '#1d4ed8',
    CANCELLED: '#6b7280',
  };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: '0.78rem',
      fontWeight: 600,
      background: colours[status] || '#374151',
      color: '#fff',
      marginLeft: 6,
    }}>
      {status}
    </span>
  );
}

// Format each saved booking window and submitted date for the event's request list.
function formatBookingTime(value) {
  return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatSubmittedDate(value) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Show API status constants as readable labels in the event's booking card.
function formatBookingStatus(status) {
  return status ? `${status[0]}${status.slice(1).toLowerCase()}` : 'Unknown';
}

/**
 * Purpose: one event's page. Shows the event and, depending on the user's roles, the actions
 * they can take: Organisers submit, Coordinators review and request a venue, Venue Staff
 * approve or reject pending venue bookings, Attendees register.
 * AC: SCRUM-18 AC1-AC9 (venue booking approval/rejection flow with full details visible).
 *     SCRUM-78 AC1-AC3 (the Venue Staff decision card sends the reason and alternative
 *     staff typed, or none). The other sections belong to earlier stories.
 * Failure: load errors are shown in place of the event; action errors are shown above it.
 */
export default function EventDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { user, hasRole } = useAuth();
  const canViewPlanning = hasRole(ROLES.EVENT_ORGANISER, ROLES.EVENT_COORDINATOR, ROLES.VENUE_STAFF, ROLES.TECHNICAL_SUPPORT);
  const [event, setEvent] = useState(null);
  const [history, setHistory] = useState([]);
  const [comments, setComments] = useState([]);
  const [, setVenues] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  // Per-booking reason/alternative state for Venue Staff (keyed by booking id).
  const [venueReasons, setVenueReasons] = useState({});
  const [venueAlternatives, setVenueAlternatives] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showClarificationInput, setShowClarificationInput] = useState(false);
  const [clarificationNotes, setClarificationNotes] = useState('');
  const [showRespondForm, setShowRespondForm] = useState(false);
  const [clarificationReply, setClarificationReply] = useState('');

  // Loads the event, its venue bookings and, for planning roles only, history, comments and
  // venues; other roles never request planning data they aren't allowed to see.
  const reload = useCallback(async () => {
    const [eventRes, historyRes, commentRes, venueRes, bookingRes] = await Promise.all([
      api(`/api/events/${id}`),
      canViewPlanning ? api(`/api/events/${id}/history`) : Promise.resolve({ history: [] }),
      canViewPlanning ? api(`/api/comments/${id}`) : Promise.resolve({ comments: [] }),
      canViewPlanning ? api('/api/venues') : Promise.resolve({ venues: [] }),
      api(`/api/events/${id}/venue-bookings`),
    ]);
    setEvent(eventRes.event);
    setHistory(historyRes.history || []);
    setComments(commentRes.comments || []);
    setVenues(venueRes.venues || []);
    setBookings(bookingRes.bookings || []);
  }, [id, canViewPlanning]);

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [reload]);

  // Runs one button's API call, then shows "Updated." and reloads the page data, or shows the
  // server's error message. Used by every action button, including Approve/Reject venue.
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

  const isOrganiser = event.organiserId === user?.id;
  const isCoordinator = event.coordinatorId === user?.id;
  // Venue requests are available during the approved/planning phase, not before approval.
  const canBookVenue = ['APPROVED', 'PLANNING'].includes(event.status);
  // SCRUM-18 AC9: there may be several bookings; pending ones are each decided independently.
  const pendingBookings = bookings.filter((b) => b.status === 'PENDING');

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
      {/* Keep the submitted-request confirmation visible after returning from booking. */}
      {(message || location.state?.venueBookingSubmitted) && (
        <div className="alert success" role="status">
          {location.state?.venueBookingSubmitted
            ? 'Venue booking request submitted. Venue Staff will review it as Pending.'
            : message}
        </div>
      )}

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
              <h3>Coordinator {event.status === 'UNDER_REVIEW' ? 'review actions' : 'actions'}</h3>
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
                    {history.some((item) => item.note?.startsWith('Clarification ')) && (
                      <div style={{ marginTop: 8 }}>
                        <p style={{ margin: '0 0 4px' }}><strong>Clarification history</strong></p>
                        {history.filter((item) => item.note?.startsWith('Clarification ')).map((item) => (
                          <p key={item.id} className="muted" style={{ margin: '2px 0', fontSize: '0.88rem' }}>
                            {item.actor_name ? `${item.actor_name}: ` : ''}{item.note}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  <EventDecisionPanel
                    onDecide={(decision, text) => run(() => api(`/api/events/${id}/decision`, {
                      method: 'POST',
                      body: { decision, reason: text },
                    }))}
                  />
                  <div className="actions">
                    <button className="btn secondary" onClick={() => setShowClarificationInput(!showClarificationInput)}>
                      {event.subState === 'ACTION_REQUIRED' ? 'Update Clarification' : 'Request Clarification / Amendments'}
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
              {event.status !== 'UNDER_REVIEW' && (
                <>
                  <label>Reason / note</label>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
                </>
              )}
            </div>
          )}

          {/* SCRUM-18 AC2/AC3/AC9: Venue Staff see every pending booking for this event
              with event, venue, date, and time, and can approve/reject each one independently.
              SCRUM-78 AC2/AC3: what staff type goes into the Coordinator's notice. */}
          {hasRole(ROLES.VENUE_STAFF) && pendingBookings.length > 0 && (
            <div className="card stack">
              <h3>Venue booking decisions</h3>
              {pendingBookings.map((booking) => (
                <div key={booking.id} style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 14, marginTop: 14 }}>
                  <p style={{ fontWeight: 600, marginBottom: 4 }}>
                    {event.name && <span style={{ marginRight: 6 }}>{event.name} —</span>}
                    {booking.venue_name || `Venue #${booking.venue_id}`}
                    <BookingStatusBadge status={booking.status} />
                  </p>
                  <p className="muted" style={{ margin: '3px 0', fontSize: '0.88rem' }}>
                    <strong>Booking window:</strong>{' '}
                    {booking.start_at && booking.end_at
                      ? `${new Date(booking.start_at).toLocaleString()} – ${new Date(booking.end_at).toLocaleString()}`
                      : 'TBC'}
                  </p>
                  {event.startAt && (
                    <p className="muted" style={{ margin: '3px 0', fontSize: '0.88rem' }}>
                      <strong>Event date:</strong>{' '}
                      {`${new Date(event.startAt).toLocaleString()} – ${new Date(event.endAt).toLocaleString()}`}
                    </p>
                  )}
                  <label htmlFor={`venue-decision-reason-${booking.id}`}>Reason for rejecting (optional)</label>
                  <textarea
                    id={`venue-decision-reason-${booking.id}`}
                    value={venueReasons[booking.id] || ''}
                    onChange={(e) => setVenueReasons((prev) => ({ ...prev, [booking.id]: e.target.value }))}
                  />
                  <label htmlFor={`venue-decision-alternative-${booking.id}`}>Suggested alternative (optional)</label>
                  <input
                    id={`venue-decision-alternative-${booking.id}`}
                    value={venueAlternatives[booking.id] || ''}
                    onChange={(e) => setVenueAlternatives((prev) => ({ ...prev, [booking.id]: e.target.value }))}
                  />
                  <div className="actions">
                    <button
                      className="btn"
                      onClick={() => run(() => api(`/api/venues/bookings/${booking.id}/decision`, {
                        method: 'POST',
                        body: { approve: true },
                      }))}
                    >
                      Approve venue
                    </button>
                    <button
                      className="btn danger"
                      onClick={() => run(() => api(`/api/venues/bookings/${booking.id}/decision`, {
                        method: 'POST',
                        body: {
                          approve: false,
                          reason: (venueReasons[booking.id] || '').trim() || undefined,
                          alternativeSuggestion: (venueAlternatives[booking.id] || '').trim() || undefined,
                        },
                      }))}
                    >
                      Reject venue
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hasRole(ROLES.ATTENDEE) && event.status === 'CONFIRMED' && (
            <div className="card actions">
              <button className="btn" onClick={() => run(() => api(`/api/events/${id}/registrations`, { method: 'POST' }))}>Register</button>
              <button className="btn ghost" onClick={() => run(() => api(`/api/events/${id}/registrations/withdraw`, { method: 'POST' }))}>Withdraw</button>
            </div>
          )}

          {canViewPlanning && <div className="card">
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
          </div>}
        </div>

        <div className="stack">
          {canViewPlanning && <div className="card">
            <h3>People</h3>
            <p><strong>Organiser:</strong> {event.organiserName}</p>
            <p><strong>Coordinator:</strong> {event.coordinatorName || 'Will be auto-assigned on submit'}</p>
          </div>}

          {/* SCRUM-18 AC7/AC8: Event Coordinator sees all venue bookings for this event
              with status, rejection reason, and suggested alternative for each one. */}
          <div className="card">
            <h3>Venue bookings</h3>
            {bookings.length ? bookings.map((booking) => (
              <div className="venue-request-row" key={booking.id} style={{ marginBottom: 10 }}>
                <div className="row-between">
                  <p style={{ margin: '2px 0' }}>
                    <span style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>
                      {booking.venue_name || `Venue #${booking.venue_id}`}: {booking.status}
                    </span>
                    <strong>{booking.venue_name || `Venue #${booking.venue_id}`}</strong>
                    <BookingStatusBadge status={booking.status} />
                  </p>
                  <span className={`booking-status ${booking.status}`}>{formatBookingStatus(booking.status)}</span>
                </div>
                <p className="muted" style={{ margin: '2px 0', fontSize: '0.85rem' }}>
                  {booking.start_at && booking.end_at
                    ? `Occupied ${formatBookingTime(
                      new Date(new Date(booking.start_at).getTime() - Number(booking.setup_minutes || 0) * 60_000)
                    )} to ${formatBookingTime(
                      new Date(new Date(booking.end_at).getTime() + Number(booking.teardown_minutes || 0) * 60_000)
                    )}`
                    : 'Occupied window unavailable'}
                  {booking.created_at && ` · Submitted ${formatSubmittedDate(booking.created_at)}`}
                </p>
                {/* SCRUM-18 AC7: Coordinator sees the rejection reason and suggested alternative. */}
                {booking.status === 'REJECTED' && booking.decision_reason && (
                  <p style={{ margin: '2px 0', fontSize: '0.88rem', color: '#ef4444' }}>
                    Reason: {booking.decision_reason}
                  </p>
                )}
                {booking.status === 'REJECTED' && booking.alternative_suggestion && (
                  <p style={{ margin: '2px 0', fontSize: '0.88rem' }}>
                    Suggested alternative: {booking.alternative_suggestion}
                  </p>
                )}
                {/* SCRUM-18 AC8: an approved booking is labelled as a confirmed booking. */}
                {booking.status === 'APPROVED' && (
                  <p style={{ margin: '2px 0', fontSize: '0.88rem', color: '#22c55e' }}>
                    ✓ Confirmed venue booking
                  </p>
                )}
              </div>
            )) : <p className="muted">No booking yet. Essential arrangements must be approved before confirmation.</p>}
            {/* A coordinator may create independent requests for the same event. */}
            {isCoordinator && hasRole(ROLES.EVENT_COORDINATOR) && canBookVenue && (
              <Link className="btn venue-book-link" to={`/app/events/${id}/venue-booking`}>Book a venue</Link>
            )}
          </div>

          {canViewPlanning && <div className="card">
            <h3>Status history</h3>
            {history.map((item) => (
              <p key={item.id}>
                {item.from_status || '—'} → {item.to_status}
                <span className="muted"> · {item.actor_name}</span>
                {item.note && (
                  <span className="muted" style={{ display: 'block', marginTop: 2 }}>
                    {item.note}
                  </span>
                )}
              </p>
            ))}
            {!history.length && <p className="muted">No transitions yet.</p>}
          </div>}
        </div>
      </div>
    </>
  );
}

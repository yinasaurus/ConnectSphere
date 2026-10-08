import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import EventDecisionPanel from '../components/EventDecisionPanel';
import StatusBadge from '../components/StatusBadge';
import { LIVE_REFRESH_MS, ROLES } from '../constants';

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
 * Purpose: one event's page. Shows its latest details and, depending on the user's roles,
 * the actions they can take: Organisers submit, Coordinators review and request a venue,
 * Venue Staff approve or reject the pending venue booking, Attendees register.
 * AC: SCRUM-39 AC1 + AC2 (the "Request details", "Venue booking" and "Equipment requests"
 * cards show attendance, date, time, venue and equipment); SCRUM-78 AC1-AC3 (the Venue
 * Staff decision card sends the reason and alternative staff typed, or none). Other
 * sections belong to earlier stories.
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
  const [equipmentRequests, setEquipmentRequests] = useState([]);
  const [equipmentError, setEquipmentError] = useState('');
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [venueReason, setVenueReason] = useState('');
  const [venueAlternative, setVenueAlternative] = useState('');
  const [error, setError] = useState('');
  const [coordinatorError, setCoordinatorError] = useState('');
  const [message, setMessage] = useState('');
  const [showClarificationInput, setShowClarificationInput] = useState(false);
  const [clarificationNotes, setClarificationNotes] = useState('');
  const [showRespondForm, setShowRespondForm] = useState(false);
  const [clarificationReply, setClarificationReply] = useState('');

  // Loads the event, its venue bookings and, for planning roles only, history, comments,
  // venues and equipment requests; other roles never request planning data they aren't
  // allowed to see.
  const reload = useCallback(async () => {
    const [eventRes, historyRes, commentRes, venueRes, bookingRes, equipmentRes] = await Promise.all([
      api(`/api/events/${id}`),
      canViewPlanning ? api(`/api/events/${id}/history`) : Promise.resolve({ history: [] }),
      canViewPlanning ? api(`/api/comments/${id}`) : Promise.resolve({ comments: [] }),
      canViewPlanning ? api('/api/venues') : Promise.resolve({ venues: [] }),
      api(`/api/events/${id}/venue-bookings`),
      // SCRUM-39 AC2: Attendees aren't allowed planning details, so they never ask for this.
      // SCRUM-39 AC1: a failure here is shown in the equipment card only, so it can't stop
      // the user from viewing the rest of the event.
      canViewPlanning
        ? api(`/api/events/${id}/equipment-requests`).catch((err) => ({ requests: [], loadError: err.message }))
        : Promise.resolve({ requests: [] }),
    ]);
    setEvent(eventRes.event);
    setHistory(historyRes.history || []);
    setComments(commentRes.comments || []);
    setVenues(venueRes.venues || []);
    setBookings(bookingRes.bookings || []);
    setEquipmentRequests(equipmentRes.requests || []);
    setEquipmentError(equipmentRes.loadError || '');
  }, [id, canViewPlanning]);

  useEffect(() => {
    const refresh = () => reload().catch((err) => setError(err.message));
    refresh();
    const timer = setInterval(refresh, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  // Runs one button's API call, then shows "Updated." and reloads the page data, or shows the
  // server's error message. Used by every action button, including Approve/Reject venue.
  async function run(action, showError = setError) {
    setError('');
    setCoordinatorError('');
    setMessage('');
    try {
      await action();
      setMessage('Updated.');
      await reload();
    } catch (err) {
      showError(err.message);
    }
  }

  // The coordinator card sits below the fold, so its errors are shown inside the card
  // rather than in the page-level alert the coordinator would have to scroll up to see.
  function runCoordinatorAction(action) {
    return run(action, setCoordinatorError);
  }

  if (!event) return <p className="muted">{error || 'Loading event…'}</p>;

  const isOrganiser = event.organiserId === user?.id;
  const isCoordinator = event.coordinatorId === user?.id;
  // Venue requests are available during the approved/planning phase, not before approval.
  const canBookVenue = ['APPROVED', 'PLANNING'].includes(event.status);
  const assignedBooking = bookings[0];
  // SCRUM-5 AC6: mirrors the venue half of the backend's isReadyForSafetyCheck (rejected and
  // cancelled bookings don't count). Equipment isn't loaded on this page, so the backend still
  // has the final say and its refusal is shown in the coordinator card.
  const activeBookings = bookings.filter((booking) => !['REJECTED', 'CANCELLED'].includes(booking.status));
  const pendingBookings = activeBookings.filter((booking) => booking.status !== 'APPROVED');
  const venuesReadyForSafetyCheck = activeBookings.length > 0 && pendingBookings.length === 0;
  let safetyCheckHint = '';
  if (!activeBookings.length) {
    safetyCheckHint = 'Request a venue first. Every venue booking must be approved before the safety check.';
  } else if (pendingBookings.length) {
    safetyCheckHint = `Waiting for venue approval: ${pendingBookings.length} booking${pendingBookings.length === 1 ? '' : 's'} pending.`;
  }

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
              {coordinatorError && <div className="alert" role="alert">{coordinatorError}</div>}
              {event.status === 'SUBMITTED' && (
                <div className="actions">
                  <button className="btn" onClick={() => run(() => api(`/api/events/${id}/review`, { method: 'POST' }))}>
                    Open for review
                  </button>
                </div>
              )}
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
                    onDecide={(decision, text) => runCoordinatorAction(() => api(`/api/events/${id}/decision`, {
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
                          onClick={() => runCoordinatorAction(async () => {
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
              {event.status === 'APPROVED' && (
                <button className="btn" onClick={() => runCoordinatorAction(() => api(`/api/events/${id}/status`, { method: 'POST', body: { status: 'PLANNING' } }))}>
                  Start planning
                </button>
              )}
              {event.status === 'PLANNING' && (
                <>
                  <button
                    className="btn"
                    disabled={!venuesReadyForSafetyCheck}
                    aria-describedby={safetyCheckHint ? 'safety-check-hint' : undefined}
                    onClick={() => runCoordinatorAction(() => api(`/api/events/${id}/status`, { method: 'POST', body: { status: 'AWAITING_SAFETY_CHECK' } }))}
                  >
                    Send to safety check
                  </button>
                  {safetyCheckHint && <p className="muted" id="safety-check-hint">{safetyCheckHint}</p>}
                </>
              )}
              {event.status === 'PREPARATION' && (
                <button className="btn" onClick={() => runCoordinatorAction(() => api(`/api/events/${id}/status`, { method: 'POST', body: { status: 'CONFIRMED' } }))}>
                  Confirm event
                </button>
              )}
              {event.status === 'CONFIRMED' && (
                <button className="btn secondary" onClick={() => runCoordinatorAction(() => api(`/api/events/${id}/status`, { method: 'POST', body: { status: 'COMPLETED' } }))}>
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

          {/* SCRUM-78 AC2/AC3: what staff type here goes into the Coordinator's notice. A
              blank box sends nothing, so the notice shows no reason rather than a made-up one. */}
          {hasRole(ROLES.VENUE_STAFF) && assignedBooking && assignedBooking.status === 'PENDING' && (
            <div className="card stack">
              <label htmlFor="venue-decision-reason">Reason for rejecting (optional)</label>
              <textarea id="venue-decision-reason" value={venueReason} onChange={(e) => setVenueReason(e.target.value)} />
              <label htmlFor="venue-decision-alternative">Suggested alternative (optional)</label>
              <input id="venue-decision-alternative" value={venueAlternative} onChange={(e) => setVenueAlternative(e.target.value)} />
              <div className="actions">
                <button className="btn" onClick={() => run(() => api(`/api/venues/bookings/${assignedBooking.id}/decision`, { method: 'POST', body: { approve: true } }))}>
                  Approve venue
                </button>
                <button
                  className="btn danger"
                  onClick={() => run(() => api(`/api/venues/bookings/${assignedBooking.id}/decision`, {
                    method: 'POST',
                    body: {
                      approve: false,
                      reason: venueReason.trim() || undefined,
                      alternativeSuggestion: venueAlternative.trim() || undefined,
                    },
                  }))}
                >
                  Reject venue
                </button>
              </div>
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
          <div className="card">
            {/* If event has min 1 venue booking, display the bookings */}
            <h3>Venue booking</h3>
            {bookings.length ? bookings.map((booking) => (
              <div className="venue-request-row" key={booking.id}>
                <div className="row-between">
                  <strong>{booking.venue_name || 'Venue request'}</strong>
                  <span className={`booking-status ${booking.status}`}>{formatBookingStatus(booking.status)}</span>
                </div>
                <p className="muted">
                  {booking.start_at && booking.end_at
                    ? `Occupied ${formatBookingTime(
                      new Date(new Date(booking.start_at).getTime() - Number(booking.setup_minutes || 0) * 60_000)
                    )} to ${formatBookingTime(
                      new Date(new Date(booking.end_at).getTime() + Number(booking.teardown_minutes || 0) * 60_000)
                    )}`
                    : 'Occupied window unavailable'}
                  {booking.created_at && ` · Submitted ${formatSubmittedDate(booking.created_at)}`}
                </p>
              </div>
            )) : <p className="muted">No booking yet. Essential arrangements must be approved before confirmation.</p>}
            {/* A coordinator may create independent requests for the same event. */}
            {isCoordinator && hasRole(ROLES.EVENT_COORDINATOR) && canBookVenue && (
              <Link className="btn venue-book-link" to={`/app/events/${id}/venue-booking`}>Book a venue</Link>
            )}
          </div>
          {canViewPlanning && <div className="card">
            <h3>Equipment requests</h3>
            {equipmentError ? <p className="alert">Equipment requests could not be loaded: {equipmentError}</p>
              : equipmentRequests.length ? equipmentRequests.map((item) => (
              <p key={item.id}>
                {item.equipment_name || 'Item no longer in catalogue'} × {item.quantity}: {item.status}
              </p>
            )) : <p className="muted">No equipment requested yet.</p>}
          </div>}
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

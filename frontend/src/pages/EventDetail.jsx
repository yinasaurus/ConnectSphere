import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import EventDecisionPanel from '../components/EventDecisionPanel';
import StatusBadge from '../components/StatusBadge';
import { ROLES } from '../constants';

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
 * approve or reject the pending venue booking, Attendees register.
 * AC: SCRUM-78 AC1-AC3 (the Venue Staff decision card sends the reason and alternative
 * staff typed, or none). The other sections belong to earlier stories.
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
  const [venueReason, setVenueReason] = useState('');
  const [venueAlternative, setVenueAlternative] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

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

  const isOrganiser = event.organiserId === user.id;
  const isCoordinator = event.coordinatorId === user.id;
  // Venue requests are available during the approved/planning phase, not before approval.
  const canBookVenue = ['APPROVED', 'PLANNING'].includes(event.status);
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

          {isCoordinator && (
            <div className="card stack">
              <h3>Coordinator actions</h3>
              {event.status === 'UNDER_REVIEW' && (
                <EventDecisionPanel
                  onDecide={(decision, text) => run(() => api(`/api/events/${id}/decision`, {
                    method: 'POST',
                    body: { decision, reason: text },
                  }))}
                />
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
            <h3>Status history</h3>
            {history.map((item) => (
              <p key={item.id}>
                {item.from_status || '—'} → {item.to_status}
                <span className="muted"> · {item.actor_name}</span>
              </p>
            ))}
            {!history.length && <p className="muted">No transitions yet.</p>}
          </div>}
        </div>
      </div>
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import ConflictModal from '../components/ConflictModal';
import EventDecisionPanel from '../components/EventDecisionPanel';
import AttendeeRegistrationCard from '../components/AttendeeRegistrationCard';
import RegistrationSettingsCard from '../components/RegistrationSettingsCard';
import EventRegistrationsCard from '../components/EventRegistrationsCard';
import StatusBadge from '../components/StatusBadge';
import { LIVE_REFRESH_MS, ROLES } from '../constants';

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
      {/* SCRUM-75 AC1: a hold is stored as TENTATIVE and shown as Held. */}
      {status === 'TENTATIVE' ? 'HELD' : status}
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
 * approve or reject pending venue bookings, Attendees register, Lead assigns a Coordinator
 * on a Submitted event that has none.
 * AC: SCRUM-18 AC1-AC9 (each pending booking is decided on its own).
 *     SCRUM-39 AC1 + AC2 (request details, venue booking, equipment requests).
 *     SCRUM-65 AC5: the Lead can open this page from the unassigned queue and see the full request details.
 *     SCRUM-71 AC1, AC2, AC6 (Lead assign card).
 *     SCRUM-63 AC1-AC7 (assigned Coordinator's registration card).
 *     SCRUM-78 AC1-AC3 (the Venue Staff card sends the reason and alternative staff typed, or none).
 *     SCRUM-34 AC1 + AC2 (organiser change-request form: date/time, attendance, venue/equipment).
 *     SCRUM-35 AC1 + AC2 (assigned coordinator approve/reject; approve applies the fields).
 *     SCRUM-40 1C / 2A: assigned Coordinator gets "Edit event details" before Confirmed;
 *     Confirmed shows a change-request note instead of the edit link.
 *     SCRUM-42 AC2: "Requires review" on flagged venue bookings and equipment requests;
 *     the status badge itself is unchanged.
 * Failure: load errors are shown in place of the event; action errors are shown above it.
 */
const CHANGE_BLOCKED_STATUSES = ['DRAFT', 'CANCELLED', 'REJECTED', 'COMPLETED'];
// SCRUM-40 1C/2A: assigned Coordinator direct-edits only before Confirmed.
const COORD_EDIT_LOCKED_STATUSES = ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED'];

/** Purpose: blank organiser change-request form. AC: SCRUM-34 AC1. */
function emptyChangeForm() {
  return {
    startAt: '',
    endAt: '',
    expectedAttendance: '',
    venueRequirements: '',
    equipmentNotes: '',
  };
}

/**
 * Purpose: send only filled permitted fields (date/time as ISO).
 * AC: SCRUM-34 AC2
 * Empty boxes are omitted so a blank form cannot be posted.
 */
function buildChangePayload(form) {
  const body = {};
  if (form.startAt) body.startAt = new Date(form.startAt).toISOString();
  if (form.endAt) body.endAt = new Date(form.endAt).toISOString();
  if (String(form.expectedAttendance).trim() !== '') {
    body.expectedAttendance = Number(form.expectedAttendance);
  }
  if (form.venueRequirements.trim()) body.venueRequirements = form.venueRequirements.trim();
  if (form.equipmentNotes.trim()) body.equipmentNotes = form.equipmentNotes.trim();
  return body;
}

export default function EventDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { user, hasRole } = useAuth();
  // SCRUM-65 AC5: the Lead needs the same planning fields as other internal staff.
  const isLead = hasRole(ROLES.EVENT_COORDINATOR_LEAD);
  const isAttendee = hasRole(ROLES.ATTENDEE);
  const canViewPlanning = hasRole(
    ROLES.EVENT_ORGANISER,
    ROLES.EVENT_COORDINATOR,
    ROLES.EVENT_COORDINATOR_LEAD,
    ROLES.SAFETY_OFFICER,
    ROLES.VENUE_STAFF,
    ROLES.TECHNICAL_SUPPORT
  );
  const [event, setEvent] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [history, setHistory] = useState([]);
  const [comments, setComments] = useState([]);
  const [, setVenues] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [assignableCoordinators, setAssignableCoordinators] = useState([]);
  const [assignCoordinatorId, setAssignCoordinatorId] = useState('');
  const [equipmentRequests, setEquipmentRequests] = useState([]);
  const [equipmentError, setEquipmentError] = useState('');
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  // Per-booking reason/alternative state for Venue Staff (keyed by booking id).
  const [venueReasons, setVenueReasons] = useState({});
  const [venueAlternatives, setVenueAlternatives] = useState({});
  const [error, setError] = useState('');
  const [coordinatorError, setCoordinatorError] = useState('');
  const [message, setMessage] = useState('');
  const [registrationStatus, setRegistrationStatus] = useState(null);
  const [showClarificationInput, setShowClarificationInput] = useState(false);
  const [clarificationNotes, setClarificationNotes] = useState('');
  const [showRespondForm, setShowRespondForm] = useState(false);
  const [clarificationReply, setClarificationReply] = useState('');
  const [conflictModalMsg, setConflictModalMsg] = useState('');
  const [changeRequests, setChangeRequests] = useState([]);
  const [changeRequestError, setChangeRequestError] = useState('');
  const [changeForm, setChangeForm] = useState(emptyChangeForm);
  const [changeRejectReasons, setChangeRejectReasons] = useState({});
  const [eventRegistrations, setEventRegistrations] = useState(null);

  // Loads the event, its venue bookings and, for planning roles only, history, comments,
  // venues and equipment requests; other roles never request planning data they aren't
  // allowed to see. A Lead also loads the active-Coordinator list when this event is still unassigned.
  const reload = useCallback(async () => {
    const [eventRes, historyRes, commentRes, venueRes, bookingRes, equipmentRes, statusRes] = await Promise.all([
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
      // SCRUM-51: an Attendee's registration details and own status; a failure only hides that card's details.
      isAttendee
        ? api(`/api/events/${id}/registration-status`).catch(() => ({ registrationStatus: null }))
        : Promise.resolve({ registrationStatus: null }),
    ]);
    setEvent(eventRes.event);
    setRegistrationStatus(statusRes.registrationStatus || null);
    setHistory(historyRes.history || []);
    setComments(commentRes.comments || []);
    setVenues(venueRes.venues || []);
    setBookings(bookingRes.bookings || []);
    setEquipmentRequests(equipmentRes.requests || []);
    setEquipmentError(equipmentRes.loadError || '');
    if (isLead && eventRes.event.status === 'SUBMITTED' && !eventRes.event.coordinatorId) {
      const coordRes = await api('/api/events/assignable-coordinators');
      setAssignableCoordinators(coordRes.coordinators || []);
    } else {
      setAssignableCoordinators([]);
    }
    // SCRUM-34/35: only the owner and assigned coordinator load change requests, so other
    // EventDetail tests are not forced to stub this path. Failures stay in the card.
    const ev = eventRes.event;
    const canSeeChangeRequests = Boolean(
      user && (ev.organiserId === user.id || ev.coordinatorId === user.id)
    );
    if (!canSeeChangeRequests) {
      setChangeRequests([]);
      setChangeRequestError('');
    } else {
      const changeRes = await api(`/api/events/${id}/change-requests`).catch((err) => ({
        changeRequests: [],
        loadError: err.message,
      }));
      setChangeRequests(changeRes.changeRequests || []);
      setChangeRequestError(changeRes.loadError || '');
    }
    // SCRUM-74: the same "owns or is assigned to this event" check as change requests —
    // the API rejects anyone else, so there is nothing to gain by asking on their behalf.
    if (!canSeeChangeRequests) {
      setEventRegistrations(null);
    } else {
      const registrationsRes = await api(`/api/events/${id}/registrations`).catch(() => null);
      setEventRegistrations(Array.isArray(registrationsRes?.registrations) ? registrationsRes : null);
    }
  }, [id, canViewPlanning, isLead, isAttendee, user]);

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
    setConflictModalMsg('');
    try {
      // An action can return its own success text (e.g. SCRUM-52's places left); otherwise "Updated."
      const result = await action();
      setMessage(typeof result === 'string' ? result : 'Updated.');
      await reload();
    } catch (err) {
      if (err.code === 'BOOKING_CONFLICT') {
        setConflictModalMsg(err.message);
      } else {
        showError(err.message);
      }
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
  // SCRUM-18 AC9: there may be several bookings; pending ones are each decided independently.
  const pendingBookings = bookings.filter((b) => b.status === 'PENDING');
  // SCRUM-58 AC6: an approved booking marked for review can be approved again from here.
  const bookingsToDecide = bookings.filter(
    (b) => b.status === 'PENDING' || (b.status === 'APPROVED' && b.needs_review)
  );
  // SCRUM-5 AC6: mirrors the venue half of the backend's isReadyForSafetyCheck (rejected and
  // cancelled bookings don't count). Equipment isn't loaded on this page, so the backend still
  // has the final say and its refusal is shown in the coordinator card.
  // SCRUM-18 AC9: several bookings; each PENDING one is decided on its own.
  // SCRUM-5 AC6: rejected/cancelled don't count toward the safety check.
  const activeBookings = bookings.filter((booking) => !['REJECTED', 'CANCELLED'].includes(booking.status));
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
      {/* Keep the submitted-request confirmation visible after returning from booking or equipment request. */}
      {(message || location.state?.venueBookingSubmitted || location.state?.equipmentRequestSubmitted) && (
        <div className="alert success" role="status">
          {location.state?.venueBookingSubmitted
            ? 'Venue booking request submitted. Venue Staff will review it as Pending.'
            : location.state?.equipmentRequestSubmitted
            ? 'Equipment request submitted. Technical Support Staff can now review and prepare the equipment.'
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

          {/* SCRUM-56 AC8: only the Organiser and assigned Coordinator receive safetyCheck on the event. */}
          {event.safetyCheck && (
            <div className="card stack">
              <h3>Safety check outcome</h3>
              <p><strong>Outcome:</strong> {event.safetyCheck.outcome}</p>
              {event.safetyCheck.reason && (
                <p><strong>Reason:</strong> {event.safetyCheck.reason}</p>
              )}
              {event.safetyCheck.decidedAt && (
                <p className="muted">
                  Recorded {new Date(event.safetyCheck.decidedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {/*
            Purpose: Lead chooses the one primary Coordinator for a Submitted event that has none.
            AC: SCRUM-71 AC1, AC2, AC6
            Business rule: W7 #5, W4 (manual choice). Inactive Coordinators are omitted by the API.
            Failure: the server message is shown; the event is not changed.
          */}
          {isLead && event.status === 'SUBMITTED' && !event.coordinatorId && (
            <div className="card stack">
              <h3>Assign coordinator</h3>
              <p className="muted">Choose an active Event Coordinator as the main point of contact. Only a Lead can do this.</p>
              <label htmlFor="assign-coordinator">Coordinator</label>
              <select
                id="assign-coordinator"
                value={assignCoordinatorId}
                onChange={(e) => setAssignCoordinatorId(e.target.value)}
              >
                <option value="">Select a coordinator</option>
                {assignableCoordinators.map((row) => (
                  <option key={row.id} value={row.id}>{row.fullName}</option>
                ))}
              </select>
              <button
                className="btn"
                type="button"
                disabled={!assignCoordinatorId}
                onClick={() => run(() => api(`/api/events/${id}/assign-coordinator`, {
                  method: 'POST',
                  body: { coordinatorId: Number(assignCoordinatorId) },
                }))}
              >
                Assign coordinator
              </button>
            </div>
          )}

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

          {/*
            Purpose: organiser proposes permitted field changes; assigned coordinator decides.
            AC: SCRUM-34 AC1, AC2; SCRUM-35 AC1, AC2
            Failure: the server message is shown; the event is not changed until approve.
          */}
          {isOrganiser && event.coordinatorId && !CHANGE_BLOCKED_STATUSES.includes(event.status)
            && !changeRequests.some((row) => row.status === 'PENDING') && (
            <div className="card stack">
              <h3>Request a change</h3>
              <p className="muted">Ask the assigned coordinator to update date, time, attendance, venue requirements or equipment requirements. Other fields cannot be requested here.</p>
              {changeRequestError && <div className="alert">{changeRequestError}</div>}
              <label htmlFor="change-start">Proposed start</label>
              <input
                id="change-start"
                type="datetime-local"
                value={changeForm.startAt}
                onChange={(e) => setChangeForm((prev) => ({ ...prev, startAt: e.target.value }))}
              />
              <label htmlFor="change-end">Proposed end</label>
              <input
                id="change-end"
                type="datetime-local"
                value={changeForm.endAt}
                onChange={(e) => setChangeForm((prev) => ({ ...prev, endAt: e.target.value }))}
              />
              <label htmlFor="change-attendance">Proposed attendance</label>
              <input
                id="change-attendance"
                type="number"
                min="1"
                value={changeForm.expectedAttendance}
                onChange={(e) => setChangeForm((prev) => ({ ...prev, expectedAttendance: e.target.value }))}
              />
              <label htmlFor="change-venue">Proposed venue requirements</label>
              <textarea
                id="change-venue"
                value={changeForm.venueRequirements}
                onChange={(e) => setChangeForm((prev) => ({ ...prev, venueRequirements: e.target.value }))}
              />
              <label htmlFor="change-equipment">Proposed equipment requirements</label>
              <textarea
                id="change-equipment"
                value={changeForm.equipmentNotes}
                onChange={(e) => setChangeForm((prev) => ({ ...prev, equipmentNotes: e.target.value }))}
              />
              <button
                className="btn"
                type="button"
                disabled={!Object.keys(buildChangePayload(changeForm)).length}
                onClick={() => run(async () => {
                  await api(`/api/events/${id}/change-requests`, {
                    method: 'POST',
                    body: buildChangePayload(changeForm),
                  });
                  setChangeForm(emptyChangeForm());
                })}
              >
                Submit change request
              </button>
            </div>
          )}

          {(isOrganiser || isCoordinator) && changeRequests.length > 0 && (
            <div className="card stack">
              <h3>Change requests</h3>
              {changeRequests.map((row) => (
                <div key={row.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                  <p><strong>{row.status}</strong></p>
                  {row.startAt && <p>Proposed start: {new Date(row.startAt).toLocaleString()}</p>}
                  {row.endAt && <p>Proposed end: {new Date(row.endAt).toLocaleString()}</p>}
                  {row.expectedAttendance != null && <p>Proposed attendance: {row.expectedAttendance}</p>}
                  {row.venueRequirements && <p>Proposed venue requirements: {row.venueRequirements}</p>}
                  {row.equipmentNotes && <p>Proposed equipment requirements: {row.equipmentNotes}</p>}
                  {row.decisionReason && <p>Decision reason: {row.decisionReason}</p>}
                  {isCoordinator && row.status === 'PENDING' && (
                    <>
                      <label htmlFor={`change-reject-reason-${row.id}`}>Reject reason (optional)</label>
                      <textarea
                        id={`change-reject-reason-${row.id}`}
                        value={changeRejectReasons[row.id] || ''}
                        onChange={(e) => setChangeRejectReasons((prev) => ({ ...prev, [row.id]: e.target.value }))}
                      />
                      {/* SCRUM-69 AC2: page-level run() so a 400 (invalid requested values)
                          shows in the alert above the event, not only in Coordinator actions. */}
                      <div className="actions">
                        <button
                          className="btn"
                          type="button"
                          onClick={() => run(() => api(
                            `/api/events/${id}/change-requests/${row.id}/decision`,
                            { method: 'POST', body: { approve: true } }
                          ))}
                        >
                          Approve change
                        </button>
                        <button
                          className="btn danger"
                          type="button"
                          onClick={() => run(() => api(
                            `/api/events/${id}/change-requests/${row.id}/decision`,
                            {
                              method: 'POST',
                              body: {
                                approve: false,
                                reason: (changeRejectReasons[row.id] || '').trim() || undefined,
                              },
                            }
                          ))}
                        >
                          Reject change
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {isCoordinator && (
            <div className="card stack review-panel">
              <h3>Coordinator {event.status === 'UNDER_REVIEW' ? 'review actions' : 'actions'}</h3>
              {coordinatorError && <div className="alert" role="alert">{coordinatorError}</div>}
              {/*
                Purpose: assigned Coordinator opens the shared edit form before Confirmed.
                AC: SCRUM-40 1C, 2A — Confirmed/terminal statuses stay on change requests only.
              */}
              {!COORD_EDIT_LOCKED_STATUSES.includes(event.status) && (
                <div className="actions">
                  <Link className="btn secondary" to={`/app/events/${id}/edit`}>Edit event details</Link>
                </div>
              )}
              {event.status === 'CONFIRMED' && (
                <p className="muted">
                  Confirmed events cannot be edited directly. Approve an organiser change request for date, time, attendance, venue or equipment requirements.
                </p>
              )}
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

          {/* SCRUM-18 AC2/AC3/AC9: Venue Staff see every pending booking for this event
              with event, venue, date, and time, and can approve/reject each one independently.
              SCRUM-78 AC2/AC3: what staff type goes into the Coordinator's notice. */}
          {hasRole(ROLES.VENUE_STAFF) && bookingsToDecide.length > 0 && (
            <div className="card stack">
              <h3>Venue booking decisions</h3>
              {bookingsToDecide.map((booking) => (
                <div key={booking.id} style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 14, marginTop: 14 }}>
                  <p style={{ fontWeight: 600, marginBottom: 4 }}>
                    {event.name && <span style={{ marginRight: 6 }}>{event.name} —</span>}
                    {booking.venue_name || `Venue #${booking.venue_id}`}
                    <BookingStatusBadge status={booking.status} />
                  </p>
                  {booking.needs_review && booking.status === 'APPROVED' && (
                    <p className="muted">Approving again clears Requires review. The booking stays approved.</p>
                  )}
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
                  {booking.status === 'PENDING' && (
                    <>
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
                    </>
                  )}
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
                    {booking.status === 'PENDING' && (
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
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* SCRUM-63: only the assigned Coordinator opens or changes registration, and only once Confirmed. */}
          {isCoordinator && hasRole(ROLES.EVENT_COORDINATOR) && event.status === 'CONFIRMED' && (
            <RegistrationSettingsCard
              event={event}
              onRun={({ path, method, body }) => run(() => api(path, { method, body }))}
            />
          )}

          {/* SCRUM-51: registration details and the Attendee's own status; SCRUM-52/53 buttons inside. */}
          {isAttendee && (
            <AttendeeRegistrationCard
              status={registrationStatus}
              registering={registering}
              onRegister={async () => {
                // SCRUM-52: disabled while the request runs so a double click cannot send two registrations.
                setRegistering(true);
                await run(async () => {
                  const { placesLeft } = await api(`/api/events/${id}/registrations`, { method: 'POST' });
                  return `Registered. ${placesLeft} ${placesLeft === 1 ? 'place' : 'places'} left.`;
                });
                setRegistering(false);
              }}
              onWithdraw={() => run(() => api(`/api/events/${id}/registrations/withdraw`, { method: 'POST' }))}
            />
          )}

          {/* SCRUM-74: the Organiser and assigned Coordinator see who registered and the
              active count against capacity; everyone else never requests this. */}
          {(isOrganiser || isCoordinator) && <EventRegistrationsCard data={eventRegistrations} />}

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
            {/* SCRUM-28 AC1: submitted requests stay unassigned until the Lead assigns (SCRUM-71).
                SCRUM-29 AC1 + AC3: shows the assigned Coordinator's name; the event is re-read
                on load, so after a reassignment the Organiser sees the new Coordinator.
                Input: event.coordinatorName. Output: name, or "Unassigned" when none. */}
            <p><strong>Coordinator:</strong> {event.coordinatorName || 'Unassigned'}</p>
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
                    {booking.needs_review && <span className="needs-review-flag">Requires review</span>}
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
                {/*
                 * Purpose: expose cancellation for an eligible booking to its assigned Coordinator.
                 * AC: SCRUM-61 AC1/AC5 — only pending, held, or approved bookings can be cancelled.
                 * Inputs: current user, event assignment, and booking status. Output: cancel request and refreshed event data.
                 * Failure: run displays API errors and leaves the booking unchanged when cancellation fails.
                 */}
                {isCoordinator && hasRole(ROLES.EVENT_COORDINATOR)
                  && event.status !== 'COMPLETED'
                  && ['PENDING', 'TENTATIVE', 'APPROVED'].includes(booking.status) && (
                  <button
                    className="btn ghost"
                    onClick={() => run(() => api(`/api/venues/bookings/${booking.id}/cancel`, { method: 'POST' }))}
                  >
                    Cancel booking
                  </button>
                )}
              </div>
            )) : <p className="muted">No booking yet. Essential arrangements must be approved before confirmation.</p>}
            {/* A coordinator may create independent requests for the same event. */}
            {isCoordinator && hasRole(ROLES.EVENT_COORDINATOR) && canBookVenue && (
              <Link className="btn venue-book-link" to={`/app/events/${id}/venue-booking`}>Book a venue</Link>
            )}
          </div>
          {hasRole(ROLES.SAFETY_OFFICER) && (
            <div className="card stack">
              <h3>Safety check</h3>
              <p className="muted">Only a Safety Officer can open a safety check or record its outcome.</p>
              <Link className="btn ghost" to="/app/events/safety-queue">Safety queue</Link>
              {event.status === 'AWAITING_SAFETY_CHECK' && (
                <Link className="btn" to={`/app/events/${id}/safety-check`}>Open safety check</Link>
              )}
            </div>
          )}

          {canViewPlanning && <div className="card">
            <h3>Equipment requests</h3>
            {equipmentError ? <p className="alert">Equipment requests could not be loaded: {equipmentError}</p>
              : equipmentRequests.length ? equipmentRequests.map((item) => (
              <div key={item.id} className="equipment-request-row" style={{ marginBottom: 10 }}>
                <p style={{ margin: '2px 0' }}>
                  {item.equipment_name || item.equipment_type || 'Item no longer in catalogue'} × {item.quantity}: {item.status}
                  {item.needs_review && <span className="needs-review-flag">Requires review</span>}
                </p>
                {item.equipment_type && (
                  <p className="muted" style={{ margin: '2px 0', fontSize: '0.85rem' }}>
                    Type: {item.equipment_type}
                  </p>
                )}
                {(item.technical_requirements || item.notes) && (
                  <p className="muted" style={{ margin: '2px 0', fontSize: '0.85rem' }}>
                    Specifications: {item.technical_requirements || item.notes}
                  </p>
                )}
                {(item.start_at && item.end_at) && (
                  <p className="muted" style={{ margin: '2px 0', fontSize: '0.82rem' }}>
                    Timing: {new Date(item.start_at).toLocaleString()} – {new Date(item.end_at).toLocaleString()}
                  </p>
                )}
                {item.decision_reason && (
                  <p className="muted" style={{ margin: '2px 0', fontSize: '0.85rem' }}>
                    Arrangement note: {item.decision_reason}
                  </p>
                )}
              </div>
            )) : <p className="muted">No equipment requested yet.</p>}
            {isCoordinator && hasRole(ROLES.EVENT_COORDINATOR) && !['CANCELLED', 'REJECTED'].includes(event.status) && (
              <div style={{ marginTop: 10 }}>
                <Link className="btn equipment-request-link" to={`/app/events/${id}/equipment-request`}>
                  Request equipment
                </Link>
              </div>
            )}
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
      <ConflictModal
        isOpen={Boolean(conflictModalMsg)}
        onClose={() => setConflictModalMsg('')}
        message={conflictModalMsg}
      />
    </>
  );
}

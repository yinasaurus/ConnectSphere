import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';

// Keep date/time output consistent between the live window and saved requests.
function formatTime(value) {
  return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-GB');
}

function formatSubmittedDate(value) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Keep database status constants readable while retaining their status-specific CSS class.
function formatStatus(status) {
  return status ? `${status[0]}${status.slice(1).toLowerCase()}` : 'Unknown';
}

// A date must be parseable before it can be used to build a booking window.
function isValidDate(value) {
  return Boolean(value) && !Number.isNaN(new Date(value).getTime());
}

// Zero-minute setup or turnaround is valid; only absent or invalid values block submission.
function hasValidMinutes(value) {
  return value !== null && value !== undefined && value !== ''
    && Number.isInteger(Number(value)) && Number(value) >= 0;
}

// Apply the selected venue's saved setup and turnaround values to an event's time range.
function getOccupiedWindow(startAt, endAt, setupMinutes, turnaroundMinutes) {
  const start = new Date(new Date(startAt).getTime() - Number(setupMinutes) * 60_000);
  const end = new Date(new Date(endAt).getTime() + Number(turnaroundMinutes) * 60_000);
  return { start, end };
}

// Treat empty values and "none" answers as no constraint, and split recorded lists into comparable items.
// Uses Regex to extract out requirements
function parseRequirements(value) {
  if (!value || /^(none|n\/a|not applicable|no special requirements)$/i.test(value.trim())) return [];
  return value.split(/[,;\n]|\s+and\s+/i)
    .map((item) => item.trim().replace(/[.!?]+$/, ''))
    .filter(Boolean);
}

// Compare each requested feature independently so a mismatch in 1 feature/criteria does not hide the others.
function getVenueSuitability(event, venue, booking) {
  if (!venue) {
    return { suitable: null, reasons: ['Venue details are unavailable for this request.'] };
  }

  const reasons = [];
  const attendance = Number(
    booking?.expected_attendance ?? booking?.expectedAttendance ?? event.expectedAttendance
  );

  // check attendance > venue capcity
  const capacity = Number(venue.capacity);
  if (Number.isFinite(attendance) && attendance > 0 && Number.isFinite(capacity) && attendance > capacity) {
    reasons.push(`Expected attendance (${attendance}) exceeds venue capacity (${capacity}).`);
  }

  // places missing accessbility requirements into an array and add it into an error message
  const missingAccessibility = parseRequirements(event.accessibilityNeeds)
    .filter((required) => !parseRequirements(venue.accessibility)
      .some((available) => available.toLowerCase().includes(required.toLowerCase())));
  if (missingAccessibility.length) {
    reasons.push(`Missing accessibility features: ${missingAccessibility.join(', ')}.`);
  }

  // places missing facility requirements into an array and add it into an error message
  const requiredFacilities = [
    ...parseRequirements(event.venueRequirements),
    ...parseRequirements(event.equipmentNotes),
  ];
  const missingFacilities = [...new Set(requiredFacilities
    .filter((required) => !parseRequirements(venue.facilities)
      .some((available) => available.toLowerCase().includes(required.toLowerCase()))))];
  if (missingFacilities.length) {
    reasons.push(`Missing required facilities: ${missingFacilities.join(', ')}.`);
  }

  // places missing layout requirements into an array and add it into an error message
  const layout = event.layoutPreference?.trim();
  const supportedLayouts = Array.isArray(venue.layouts) ? venue.layouts : [];
  if (layout && !supportedLayouts.some((available) => (
    String(available).toLowerCase() === layout.toLowerCase()
  ))) {
    reasons.push(`Room layout '${layout}' is not supported by this venue.`);
  }

  return { suitable: reasons.length === 0, reasons };
}

// Render one request with its own saved timing, submission date, and decision status.
// Displays "Requests for this event" card - venue booking request and its status (bottom right)
function BookingRequest({ booking, event, venues }) {
  const validWindow = isValidDate(booking.start_at)
    && isValidDate(booking.end_at)
    && hasValidMinutes(booking.setup_minutes)
    && hasValidMinutes(booking.teardown_minutes);
  const window = validWindow
    ? getOccupiedWindow(booking.start_at, booking.end_at, booking.setup_minutes, booking.teardown_minutes)
    : null;
  // Get venue details and evaluate venue suitability for this venue booking request.
  const venue = booking.venue_details
    ? { id: booking.venue_id, ...booking.venue_details }
    : venues.find((item) => String(item.id) === String(booking.venue_id));
  const suitability = getVenueSuitability(event, venue, booking);

  return (
    <div className="venue-request-row">
      <div className="row-between">
        <strong>{booking.venue_name || 'Venue request'}</strong>
        <span className={`booking-status ${booking.status}`}>{formatStatus(booking.status)}</span>
      </div>
      <p className="muted">
        {window
          ? `Occupied ${formatTime(window.start)} to ${formatTime(window.end)}`
          : 'Occupied window unavailable'}
        {booking.created_at && ` · Submitted ${formatSubmittedDate(booking.created_at)}`}
      </p>
      {/* Venue suitability is advisory (do not restrict) and isolated/independant to this individual venue request. */}
      <div
        className={`venue-suitability ${suitability.suitable === null
          ? 'unavailable'
          : suitability.suitable ? 'suitable' : 'unsuitable'}`}
        role={suitability.suitable === false ? 'alert' : 'status'}
      >
        <strong>
          {suitability.suitable === null
            ? 'Suitability unavailable'
            : suitability.suitable ? 'Venue appears suitable' : 'Venue appears unsuitable'}
        </strong>
        {suitability.reasons.length > 0 && (
          <ul>
            {suitability.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function VenueBooking() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [venues, setVenues] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [venueId, setVenueId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Load all event-specific booking inputs and history together for a consistent review screen.
  // The venue catalogue endpoint returns active venues, and booking history is scoped to this event ID.
  useEffect(() => {
    let active = true;
    Promise.all([
      api(`/api/events/${id}`),
      api('/api/venues'),
      api(`/api/events/${id}/venue-bookings`),
    ]).then(([eventResult, venueResult, bookingResult]) => {
      if (!active) return;
      setEvent(eventResult.event);
      setVenues(venueResult.venues || []);
      setBookings(bookingResult.bookings || []);
    }).catch((err) => {
      if (active) setError(err.message);
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [id]);

  // Resolve the selected venue and derive the four independent submission checks.
  const venue = useMemo(
    () => venues.find((item) => String(item.id) === venueId),
    [venues, venueId]
  );
  const eventTimeValid = isValidDate(event?.startAt)
    && isValidDate(event?.endAt)
    && new Date(event.startAt) < new Date(event.endAt);
  const venueTimesValid = Boolean(
    venue && hasValidMinutes(venue.setupMinutes) && hasValidMinutes(venue.teardownMinutes)
  );
  const requirementsValid = Boolean(
    Number(event?.expectedAttendance) > 0
    && event?.venueRequirements?.trim()
    && event?.accessibilityNeeds?.trim()
  );
  // Each checklist item is a required submission condition, keeping the button aligned with AC 5
  /*
   AC 5:  A booking request cannot be submitted if required booking information is missing.
  */
  const checks = [
    { label: 'Venue selected', passed: Boolean(venue) },
    { label: 'Event date and time set', passed: Boolean(eventTimeValid) },
    { label: 'Venue has setup and turnaround times', passed: venueTimesValid },
    { label: 'Required venue details are recorded', passed: requirementsValid },
  ];
  // Prevent a second submission while the current request is being saved.
  const canSubmit = checks.every((check) => check.passed) && !submitting;
  const occupiedWindow = eventTimeValid && venueTimesValid
    ? getOccupiedWindow(event.startAt, event.endAt, venue.setupMinutes, venue.teardownMinutes)
    : null;
  // Capacity remains an advisory check; the required checklist controls whether submission is enabled.
  // Checks if venue is selected and expected attendance > venue capacity
  // Suitability is advisory and intentionally does not participate in canSubmit.
  const suitability = venue ? getVenueSuitability(event, venue) : null;

  // Submit only the event, venue, schedule, and configured window inputs required by the API.
  async function submitRequest() {
    if (!canSubmit || !event || !venue) return;
    setError('');
    setSubmitting(true);
    try {
      await api('/api/venues/bookings', {
        method: 'POST',
        body: {
          // The API accepts camelCase fields and persists them as event/venue IDs and booking times.
          eventId: Number(id),
          venueId: Number(venue.id),
          startAt: event.startAt,
          endAt: event.endAt,
          setupMinutes: Number(venue.setupMinutes),
          teardownMinutes: Number(venue.teardownMinutes),
        },
      });
      // Return to this event so its refreshed request list shows the new Pending booking.
      // The destination page reads this navigation state to show its success banner.
      navigate(`/app/events/${id}`, { state: { venueBookingSubmitted: true } });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  if (loading) return <p className="muted">Loading venue booking…</p>;
  if (!event) return <div className="alert" role="alert">{error || 'Event could not be loaded.'}</div>;

  return (
    <div className="venue-booking-page">
      <header className="venue-booking-heading">
        <p className="muted">{event.category || 'Event'} · {event.status}</p>
        <h1>{event.name}</h1>
        <p>Book a venue for this event</p>
      </header>

      <Link className="venue-back-link" to={`/app/events/${id}`}>‹ Back to event</Link>
      {error && <div className="alert" role="alert">{error}</div>}

      <div className="venue-booking-columns">
        <div className="stack">
          <section className="card">
            <h2>Venue</h2>
            <label htmlFor="venue-select">Choose a venue</label>
            {/* Keep venue choice limited to the active catalogue and show capacity before selection. */}
            <select id="venue-select" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              <option value="">Select a venue</option>
              {venues.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} (seats {item.capacity})
                </option>
              ))}
            </select>

            {/* Show suitability beside the selector, but keep unsuitable venues available to book. */}
            {suitability && (
              <div
                className={`venue-suitability ${suitability.suitable ? 'suitable' : 'unsuitable'}`}
                role={suitability.suitable ? 'status' : 'alert'}
              >
                <strong>
                  {suitability.suitable ? 'Venue appears suitable' : 'Venue appears unsuitable'}
                </strong>
                {suitability.reasons.length > 0 && (
                  <ul>
                    {suitability.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                )}
              </div>
            )}
            {/* Without both saved buffer values, neither the occupied window nor conflict range is known. */}
            {venue && !venueTimesValid && (
              <p className="booking-warning" role="alert">
                This venue has no valid setup or turnaround time, so its occupied window cannot be calculated.
              </p>
            )}
          </section>

          <section className="card">
            <h2>Event time and occupied window</h2>
            {/* Keep the scheduled event period beside the venue-held period for direct comparison. */}
            <div className="booking-time-grid">
              <div className="booking-time-box">
                <span className="muted">Event time</span>
                {eventTimeValid ? (
                  <>
                    <strong>{formatTime(event.startAt)} to {formatTime(event.endAt)}</strong>
                    <span className="muted">
                      {formatDate(event.startAt)}
                      {formatDate(event.startAt) !== formatDate(event.endAt)
                        ? ` to ${formatDate(event.endAt)}`
                        : ''}
                    </span>
                  </>
                ) : <strong>Event date and time are incomplete</strong>}
              </div>
              <div className="booking-time-box occupied">
                <span className="muted">Occupied window</span>
                {occupiedWindow ? (
                  <>
                    <strong>{formatTime(occupiedWindow.start)} to {formatTime(occupiedWindow.end)}</strong>
                    <span className="muted">
                      {venue.setupMinutes} min setup before, {venue.teardownMinutes} min turnaround after
                    </span>
                  </>
                ) : (
                  <strong>
                    {venue && !eventTimeValid
                      ? 'Event date and time unavailable'
                      : 'Select a venue to see this'}
                  </strong>
                )}
              </div>
            </div>
            <p className="muted booking-footnote">
              The venue is held from setup start until turnaround ends, so other bookings cannot overlap this window.
            </p>
          </section>

          <section className="card">
            <h2>Venue requirements</h2>
            <p className="muted">Taken from the event request. The chosen venue must meet these.</p>
            {/* This summary is intentionally read-only so booking cannot change the source event request. */}
            <dl className="booking-requirements">
              <div><dt>Seating layout</dt><dd>{event.layoutPreference || 'Not specified'}</dd></div>
              <div><dt>Attendance</dt><dd>{event.expectedAttendance ? `${event.expectedAttendance} people` : 'Not specified'}</dd></div>
              <div><dt>Venue needs</dt><dd>{event.venueRequirements || 'Not specified'}</dd></div>
              <div><dt>Equipment</dt><dd>{event.equipmentNotes || 'None specified'}</dd></div>
              <div><dt>Accessibility</dt><dd>{event.accessibilityNeeds || 'Not specified'}</dd></div>
            </dl>
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <h2>Review and submit</h2>
            <ul className="booking-checklist">
              {checks.map((check) => (
                <li className={check.passed ? 'passed' : ''} key={check.label}>
                  <span aria-hidden="true">{check.passed ? '✓' : '○'}</span>
                  {check.label}
                </li>
              ))}
            </ul>
            <p className="muted">
              After you submit, the request is sent to Venue Staff with the status Pending.
            </p>
            <div className="actions booking-actions">
              <Link className="btn secondary" to={`/app/events/${id}`}>Cancel</Link>
              <button className="btn" disabled={!canSubmit} onClick={submitRequest}>
                {submitting ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Requests for this event</h2>
            {/* Render each prior request independently so its own timing and review status remain visible. */}
            {bookings.length ? bookings.map((booking) => (
              <BookingRequest key={booking.id} booking={booking} event={event} venues={venues} />
            )) : <p className="muted">No venue requests for this event yet.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';

/**
 * Purpose: Safety Officer reviews an awaiting event and records approve / reject / request changes.
 * AC: SCRUM-55 AC2 (review fields); SCRUM-56 AC1–AC4 (outcome form rules).
 * Business rule: W7 #6. Crowd movement / emergency access are assessed outside the system.
 * Inputs: event id from the route; GET then POST /api/events/:id/safety-check.
 * Failure: 403 shows the server message and no extra event details from the blocked response.
 */
export default function SafetyCheck() {
  const { id } = useParams();
  const [check, setCheck] = useState(null);
  const [outcome, setOutcome] = useState('APPROVE');
  const [reason, setReason] = useState('');
  const [selectedBookings, setSelectedBookings] = useState([]);
  const [selectedEquipment, setSelectedEquipment] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    api(`/api/events/${id}/safety-check`)
      .then((data) => setCheck(data.safetyCheck))
      .catch((err) => {
        // After an outcome the event leaves Awaiting, so GET open returns 409. SO is not an
        // AC8 outcome viewer on the event page — tell them the check is closed and link back.
        if (err.status === 409) {
          setError(
            'This safety check is no longer open. The outcome was already recorded, or the event left the awaiting queue.'
          );
          return;
        }
        setError(err.message);
      });
  }, [id]);

  function toggleId(list, setList, value) {
    setList((prev) => (
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    ));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const affectedArrangements = [
        ...selectedBookings.map((bookingId) => ({ type: 'VENUE_BOOKING', id: bookingId })),
        ...selectedEquipment.map((requestId) => ({ type: 'EQUIPMENT_REQUEST', id: requestId })),
      ];
      const body = { outcome, reason };
      if (outcome === 'REQUEST_CHANGES') {
        body.affectedArrangements = affectedArrangements;
      }
      const data = await api(`/api/events/${id}/safety-check`, {
        method: 'POST',
        body,
      });
      setCheck((prev) => ({
        ...prev,
        outcome: data.safetyCheck.outcome,
        reason: data.safetyCheck.reason,
        status: data.safetyCheck.outcome === 'APPROVED' ? 'PREPARATION' : 'PLANNING',
      }));
      setMessage('Safety check outcome recorded.');
    } catch (err) {
      setError(err.message);
    }
  }

  const recorded = Boolean(check?.outcome);
  const needsReason = outcome === 'REJECT' || outcome === 'REQUEST_CHANGES';
  const needsArrangements = outcome === 'REQUEST_CHANGES';
  const canSubmit = !recorded
    && (!needsReason || reason.trim())
    && (!needsArrangements || selectedBookings.length + selectedEquipment.length > 0);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Safety check</h1>
          <p>Only a Safety Officer can open this check or record its outcome.</p>
        </div>
      </div>
      {error && (
        <div className="alert stack">
          <p>{error}</p>
          {!check && (
            <Link className="btn ghost" to="/app/events/safety-queue">Back to queue</Link>
          )}
        </div>
      )}
      {message && <div className="alert success">{message}</div>}
      {check && (
        <div className="stack" style={{ maxWidth: 720 }}>
          <div className="card stack">
            <p><strong>Event:</strong> {check.eventName || `Event ${check.eventId}`}</p>
            <p><strong>Expected attendance:</strong> {check.expectedAttendance ?? '—'}</p>
            <p><strong>Accessibility needs:</strong> {check.accessibilityNeeds || '—'}</p>
          </div>

          <div className="card stack">
            <h3>Booked venues</h3>
            {(check.bookings || []).map((booking) => (
              <div key={booking.id}>
                <strong>{booking.venueName || `Venue ${booking.venueId}`}</strong>
                <p className="muted">
                  Capacity {booking.capacity ?? '—'}
                  {booking.layouts?.length ? ` · Layouts: ${booking.layouts.join(', ')}` : ''}
                  {booking.venueAccessibility ? ` · Accessibility: ${booking.venueAccessibility}` : ''}
                </p>
              </div>
            ))}
            {!check.bookings?.length && <p className="muted">No active venue bookings.</p>}
          </div>

          <div className="card stack">
            <h3>Requested equipment</h3>
            {(check.equipmentRequests || []).map((item) => (
              <div key={item.id}>
                <strong>{item.equipmentName || `Request ${item.id}`}</strong>
                <p className="muted">
                  Qty {item.quantity} · {item.status}
                  {item.notes ? ` · ${item.notes}` : ''}
                </p>
              </div>
            ))}
            {!check.equipmentRequests?.length && (
              <p className="muted">No equipment requested for this event.</p>
            )}
          </div>

          {!recorded ? (
            <form className="card stack" onSubmit={onSubmit}>
              <label htmlFor="safety-outcome">Outcome</label>
              <select
                id="safety-outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              >
                <option value="APPROVE">Approve</option>
                <option value="REJECT">Reject</option>
                <option value="REQUEST_CHANGES">Request changes</option>
              </select>

              <label htmlFor="safety-reason">
                Reason{needsReason ? ' (required)' : ' (optional)'}
              </label>
              <textarea
                id="safety-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={needsReason ? 'Explain the decision' : 'Optional note'}
              />

              {needsArrangements && (
                <>
                  <p>Select at least one affected arrangement:</p>
                  {(check.bookings || []).map((booking) => (
                    <label key={`b-${booking.id}`}>
                      <input
                        type="checkbox"
                        checked={selectedBookings.includes(booking.id)}
                        onChange={() => toggleId(selectedBookings, setSelectedBookings, booking.id)}
                      />
                      {' '}Venue: {booking.venueName || booking.id}
                    </label>
                  ))}
                  {(check.equipmentRequests || []).map((item) => (
                    <label key={`e-${item.id}`}>
                      <input
                        type="checkbox"
                        checked={selectedEquipment.includes(item.id)}
                        onChange={() => toggleId(selectedEquipment, setSelectedEquipment, item.id)}
                      />
                      {' '}Equipment: {item.equipmentName || item.id}
                    </label>
                  ))}
                </>
              )}

              <div className="actions">
                <button className="btn" type="submit" disabled={!canSubmit}>Record outcome</button>
                <Link className="btn ghost" to="/app/events/safety-queue">Back to queue</Link>
              </div>
            </form>
          ) : (
            <div className="card stack">
              <p><strong>Recorded outcome:</strong> {check.outcome}</p>
              {check.reason && <p><strong>Reason:</strong> {check.reason}</p>}
              <Link className="btn ghost" to="/app/events/safety-queue">Back to queue</Link>
            </div>
          )}
        </div>
      )}
    </>
  );
}

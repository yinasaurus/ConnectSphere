import { useEffect, useState } from 'react';
import { api } from '../api';

// <input type="datetime-local"> gives local time without a zone; send it as ISO (UTC).
function toIso(localValue) {
  return localValue ? new Date(localValue).toISOString() : '';
}

// A hold only makes sense for an event that is still being planned.
const HOLDABLE_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PLANNING'];

/**
 * Purpose: Venue Staff place a tentative hold on a venue for an event's date and time.
 * AC: SCRUM-75 AC1-AC5. The API checks every rule (expiry required, not in the past, not after
 *   the event start, no clash with a confirmed booking or active hold); this card sends what was
 *   picked and shows the server's message when a rule is broken.
 * Inputs: venues (active venues for the dropdown), onPlaced() — called after a hold is saved so
 *   the page can reload its bookings.
 */
export default function PlaceHoldCard({ venues, onPlaced }) {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [venueId, setVenueId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/api/events')
      .then((res) => setEvents((res?.events || []).filter((event) => (
        HOLDABLE_STATUSES.includes(event.status) && event.startAt
      ))))
      .catch((err) => setError(err.message));
  }, []);

  const selectedEvent = events.find((event) => String(event.id) === String(eventId));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api('/api/venues/holds', {
        method: 'POST',
        body: {
          eventId: eventId ? Number(eventId) : undefined,
          venueId: venueId ? Number(venueId) : undefined,
          expiresAt: toIso(expiresAt) || undefined,
        },
      });
      setSuccess('Hold placed.');
      setExpiresAt('');
      await onPlaced?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 18 }} data-testid="place-hold-card">
      <h3>Place a hold</h3>
      <p className="muted">
        Reserve a venue for an event while the Coordinator finalises arrangements. A hold is not a
        confirmed booking and stops blocking the venue at its expiry.
      </p>
      <form className="stack" onSubmit={submit}>
        <label htmlFor="hold-event">Event</label>
        <select id="hold-event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">Choose an event</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>{event.name}</option>
          ))}
        </select>

        <label htmlFor="hold-venue">Venue</label>
        <select id="hold-venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
          <option value="">Choose a venue</option>
          {(venues || []).map((venue) => (
            <option key={venue.id} value={venue.id}>{venue.name}</option>
          ))}
        </select>

        {selectedEvent && (
          <p className="muted" data-testid="hold-event-window">
            <strong>Held for:</strong> {new Date(selectedEvent.startAt).toLocaleString()}
            {selectedEvent.endAt ? ` to ${new Date(selectedEvent.endAt).toLocaleString()}` : ''}
            {' '}(expiry must be no later than the event start)
          </p>
        )}

        <label htmlFor="hold-expires-at">Hold expires</label>
        <input
          id="hold-expires-at"
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />

        <button className="btn" type="submit" disabled={saving}>
          {saving ? 'Placing hold…' : 'Place hold'}
        </button>
      </form>
      {error && <div className="alert">{error}</div>}
      {success && <div className="alert success">{success}</div>}
    </div>
  );
}

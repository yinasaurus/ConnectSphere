import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Purpose: Venue Staff view the bookings identified as affected by a recorded venue
 *   unavailability period, so they can see which events need alternative arrangements.
 * AC: SCRUM-60 AC8. Bookings are already marked server-side when the period is recorded
 *   (AC1-AC7, AC9); this card is a read-only, re-fetchable view onto that same list.
 * Inputs: venues (for the venue-name lookup in the period dropdown and the results table).
 */
export default function AffectedBookingsCard({ venues }) {
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('/api/venues/unavailability')
      .then((res) => setPeriods(res?.unavailability || []))
      .catch(() => {});
  }, []);

  function venueName(venueId) {
    return (venues || []).find((venue) => venue.id === venueId)?.name || `Venue #${venueId}`;
  }

  async function view() {
    setError('');
    setBookings(null);
    if (!periodId) return;
    setLoading(true);
    try {
      const res = await api(`/api/venues/unavailability/${periodId}/affected-bookings`);
      setBookings(res?.bookings || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!periods.length) return null;

  return (
    <div className="card" style={{ marginTop: 18 }} data-testid="affected-bookings-card">
      <h3>Bookings affected by a venue becoming unavailable</h3>
      <p className="muted">
        Pick a recorded unavailability period to see which bookings now need alternative
        arrangements.
      </p>
      <div className="stack">
        <label htmlFor="affected-period">Unavailability period</label>
        <select id="affected-period" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
          <option value="">Choose a period</option>
          {periods.map((period) => (
            <option key={period.id} value={period.id}>
              {venueName(period.venue_id)} — {period.reason} (
              {new Date(period.start_at).toLocaleString()} to {new Date(period.end_at).toLocaleString()})
            </option>
          ))}
        </select>
        <button className="btn" onClick={view} disabled={!periodId || loading}>
          {loading ? 'Loading…' : 'View affected bookings'}
        </button>
      </div>
      {error && <div className="alert">{error}</div>}
      {bookings !== null && (
        bookings.length === 0 ? (
          <p className="muted">No bookings are affected by this period.</p>
        ) : (
          <table className="table" id="affected-bookings-table" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Event</th>
                <th>Venue</th>
                <th>Date</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr key={booking.id}>
                  <td>{booking.eventName || `Event #${booking.eventId}`}</td>
                  <td>{venueName(booking.venueId)}</td>
                  <td>{new Date(booking.startAt).toLocaleDateString()}</td>
                  <td>
                    {new Date(booking.startAt).toLocaleTimeString()} - {new Date(booking.endAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

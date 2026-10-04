import { useEffect, useState } from 'react';
import { api } from '../api';

// SCRUM-66: venue availability view. The backend decides what is available
// (GET /api/venues/:id/availability); this page only picks the range and shows it.
// Route and nav link are limited to internal roles in App.jsx / Layout.jsx (AC6).

// Readable names for the block types the backend sends in `reasons[].type`.
const REASON_LABELS = {
  BOOKING: 'Confirmed booking (incl. setup/turnaround)',
  TENTATIVE_HOLD: 'Tentative hold',
  UNAVAILABILITY: 'Unavailable',
};

function formatTime(value) {
  return new Date(value).toLocaleString();
}

export default function VenueAvailability() {
  const [venues, setVenues] = useState([]);
  const [venueId, setVenueId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load the venue list once for the dropdown.
  useEffect(() => {
    api('/api/venues')
      .then((res) => setVenues(res.venues || []))
      .catch((err) => setError(err.message));
  }, []);

  async function check(e) {
    e.preventDefault();
    if (!venueId || !from || !to) {
      setError('Pick a venue, a start and an end date/time.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // datetime-local inputs are in the user's local time; send UTC ISO strings,
      // the same way the venue search does.
      const params = new URLSearchParams({
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
      setResult(await api(`/api/venues/${venueId}/availability?${params.toString()}`));
    } catch (err) {
      setResult(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Venue availability</h1>
          <p>
            Confirmed bookings (including setup and turnaround time), active tentative holds and
            recorded unavailability are marked unavailable. Everything else is marked available.
            Pending booking requests are not shown.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <form onSubmit={check} className="stack">
          <label htmlFor="availability-venue" className="muted">Venue</label>
          <select id="availability-venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            <option value="">Select venue</option>
            {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
          <label htmlFor="availability-from" className="muted">From</label>
          <input id="availability-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          <label htmlFor="availability-to" className="muted">To</label>
          <input id="availability-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="actions">
            <button className="btn" type="submit" disabled={loading}>
              {loading ? 'Checking…' : 'Check availability'}
            </button>
          </div>
        </form>
      </div>

      {error && <div className="alert">{error}</div>}

      {result && (
        <div className="card">
          <h3>{result.venue.name}</h3>
          <table className="table">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Status</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {/* One row per period; unavailable rows list every block that covers them. */}
              {result.periods.map((period) => (
                <tr key={period.startAt}>
                  <td>{formatTime(period.startAt)}</td>
                  <td>{formatTime(period.endAt)}</td>
                  <td>
                    <span className={`badge ${period.available ? 'AVAILABLE' : 'UNAVAILABLE'}`}>
                      {period.available ? 'Available' : 'Unavailable'}
                    </span>
                  </td>
                  <td>
                    {period.reasons.map((reason) => (
                      <div key={`${reason.type}-${reason.id}`}>
                        {REASON_LABELS[reason.type] || reason.type}: {reason.label}
                        {reason.expiresAt && <span className="muted"> · hold expires {formatTime(reason.expiresAt)}</span>}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

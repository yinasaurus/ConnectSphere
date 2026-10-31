import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Purpose: show recorded venue unavailability periods.
 * AC: SCRUM-72. Recording is Venue Staff's own action (blockVenue); this list is read-only.
 * Inputs: venues (for the venue-name lookup), refreshKey (bump it to force a reload, e.g.
 *   after recording a new one).
 */
export default function UnavailabilityList({ venues, refreshKey }) {
  const [periods, setPeriods] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      const res = await api('/api/venues/unavailability');
      setPeriods(res?.unavailability || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  function venueName(venueId) {
    return (venues || []).find((venue) => venue.id === venueId)?.name || `Venue #${venueId}`;
  }

  if (!periods.length && !error) return null;

  return (
    <div className="card" style={{ marginTop: 18 }} data-testid="unavailability-list">
      <h3>Venue unavailability periods</h3>
      {error && <div className="alert">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>Venue</th>
            <th>Reason</th>
            <th>From</th>
            <th>Until</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={period.id}>
              <td>{venueName(period.venue_id)}</td>
              <td>{period.reason}</td>
              <td>{new Date(period.start_at).toLocaleString()}</td>
              <td>{new Date(period.end_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

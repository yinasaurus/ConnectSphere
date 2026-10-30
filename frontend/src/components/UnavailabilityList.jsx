import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Purpose: show recorded venue unavailability periods, and let a Coordinator/Lead end one
 *   early.
 * AC: SCRUM-72. Recording is Venue Staff's own action (blockVenue); ending a period early is
 *   Coordinator-initiated, not something Venue Staff (who recorded it) can do themselves
 *   (Week 4 Q&A, NG AIK SHUAN KEENE — Venue Staff "cannot make changes... the co-ordinator
 *   need to initiate the change"). "End early" is therefore only offered to a Coordinator or
 *   Lead, and only for a period that hasn't already ended.
 * Inputs: venues (for the venue-name lookup), canEndEarly (whether the signed-in user may end
 *   a period early), refreshKey (bump it to force a reload, e.g. after recording a new one).
 */
export default function UnavailabilityList({ venues, canEndEarly, refreshKey }) {
  const [periods, setPeriods] = useState([]);
  const [error, setError] = useState('');
  const [endingId, setEndingId] = useState(null);

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

  async function endEarly(id) {
    setError('');
    setEndingId(id);
    try {
      await api(`/api/venues/unavailability/${id}/end`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setEndingId(null);
    }
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
            {canEndEarly && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => {
            const ended = new Date(period.end_at) <= new Date();
            return (
              <tr key={period.id}>
                <td>{venueName(period.venue_id)}</td>
                <td>{period.reason}</td>
                <td>{new Date(period.start_at).toLocaleString()}</td>
                <td>{new Date(period.end_at).toLocaleString()}</td>
                {canEndEarly && (
                  <td>
                    {!ended && (
                      <button
                        className="btn secondary"
                        disabled={endingId === period.id}
                        onClick={() => endEarly(period.id)}
                      >
                        {endingId === period.id ? 'Ending…' : 'End early'}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

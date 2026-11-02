import { useEffect, useState } from 'react';
import { api } from '../api';
import { displayError } from '../displayError';
import AlertBanner from './AlertBanner';
import Button from './Button';

const PAGE_SIZE = 10;

/**
 * Purpose: show recorded venue unavailability periods.
 * AC: SCRUM-72. Recording is Venue Staff's own action (blockVenue); this list is read-only.
 * Inputs: venues (for the venue-name lookup), refreshKey (bump it to force a reload, e.g.
 *   after recording a new one).
 */
export default function UnavailabilityList({ venues, refreshKey }) {
  const [periods, setPeriods] = useState([]);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);

  async function load() {
    try {
      const res = await api('/api/venues/unavailability');
      setPeriods(res?.unavailability || []);
    } catch (err) {
      setError(displayError(err));
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

  const pageCount = Math.max(1, Math.ceil(periods.length / PAGE_SIZE));
  const pageIndex = Math.min(page, pageCount - 1);
  const visiblePeriods = periods.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="card" style={{ marginTop: 18 }} data-testid="unavailability-list">
      <h3>Venue unavailability periods</h3>
      {error && <AlertBanner>{error}</AlertBanner>}
      <table className="table">
        <thead>
          <tr>
            <th>Venue</th>
            <th>Reason</th>
            <th>From</th>
            <th>Until</th>
          </tr>
        </thead>
        <tbody>
          {visiblePeriods.map((period) => (
            <tr key={period.id}>
              <td>{venueName(period.venue_id)}</td>
              <td>{period.reason}</td>
              <td>{new Date(period.start_at).toLocaleString()}</td>
              <td>{new Date(period.end_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {periods.length > PAGE_SIZE && (
        <div className="venue-pager">
          <Button variant="ghost" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>Previous</Button>
          <span className="muted">
            {pageIndex * PAGE_SIZE + 1}–{Math.min((pageIndex + 1) * PAGE_SIZE, periods.length)} of {periods.length}
          </span>
          <Button variant="ghost" disabled={pageIndex >= pageCount - 1} onClick={() => setPage(pageIndex + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

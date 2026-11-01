import { useState } from 'react';
import { api } from '../api';

// <input type="datetime-local"> gives local time without a zone; send it as ISO (UTC).
function toIso(localValue) {
  return localValue ? new Date(localValue).toISOString() : '';
}

const REASON_OPTIONS = ['Maintenance', 'Equipment failure', 'Renovation', 'Safety concerns', 'Other'];

/**
 * Purpose: Venue Staff record a venue as unavailable for a period, with a reason.
 * AC: SCRUM-72 AC1-AC3, AC8. The API enforces every rule (start/end/reason required, end
 *   after start, Venue-Staff-only); this card sends what was picked and shows the server's
 *   message when a rule is broken.
 * Inputs: venues (active venues for the dropdown), onRecorded() — called after a period is
 *   saved so the page can reload its availability data.
 */
export default function BlockVenueCard({ venues, onRecorded }) {
  const [venueId, setVenueId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [reason, setReason] = useState('Maintenance');
  const [customReason, setCustomReason] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api('/api/venues/unavailability', {
        method: 'POST',
        body: {
          venueId: venueId ? Number(venueId) : undefined,
          startAt: toIso(startAt) || undefined,
          endAt: toIso(endAt) || undefined,
          reason: reason === 'Other' ? customReason : reason,
        },
      });
      setSuccess('Venue marked unavailable for this period.');
      setStartAt('');
      setEndAt('');
      setCustomReason('');
      await onRecorded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 18 }} data-testid="block-venue-card">
      <h3>Mark a venue unavailable</h3>
      <p className="muted">
        Record a period when a venue is out of use (maintenance, equipment failure, renovation,
        safety concerns, or another reason). Existing bookings are not changed or cancelled.
      </p>
      <form className="stack" onSubmit={submit}>
        <label htmlFor="block-venue">Venue</label>
        <select id="block-venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
          <option value="">Choose a venue</option>
          {(venues || []).map((venue) => (
            <option key={venue.id} value={venue.id}>{venue.name}</option>
          ))}
        </select>

        <label htmlFor="block-start">Unavailable from</label>
        <input
          id="block-start"
          type="datetime-local"
          value={startAt}
          onChange={(e) => setStartAt(e.target.value)}
        />

        <label htmlFor="block-end">Unavailable until</label>
        <input
          id="block-end"
          type="datetime-local"
          value={endAt}
          onChange={(e) => setEndAt(e.target.value)}
        />

        <label htmlFor="block-reason">Reason</label>
        <select id="block-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASON_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        {reason === 'Other' && (
          <input
            id="block-reason-other"
            type="text"
            placeholder="Describe the reason"
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
          />
        )}

        <button className="btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Mark unavailable'}
        </button>
      </form>
      {error && <div className="alert">{error}</div>}
      {success && <div className="alert success">{success}</div>}
    </div>
  );
}

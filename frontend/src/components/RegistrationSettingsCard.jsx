import { useState } from 'react';

// <input type="datetime-local"> gives local time without a zone; send it as ISO (UTC).
function toIso(localValue) {
  return localValue ? new Date(localValue).toISOString() : '';
}

/**
 * Purpose: the assigned Coordinator's registration card on a Confirmed event. Before
 *   registration is enabled it asks for the window and maximum capacity; afterwards it shows
 *   the settings and lets the Coordinator extend the close date or change the capacity.
 * AC: SCRUM-63 AC1-AC7. The rules themselves are checked by the API; this card sends what was
 *   typed and shows the server's message when a rule is broken.
 * Inputs: event (mapped event), onRun(action) — the page's run() so errors and reload match
 *   every other action on the page.
 */
export default function RegistrationSettingsCard({ event, onRun }) {
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [capacity, setCapacity] = useState('');

  if (!event.registrationOpen) {
    return (
      <div className="card stack">
        <h3>Open registration</h3>
        <p className="muted">Set when Attendees can register and the maximum number of places.</p>
        <label htmlFor="registration-opens-at">Registration opens</label>
        <input id="registration-opens-at" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
        <label htmlFor="registration-closes-at">Registration closes</label>
        <input id="registration-closes-at" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
        <label htmlFor="registration-capacity">Maximum capacity</label>
        <input id="registration-capacity" type="number" min="1" step="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        <div className="actions">
          <button
            className="btn"
            onClick={() => onRun({
              path: `/api/events/${event.id}/registration/enable`,
              method: 'POST',
              body: { opensAt: toIso(opensAt), closesAt: toIso(closesAt), capacity },
            })}
          >
            Enable registration
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card stack">
      <h3>Registration</h3>
      <p><strong>Opens:</strong> {new Date(event.registrationOpensAt).toLocaleString()}</p>
      <p><strong>Closes:</strong> {new Date(event.registrationClosesAt).toLocaleString()}</p>
      <p><strong>Maximum capacity:</strong> {event.registrationCapacity}</p>
      <label htmlFor="registration-new-closes-at">New close date and time (later only)</label>
      <input id="registration-new-closes-at" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
      <label htmlFor="registration-new-capacity">New maximum capacity</label>
      <input id="registration-new-capacity" type="number" min="1" step="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      <div className="actions">
        <button
          className="btn secondary"
          onClick={() => onRun({
            path: `/api/events/${event.id}/registration`,
            method: 'PATCH',
            // Only send what was filled in, so an empty box doesn't change that setting.
            body: {
              ...(closesAt ? { closesAt: toIso(closesAt) } : {}),
              ...(capacity !== '' ? { capacity } : {}),
            },
          })}
        >
          Save registration changes
        </button>
      </div>
    </div>
  );
}

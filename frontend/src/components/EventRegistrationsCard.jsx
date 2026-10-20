const STATUS_LABEL = {
  REGISTERED: 'Registered',
  WAITLISTED: 'Waitlisted',
  WITHDRAWN: 'Withdrawn',
  ATTENDED: 'Attended',
  NO_SHOW: 'Did not attend',
};

/**
 * Purpose: the Organiser or assigned Coordinator's view of who has registered for their event,
 *   and the active count against the event's maximum capacity.
 * AC: SCRUM-74 AC1 (Organiser view), AC2 (same for the assigned Coordinator), AC3 (active count
 *   against capacity; withdrawn rows listed but not counted), AC4 (zero shown, not blank, when
 *   nobody has registered). AC5/AC6 (who may NOT see this) are enforced by the API — a caller
 *   this card isn't meant for never receives data to render in the first place.
 * Inputs: data ({ registrations, activeCount, capacity }) from GET /api/events/:id/registrations,
 *   or null while it hasn't loaded / couldn't load.
 */
export default function EventRegistrationsCard({ data }) {
  if (!data) {
    return (
      <div className="card stack">
        <h3>Registrations</h3>
        <p className="muted">Registration details are not available right now.</p>
      </div>
    );
  }

  const { registrations, activeCount, capacity } = data;

  return (
    <div className="card stack">
      <h3>Registrations</h3>
      <p>
        <strong>Active:</strong> {activeCount} {capacity != null ? `of ${capacity}` : '(registration not yet enabled)'}
      </p>
      {registrations.length === 0 && <p className="muted">No one has registered for this event yet.</p>}
      {registrations.map((row) => (
        <div key={row.id} className="row-between" style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
          <div>
            <strong>{row.attendee_name || 'Unnamed attendee'}</strong>
            {row.attendee_email && <span className="muted"> &middot; {row.attendee_email}</span>}
          </div>
          <span className={`badge ${row.status}`}>{STATUS_LABEL[row.status] || row.status}</span>
        </div>
      ))}
    </div>
  );
}

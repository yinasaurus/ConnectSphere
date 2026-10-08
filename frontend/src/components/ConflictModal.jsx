/**
 * Purpose: A popup modal displayed when a venue booking conflict is detected.
 * Informs the user of overlapping windows (including setup/turnaround times) and offers guidance.
 */
export default function ConflictModal({ isOpen, onClose, message, title = 'Venue Booking Conflict' }) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-modal-title"
      onClick={onClose}
    >
      <div
        className="card conflict-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div className="conflict-badge-icon">
            ⚠️
          </div>
          <div>
            <h3 id="conflict-modal-title" style={{ margin: 0, color: '#991b1b', fontSize: '1.25rem' }}>
              {title}
            </h3>
            <span className="muted" style={{ fontSize: '0.85rem' }}>Time Overlap Detected</span>
          </div>
        </div>

        <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: '12px', padding: '14px', marginBottom: '18px' }}>
          <p style={{ margin: 0, color: '#7f1d1d', fontSize: '0.92rem', lineHeight: 1.45, fontWeight: 500 }}>
            {message || 'This venue already has an overlapping booking during that window.'}
          </p>
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 20px 0', lineHeight: 1.4 }}>
          💡 <strong>Note:</strong> Venue occupied windows include setup and teardown buffer times. Please choose an alternative venue or adjust your requested start/end time.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="btn" type="button" onClick={onClose} style={{ minWidth: '100px' }}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

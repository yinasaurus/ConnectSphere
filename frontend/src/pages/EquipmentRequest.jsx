import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';

const STANDARD_EQUIPMENT_TYPES = [
  'AUDIO',
  'VIDEO',
  'LIGHTING',
  'PROJECTION',
  'STAGING',
  'ACCESSIBILITY',
  'GENERAL',
];

function formatDateTime(value) {
  if (!value) return 'TBC';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'TBC';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toDateTimeLocal(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export default function EquipmentRequest() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [catalogue, setCatalogue] = useState([]);
  const [existingRequests, setExistingRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [selectedType, setSelectedType] = useState('AUDIO');
  const [customType, setCustomType] = useState('');
  const [selectedEquipmentId, setSelectedEquipmentId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [technicalRequirements, setTechnicalRequirements] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      api(`/api/events/${id}`),
      api('/api/equipment'),
      api(`/api/equipment/requests?eventId=${id}`).catch(() => ({ requests: [] })),
    ])
      .then(([eventRes, catalogueRes, requestsRes]) => {
        if (!active) return;
        const ev = eventRes.event;
        setEvent(ev);
        setCatalogue(catalogueRes.equipment || []);
        setExistingRequests(requestsRes.requests || []);
        if (ev?.startAt) setStartAt(toDateTimeLocal(ev.startAt));
        if (ev?.endAt) setEndAt(toDateTimeLocal(ev.endAt));
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id]);

  // When a catalogue item is picked, align equipment type
  function handleCatalogueChange(itemId) {
    setSelectedEquipmentId(itemId);
    if (!itemId) return;
    const item = catalogue.find((c) => String(c.id) === String(itemId));
    if (item?.type) {
      if (STANDARD_EQUIPMENT_TYPES.includes(item.type)) {
        setSelectedType(item.type);
        setCustomType('');
      } else {
        setSelectedType('OTHER');
        setCustomType(item.type);
      }
    }
  }

  const effectiveType = selectedType === 'OTHER' ? customType.trim() : selectedType;

  // Filter catalogue items for the selected type
  const matchingCatalogueItems = useMemo(() => {
    if (!effectiveType) return catalogue;
    return catalogue.filter(
      (c) => String(c.type || '').toUpperCase() === effectiveType.toUpperCase()
    );
  }, [catalogue, effectiveType]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      setError('Quantity required must be a whole number of at least 1.');
      return;
    }

    if (!effectiveType && !selectedEquipmentId) {
      setError('Please specify an equipment type or choose an item from the catalogue.');
      return;
    }

    if (startAt && endAt) {
      const s = new Date(startAt);
      const en = new Date(endAt);
      if (s >= en) {
        setError('Required equipment start time must be before end time.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        eventId: Number(id),
        equipmentId: selectedEquipmentId ? Number(selectedEquipmentId) : undefined,
        equipmentType: effectiveType || undefined,
        quantity: qty,
        technicalRequirements: technicalRequirements.trim() || undefined,
        startAt: startAt ? new Date(startAt).toISOString() : undefined,
        endAt: endAt ? new Date(endAt).toISOString() : undefined,
      };

      await api('/api/equipment/requests', {
        method: 'POST',
        body: payload,
      });

      navigate(`/app/events/${id}`, { state: { equipmentRequestSubmitted: true } });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="muted">Loading event and equipment details…</p>;
  }

  if (!event) {
    return (
      <div className="card alert">
        <p>{error || 'Event not found.'}</p>
        <Link className="btn" to="/app/events">Back to events</Link>
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <div>
          <p className="muted">
            <Link to={`/app/events/${id}`}>← Back to {event.name}</Link>
          </p>
          <h1>Request Equipment</h1>
          <p>
            Record equipment, technical requirements, and quantities required for {event.name} so Technical Support Staff know what to prepare.
          </p>
        </div>
      </div>

      {error && <div className="alert" role="alert">{error}</div>}

      <div className="grid-2">
        <div className="stack">
          <form className="card stack" onSubmit={handleSubmit} id="equipment-request-form" noValidate>
            <h3>Record equipment requirement</h3>

            <label htmlFor="equipment-type">
              <strong>Equipment type *</strong>
            </label>
            <select
              id="equipment-type"
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value);
                if (e.target.value !== 'OTHER') setCustomType('');
              }}
            >
              {STANDARD_EQUIPMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
              <option value="OTHER">Other / Custom Type…</option>
            </select>

            {selectedType === 'OTHER' && (
              <>
                <label htmlFor="custom-equipment-type">Custom equipment type name *</label>
                <input
                  id="custom-equipment-type"
                  placeholder="e.g. BROADCAST, TELEPROMPTER, NETWORKING"
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value)}
                  required
                />
              </>
            )}

            <label htmlFor="equipment-item">
              <strong>Catalogue item (optional)</strong>
            </label>
            <select
              id="equipment-item"
              value={selectedEquipmentId}
              onChange={(e) => handleCatalogueChange(e.target.value)}
            >
              <option value="">Select a specific item from catalogue (or specify technical requirements below)</option>
              {matchingCatalogueItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.type} · Stock: {item.quantity} · {item.status})
                </option>
              ))}
            </select>

            <label htmlFor="equipment-quantity">
              <strong>Quantity required *</strong>
            </label>
            <input
              id="equipment-quantity"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />

            <label htmlFor="technical-requirements">
              <strong>Technical requirements / specifications</strong>
            </label>
            <textarea
              id="technical-requirements"
              rows={4}
              placeholder="Record technical specifications, microphone models, connector types, cables, frequency bands, power requirements, or positioning notes for Technical Support Staff..."
              value={technicalRequirements}
              onChange={(e) => setTechnicalRequirements(e.target.value)}
            />

            <div className="grid-2" style={{ gap: 12 }}>
              <div>
                <label htmlFor="equipment-start">
                  <strong>Required from (date & time)</strong>
                </label>
                <input
                  id="equipment-start"
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="equipment-end">
                  <strong>Required until (date & time)</strong>
                </label>
                <input
                  id="equipment-end"
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                />
              </div>
            </div>

            <div className="actions" style={{ marginTop: 14 }}>
              <button
                id="submit-equipment-request"
                className="btn"
                type="submit"
                disabled={submitting}
              >
                {submitting ? 'Submitting…' : 'Submit Equipment Request'}
              </button>
              <Link className="btn ghost" to={`/app/events/${id}`}>
                Cancel
              </Link>
            </div>
          </form>
        </div>

        <div className="stack">
          <div className="card stack">
            <h3>Event Context</h3>
            <p><strong>Event:</strong> {event.name}</p>
            <p>
              <strong>Event window:</strong>{' '}
              {formatDateTime(event.startAt)} – {formatDateTime(event.endAt)}
            </p>
            <p><strong>Expected attendance:</strong> {event.expectedAttendance || '—'}</p>
            <p><strong>Purpose:</strong> {event.purpose || '—'}</p>
            {event.equipmentNotes && (
              <div style={{ marginTop: 8, padding: 10, background: 'var(--paper)', borderRadius: 8 }}>
                <strong>Organiser equipment notes:</strong>
                <p style={{ margin: '4px 0 0', fontSize: '0.9rem' }}>{event.equipmentNotes}</p>
              </div>
            )}
          </div>

          <div className="card stack">
            <h3>Equipment Requests for this Event</h3>
            {existingRequests.length ? (
              existingRequests.map((req) => (
                <div
                  key={req.id}
                  className="equipment-request-row"
                  style={{
                    borderTop: '1px solid var(--line)',
                    paddingTop: 10,
                    marginTop: 8,
                  }}
                >
                  <div className="row-between">
                    <strong>
                      {req.equipment_name || req.equipment_type || 'Equipment item'} × {req.quantity}
                    </strong>
                    <span className={`pill ${req.status?.toLowerCase()}`}>{req.status}</span>
                  </div>
                  {req.equipment_type && (
                    <p className="muted" style={{ margin: '2px 0', fontSize: '0.85rem' }}>
                      <strong>Type:</strong> {req.equipment_type}
                    </p>
                  )}
                  {(req.technical_requirements || req.notes) && (
                    <p style={{ margin: '4px 0', fontSize: '0.88rem' }}>
                      <strong>Technical specifications:</strong> {req.technical_requirements || req.notes}
                    </p>
                  )}
                  {(req.start_at && req.end_at) && (
                    <p className="muted" style={{ margin: '2px 0', fontSize: '0.82rem' }}>
                      <strong>Timing:</strong> {formatDateTime(req.start_at)} – {formatDateTime(req.end_at)}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p className="muted">No equipment requests submitted for this event yet.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

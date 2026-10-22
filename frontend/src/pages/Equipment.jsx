import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { ROLES } from '../constants';

/**
 * Purpose: catalogue plus reservation requests. Technical Support can check whether
 * a pending request can be fulfilled, then reserve it for that event or mark it unavailable.
 * AC: SCRUM-21 AC5, AC6, AC7; SCRUM-8 AC1, AC2 (Reserve is blocked when stock is short).
 */

/**
 * Purpose: turn a check payload into the Sufficient / Insufficient / Unavailable line.
 * AC: SCRUM-21 AC5, AC6
 * Inputs: availability payload (indication, quantities, equipment name).
 * Output: the sentence shown under the request. Empty string if there is no check.
 */
function availabilityLabel(check) {
  if (!check) return '';
  if (check.indication === 'UNAVAILABLE') {
    return `Unavailable — ${check.equipment?.name || 'this item'} is not currently available.`;
  }
  if (check.sufficient) {
    return `Sufficient — ${check.availableQuantity} free, ${check.requestedQuantity} needed.`;
  }
  return `Insufficient — ${check.availableQuantity} free, ${check.requestedQuantity} needed.`;
}

/**
 * Purpose: show the date/time the check used so Tech can see when, not only the indication.
 * AC: SCRUM-21 AC1, AC7
 * Inputs: ISO from/to. Output: locale range, or empty when the window is missing.
 */
function formatCheckWindow(from, to) {
  if (!from || !to) return '';
  return `${new Date(from).toLocaleString()} – ${new Date(to).toLocaleString()}`;
}

export default function Equipment() {
  const { hasRole } = useAuth();
  const isTech = hasRole(ROLES.TECHNICAL_SUPPORT);
  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [checks, setChecks] = useState({});
  const [form, setForm] = useState({ name: '', type: 'AUDIO', quantity: 1, location: '', status: 'AVAILABLE' });
  const [statusUpdates, setStatusUpdates] = useState({});
  const [notesUpdates, setNotesUpdates] = useState({});
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [eventSearch, setEventSearch] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  /**
   * Purpose: load availability for each pending request that names a catalogue item.
   * AC: SCRUM-21 AC7. Coordinators never call this (isTech is false).
   * Inputs: request rows. Output: none — writes checks[id] or an error message.
   */
  const loadAvailability = useCallback(async (rows) => {
    if (!isTech) return;
    const pending = (rows || []).filter((row) => row.status === 'PENDING' && row.equipment_id);
    const entries = await Promise.all(
      pending.map(async (row) => {
        try {
          const result = await api(`/api/equipment/requests/${row.id}/availability`);
          return [row.id, { ok: true, ...result }];
        } catch (err) {
          return [row.id, { ok: false, message: err.message }];
        }
      })
    );
    setChecks(Object.fromEntries(entries));
  }, [isTech]);

  /**
   * Purpose: reload catalogue + requests, then auto-check pending items for Tech.
   * AC: SCRUM-21 AC7
   */
  const reload = useCallback(async () => {
    const [eq, req] = await Promise.all([
      api('/api/equipment'),
      api('/api/equipment/requests'),
    ]);
    const rows = req.requests || [];
    setItems(eq.equipment || []);
    setRequests(rows);
    await loadAvailability(rows);
  }, [loadAvailability]);

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [reload]);

  /**
   * Purpose: confirm a reservation for this pending request's event.
   * AC: SCRUM-8 AC1, AC2. The API refuses when free stock is below the request;
   *   that message is shown and the request stays pending.
   * Inputs: request id. Output: none — reloads on success, setError on failure.
   */
  const reserveRequest = useCallback(async (requestId) => {
    try {
      setError('');
      await api(`/api/equipment/requests/${requestId}/decision`, { method: 'POST', body: { approve: true } });
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }, [reload]);

  /**
   * Purpose: Technical Support updates request status as arrangements are made.
   * AC: SCRUM-48 AC3
   */
  const handleStatusUpdate = useCallback(async (requestId, defaultStatus) => {
    try {
      setError('');
      setSuccessMsg('');
      const targetStatus = statusUpdates[requestId] || defaultStatus;
      const note = notesUpdates[requestId] !== undefined ? notesUpdates[requestId] : undefined;
      await api(`/api/equipment/requests/${requestId}`, {
        method: 'PATCH',
        body: { status: targetStatus, notes: note },
      });
      setSuccessMsg(`Request #${requestId} status updated to ${targetStatus}`);
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }, [statusUpdates, notesUpdates, reload]);

  const displayedRequests = requests.filter((req) => {
    if (statusFilter !== 'ALL' && req.status !== statusFilter) return false;
    if (eventSearch.trim()) {
      const q = eventSearch.trim().toLowerCase();
      const matchEvent = String(req.event_id).includes(q) || (req.event_name && req.event_name.toLowerCase().includes(q));
      const matchEquip = (req.equipment_name && req.equipment_name.toLowerCase().includes(q)) ||
        (req.equipment_type && req.equipment_type.toLowerCase().includes(q));
      if (!matchEvent && !matchEquip) return false;
    }
    return true;
  });

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Equipment</h1>
          <p>Lightweight catalogue plus reservation requests. Maintenance workflow is a flag for Release 1.</p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      {successMsg && <div className="alert success">{successMsg}</div>}
      <div className="cards">
        {items.map((item) => (
          <div className="card" key={item.id}>
            <p className="muted">{item.type}</p>
            <h3>{item.name}</h3>
            <p>Qty {item.quantity} · {item.location || 'Unspecified'}</p>
            <span className="pill">{item.status}</span>
          </div>
        ))}
      </div>
      {isTech && (
        <div className="card" style={{ marginTop: 18 }}>
          <h3>Add equipment</h3>
          <div className="actions">
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
            <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            <button className="btn" onClick={async () => {
              try {
                await api('/api/equipment', { method: 'POST', body: form });
                setForm({ ...form, name: '' });
                await reload();
              } catch (err) {
                setError(err.message);
              }
            }}
            >
              Save
            </button>
          </div>
        </div>
      )}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="row-between" style={{ alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Reservation requests</h3>
          {isTech && requests.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                placeholder="Search event or equipment..."
                value={eventSearch}
                onChange={(e) => setEventSearch(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '0.85rem', width: 180 }}
              />
              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '0.85rem' }}
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="PREPARING">Preparing</option>
                <option value="RESERVED">Reserved</option>
                <option value="READY">Ready</option>
                <option value="UNAVAILABLE">Unavailable</option>
              </select>
            </div>
          )}
        </div>
        {displayedRequests.map((request) => {
          const check = checks[request.id];
          const checkedWindow = check?.ok ? formatCheckWindow(check.from, check.to) : '';
          return (
            <div className="row-between" key={request.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line, rgba(255,255,255,0.06))' }}>
              <div style={{ flex: 1, paddingRight: 16 }}>
                <div>
                  {request.event_name ? `${request.event_name} (Event #${request.event_id})` : `Event #${request.event_id}`} · {request.equipment_name || request.equipment_type || 'Unspecified'} × {request.quantity}
                </div>
                <div className="muted">{request.status}</div>

                {/* SCRUM-48 AC2: Technical Support can view equipment requirements and specifications */}
                {(request.technical_requirements || request.notes) && (
                  <p style={{ margin: '4px 0', fontSize: '0.88rem' }}>
                    <strong>Requirements / Specs:</strong> {request.technical_requirements || request.notes}
                  </p>
                )}
                {request.equipment_type && (
                  <p className="muted" style={{ margin: '2px 0', fontSize: '0.84rem' }}>
                    <strong>Category:</strong> {request.equipment_type}
                  </p>
                )}
                {(request.start_at || request.event_start_at) && (
                  <p className="muted" style={{ margin: '2px 0', fontSize: '0.84rem' }}>
                    <strong>Timing:</strong> {formatCheckWindow(request.start_at || request.event_start_at, request.end_at || request.event_end_at)}
                  </p>
                )}
                {request.decision_reason && (
                  <p className="muted" style={{ margin: '2px 0', fontSize: '0.84rem' }}>
                    <strong>Arrangement note:</strong> {request.decision_reason}
                  </p>
                )}

                {isTech && request.status === 'PENDING' && check?.ok && (
                  <>
                    <p className={check.sufficient ? 'muted' : 'alert'}>{availabilityLabel(check)}</p>
                    {checkedWindow && <p className="muted">{checkedWindow}</p>}
                  </>
                )}
                {isTech && request.status === 'PENDING' && check && !check.ok && (
                  <p className="alert">{check.message}</p>
                )}

                {/* SCRUM-48 AC3: Technical Support Staff can update the request status as arrangements are made */}
                {isTech && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label htmlFor={`update-status-${request.id}`} style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600 }}>
                      Arrangement status:
                    </label>
                    <select
                      id={`update-status-${request.id}`}
                      aria-label="Arrangement status"
                      value={statusUpdates[request.id] || request.status}
                      onChange={(e) => setStatusUpdates((prev) => ({ ...prev, [request.id]: e.target.value }))}
                      style={{ padding: '3px 8px', fontSize: '0.84rem' }}
                    >
                      <option value="PENDING">Pending</option>
                      <option value="PREPARING">Preparing</option>
                      <option value="RESERVED">Reserved</option>
                      <option value="READY">Ready</option>
                      <option value="UNAVAILABLE">Unavailable</option>
                    </select>
                    <input
                      placeholder="Arrangement notes / remarks..."
                      aria-label="Arrangement note"
                      value={notesUpdates[request.id] !== undefined ? notesUpdates[request.id] : (request.decision_reason || '')}
                      onChange={(e) => setNotesUpdates((prev) => ({ ...prev, [request.id]: e.target.value }))}
                      style={{ padding: '3px 8px', fontSize: '0.84rem', minWidth: 200 }}
                    />
                    <button
                      className="btn"
                      type="button"
                      style={{ padding: '3px 10px', fontSize: '0.84rem' }}
                      onClick={() => handleStatusUpdate(request.id, request.status)}
                    >
                      Update status
                    </button>
                  </div>
                )}
              </div>
              {isTech && request.status === 'PENDING' && (
                <div className="actions" style={{ alignSelf: 'flex-start' }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => api(`/api/equipment/requests/${request.id}/availability`)
                      .then((result) => setChecks((current) => ({ ...current, [request.id]: { ok: true, ...result } })))
                      .catch((err) => setChecks((current) => ({ ...current, [request.id]: { ok: false, message: err.message } })))}
                  >
                    Check availability
                  </button>
                  <button className="btn" type="button" onClick={() => reserveRequest(request.id)}>Reserve</button>
                  <button className="btn danger" onClick={() => api(`/api/equipment/requests/${request.id}/decision`, { method: 'POST', body: { approve: false, reason: 'Insufficient stock' } }).then(reload)}>Unavailable</button>
                </div>
              )}
            </div>
          );
        })}
        {!displayedRequests.length && <p className="muted">No equipment requests yet.</p>}
      </div>
    </>
  );
}

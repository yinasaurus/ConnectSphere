import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { ROLES } from '../constants';

/**
 * Purpose: catalogue plus reservation requests. Technical Support can check whether
 * a pending request can be fulfilled at the event's date and time before they reserve.
 * AC: SCRUM-21 AC5, AC6, AC7
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

export default function Equipment() {
  const { hasRole } = useAuth();
  const isTech = hasRole(ROLES.TECHNICAL_SUPPORT);
  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [checks, setChecks] = useState({});
  const [form, setForm] = useState({ name: '', type: 'AUDIO', quantity: 1, location: '', status: 'AVAILABLE' });
  const [error, setError] = useState('');

  async function loadAvailability(rows) {
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
  }

  async function reload() {
    const [eq, req] = await Promise.all([
      api('/api/equipment'),
      api('/api/equipment/requests'),
    ]);
    const rows = req.requests || [];
    setItems(eq.equipment || []);
    setRequests(rows);
    await loadAvailability(rows);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Equipment</h1>
          <p>Lightweight catalogue plus reservation requests. Maintenance workflow is a flag for Release 1.</p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
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
        <h3>Reservation requests</h3>
        {requests.map((request) => {
          const check = checks[request.id];
          return (
            <div className="row-between" key={request.id} style={{ padding: '8px 0' }}>
              <div>
                Event #{request.event_id} · {request.equipment_name || 'Unspecified'} × {request.quantity}
                <div className="muted">{request.status}</div>
                {isTech && request.status === 'PENDING' && check?.ok && (
                  <p className={check.sufficient ? 'muted' : 'alert'}>{availabilityLabel(check)}</p>
                )}
                {isTech && request.status === 'PENDING' && check && !check.ok && (
                  <p className="alert">{check.message}</p>
                )}
              </div>
              {isTech && request.status === 'PENDING' && (
                <div className="actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => api(`/api/equipment/requests/${request.id}/availability`)
                      .then((result) => setChecks((current) => ({ ...current, [request.id]: { ok: true, ...result } })))
                      .catch((err) => setChecks((current) => ({ ...current, [request.id]: { ok: false, message: err.message } })))}
                  >
                    Check availability
                  </button>
                  <button className="btn" onClick={() => api(`/api/equipment/requests/${request.id}/decision`, { method: 'POST', body: { approve: true } }).then(reload)}>Reserve</button>
                  <button className="btn danger" onClick={() => api(`/api/equipment/requests/${request.id}/decision`, { method: 'POST', body: { approve: false, reason: 'Insufficient stock' } }).then(reload)}>Unavailable</button>
                </div>
              )}
            </div>
          );
        })}
        {!requests.length && <p className="muted">No equipment requests yet.</p>}
      </div>
    </>
  );
}

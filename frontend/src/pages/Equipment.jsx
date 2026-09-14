import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { ROLES } from '../constants';

export default function Equipment() {
  const { hasRole } = useAuth();
  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ name: '', type: 'AUDIO', quantity: 1, location: '', status: 'AVAILABLE' });
  const [error, setError] = useState('');

  async function reload() {
    const [eq, req] = await Promise.all([
      api('/api/equipment'),
      api('/api/equipment/requests'),
    ]);
    setItems(eq.equipment || []);
    setRequests(req.requests || []);
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
      {hasRole(ROLES.TECHNICAL_SUPPORT) && (
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
        {requests.map((request) => (
          <div className="row-between" key={request.id} style={{ padding: '8px 0' }}>
            <div>
              Event #{request.event_id} · {request.equipment_name || 'Unspecified'} × {request.quantity}
              <div className="muted">{request.status}</div>
            </div>
            {hasRole(ROLES.TECHNICAL_SUPPORT) && request.status === 'PENDING' && (
              <div className="actions">
                <button className="btn" onClick={() => api(`/api/equipment/requests/${request.id}/decision`, { method: 'POST', body: { approve: true } }).then(reload)}>Reserve</button>
                <button className="btn danger" onClick={() => api(`/api/equipment/requests/${request.id}/decision`, { method: 'POST', body: { approve: false, reason: 'Insufficient stock' } }).then(reload)}>Unavailable</button>
              </div>
            )}
          </div>
        ))}
        {!requests.length && <p className="muted">No equipment requests yet.</p>}
      </div>
    </>
  );
}

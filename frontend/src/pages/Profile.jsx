import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { ROLE_LABELS } from '../constants';

export default function Profile() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    fullName: user.fullName,
    phone: user.phone || '',
    communicationPreference: user.communicationPreference || 'IN_APP',
  });
  const [message, setMessage] = useState('');

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Profile</h1>
          <p>Accounts are assumed to arrive from an external identity process. This screen only updates profile fields.</p>
        </div>
      </div>
      {message && <div className="alert success">{message}</div>}
      <div className="card stack" style={{ maxWidth: 520 }}>
        <div className="roles">
          {user.roles.map((role) => <span className="pill" key={role}>{ROLE_LABELS[role]}</span>)}
        </div>
        <label>Name</label>
        <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <label>Phone</label>
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <label>Notifications</label>
        <select value={form.communicationPreference} onChange={(e) => setForm({ ...form, communicationPreference: e.target.value })}>
          <option value="IN_APP">In-app</option>
          <option value="EMAIL">Email</option>
          <option value="BOTH">Both</option>
        </select>
        <button className="btn" onClick={async () => {
          await api('/api/auth/me', { method: 'PATCH', body: form });
          setMessage('Saved. Sign in again if the header still shows the old name.');
        }}
        >
          Save
        </button>
      </div>
    </>
  );
}

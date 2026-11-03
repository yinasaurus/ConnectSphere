import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { ROLE_LABELS } from '../constants';
import Button from '../components/Button';
import AlertBanner from '../components/AlertBanner';

export default function Profile() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    fullName: user.fullName,
    phone: user.phone || '',
  });
  const [message, setMessage] = useState('');

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Profile</h1>
          <p className="single-line">Accounts are assumed to arrive from an external identity process. This screen only updates profile fields.</p>
        </div>
      </div>
      {message && <AlertBanner tone="success">{message}</AlertBanner>}
      <div className="card stack" style={{ maxWidth: 520 }}>
        <div className="roles">
          {user.roles.map((role) => <span className="pill" key={role}>{ROLE_LABELS[role]}</span>)}
        </div>
        <label>Name</label>
        <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <label>Phone</label>
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <Button  onClick={async () => {
          await api('/api/auth/me', { method: 'PATCH', body: form });
          setMessage('Saved. Sign in again if the header still shows the old name.');
        }}
        >
          Save
        </Button>
      </div>
    </>
  );
}

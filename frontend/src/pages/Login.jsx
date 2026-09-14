import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../constants';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('organiser@acme.example');
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/app" replace />;

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate('/app');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-story">
        <div className="brand-mark"><span className="logo-dot" /> ConnectSphere</div>
        <div>
          <h1>One place for every event, venue, and change.</h1>
          <p className="lede">
            Draft a request, follow it through planning, and keep venue and technical
            arrangements visible — without the spreadsheet versions.
          </p>
        </div>
        <p className="muted">IS212 · Event Planning and Venue Booking · Release 1 boilerplate</p>
      </section>
      <section className="auth-card">
        <h2>Sign in</h2>
        <p className="muted">Demo accounts all use <code>{DEMO_PASSWORD}</code>.</p>
        {error && <div className="alert">{error}</div>}
        <form onSubmit={onSubmit}>
          <label htmlFor="email">Email</label>
          <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div style={{ marginTop: 18 }}>
            <button className="btn" disabled={busy} type="submit">
              {busy ? 'Signing in…' : 'Continue'}
            </button>
          </div>
        </form>
        <div className="demo-grid">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => {
                setEmail(account.email);
                setPassword(DEMO_PASSWORD);
              }}
            >
              {account.role}
              <small>{account.email}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

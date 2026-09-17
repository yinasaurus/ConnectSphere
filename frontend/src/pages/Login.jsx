import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, homePathForRoles } from '../constants';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateLogin(email, password) {
  const fieldErrors = {};
  const trimmed = email.trim();
  if (!trimmed) fieldErrors.email = 'Email is required';
  else if (!EMAIL_PATTERN.test(trimmed)) fieldErrors.email = 'Enter a valid email address';
  if (!password) fieldErrors.password = 'Password is required';
  return fieldErrors;
}

function messageForLoginError(err) {
  if (err.code === 'NETWORK_ERROR' || err.status === 0) {
    return 'We could not reach the server. Check your connection and try again.';
  }
  if (err.status === 401 || err.code === 'INVALID_CREDENTIALS') {
    return 'Invalid email or password.';
  }
  if (err.status === 400) {
    return err.message || 'Check your email and password and try again.';
  }
  return 'Something went wrong. Please try again.';
}

export default function Login() {
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) {
    return <p className="muted session-loading">Checking session…</p>;
  }

  if (user) {
    return <Navigate to={homePathForRoles(user.roles)} replace />;
  }

  async function onSubmit(event) {
    event.preventDefault();
    const nextFieldErrors = validateLogin(email, password);
    setFieldErrors(nextFieldErrors);
    setFormError('');
    if (Object.keys(nextFieldErrors).length) return;

    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setFormError(messageForLoginError(err));
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
        {formError && <div className="alert" role="alert">{formError}</div>}
        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            aria-invalid={Boolean(fieldErrors.email)}
            className={fieldErrors.email ? 'invalid' : ''}
            disabled={busy}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldErrors((current) => ({ ...current, email: undefined }));
            }}
          />
          {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}

          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            aria-invalid={Boolean(fieldErrors.password)}
            className={fieldErrors.password ? 'invalid' : ''}
            disabled={busy}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldErrors((current) => ({ ...current, password: undefined }));
            }}
          />
          {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}

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
              disabled={busy}
              onClick={() => {
                setEmail(account.email);
                setPassword(DEMO_PASSWORD);
                setFieldErrors({});
                setFormError('');
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

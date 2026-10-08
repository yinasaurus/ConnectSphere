import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';

/**
 * Purpose: keep a screen behind login, and optionally behind one of the allowed
 * roles. A hybrid account is let through when any held role matches.
 * AC: SCRUM-54 AC2, AC3, AC4
 * Inputs: children, optional allowedRoles. Output: the page, or a redirect to
 * /app (wrong role) or / (logged out). Failure: no page content is rendered.
 */
export default function ProtectedRoute({ children, allowedRoles = [] }) {
  const { user, loading, hasRole } = useAuth();

  if (loading) {
    return <p className="muted session-loading">Restoring your session…</p>;
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (allowedRoles.length > 0 && !hasRole(...allowedRoles)) {
    return <Navigate to="/app" replace />;
  }

  return children;
}

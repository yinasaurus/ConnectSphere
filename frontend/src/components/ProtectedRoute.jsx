import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';

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

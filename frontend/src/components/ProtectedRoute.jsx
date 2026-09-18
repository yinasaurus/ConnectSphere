import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted session-loading">Restoring your session…</p>;
  if (!user) return <Navigate to="/" replace />;
  return children;
}

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api('/api/auth/me')
      .then((data) => {
        if (!cancelled) setUser(data.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    hasRole: (...roles) => Boolean(user?.roles?.some((role) => roles.includes(role))),
    async login(email, password) {
      const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      setUser(data.user);
      return data.user;
    },
    async logout() {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch {
        // Clear local session even if the network call fails.
      }
      setUser(null);
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

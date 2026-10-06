import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

const HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000;

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { admin } = useAuth();

  useEffect(() => {
    if (!admin) return;
    const tick = setInterval(() => {
      fetch('/api/health').catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(tick);
  }, [admin]);

  if (!admin) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

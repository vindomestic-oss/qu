import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useKeepAwake } from '../lib/useKeepAwake';

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { admin } = useAuth();
  useKeepAwake(Boolean(admin));

  if (!admin) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

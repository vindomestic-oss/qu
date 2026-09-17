import { Navigate } from 'react-router-dom';
import { useParticipant } from './ParticipantContext';

export function RequireParticipant({ children }: { children: React.ReactNode }) {
  const { isJoined } = useParticipant();
  if (!isJoined) return <Navigate to="/join" replace />;
  return <>{children}</>;
}

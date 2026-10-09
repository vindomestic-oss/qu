import { Navigate, useParams } from 'react-router-dom';
import { getGraderToken, getStaffToken } from '../api/graderClient';
import { useKeepAwake } from '../lib/useKeepAwake';

/**
 * Grading pages (wish 8): an admin, or a grader whose token for THIS session has not expired (the
 * server checks revocation on every request). Anyone else goes to the code entry page.
 */
export function RequireStaff({ children }: { children: React.ReactNode }) {
  const { sessionId } = useParams();
  const id = Number(sessionId);
  const staff = Number.isSafeInteger(id) ? getStaffToken(id) : null;
  useKeepAwake(staff !== null);

  if (!staff) return <Navigate to={getGraderToken(id) ? '/grade?expired=1' : '/grade'} replace />;
  return <>{children}</>;
}

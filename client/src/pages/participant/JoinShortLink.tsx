import { Navigate, useParams } from 'react-router-dom';
import { normalizeJoinCode } from '../../lib/joinLink';

/** /j/ABC234 (the QR target) → /join?code=ABC234; the join page prefills the code, nothing is submitted. */
export function JoinShortLink() {
  const { code = '' } = useParams();
  return <Navigate to={`/join?code=${encodeURIComponent(normalizeJoinCode(code))}`} replace />;
}

import { buildJoinUrl, displayHost } from '../lib/joinLink';
import { QrCard } from './QrCard';

interface Props {
  code: string;
  width: string;
  showUrl?: boolean;
  /** While joining is locked, a same-size card says so, so nobody scans a code that now fails. */
  locked?: boolean;
}

/** QR for the participant join link. Never pass grader links to this component. */
export function JoinQrCode({ code, width, showUrl, locked }: Props) {
  return (
    <div className="join-qr" style={{ width }}>
      {locked ? (
        <div className="qr-locked" style={{ width }}>
          Joining closed
        </div>
      ) : (
        <QrCard value={buildJoinUrl(code)} width={width} title="Scan to join" />
      )}
      {showUrl && !locked && (
        <p className="join-qr__url">
          <bdi dir="ltr">
            {displayHost}/j/{code}
          </bdi>
        </p>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import { formatCountdown } from '../../lib/time';
import { serverNow } from '../../lib/clock';

interface Props {
  endsAt: string;
  /** Once, when the time is up (the server ends the session; this is a client-side safety net). */
  onExpire: () => void;
  /** Once, 3 s before the end (S8 flushes unsaved text here). */
  onAlmostOver?: () => void;
}

/**
 * Owns the 1-second tick, so the question page does not re-render every second. System font with
 * tabular digits: the bundled Raleway subset has no tnum, so its digits would make the timer wobble.
 */
export function Countdown({ endsAt, onExpire, onAlmostOver }: Props) {
  const { t } = useLanguage();
  // The server's time (device clock + offset, S15), so a tablet with a wrong clock counts right.
  const [now, setNow] = useState(() => serverNow());
  const expireRef = useRef(onExpire);
  const almostRef = useRef(onAlmostOver);
  const firedRef = useRef({ expire: false, almost: false });
  useEffect(() => {
    expireRef.current = onExpire;
    almostRef.current = onAlmostOver;
  });

  useEffect(() => {
    firedRef.current = { expire: false, almost: false };
    const tick = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(tick);
  }, [endsAt]);

  const remaining = Date.parse(endsAt) - now;
  useEffect(() => {
    if (remaining <= 3000 && !firedRef.current.almost) {
      firedRef.current.almost = true;
      almostRef.current?.();
    }
    if (remaining <= 0 && !firedRef.current.expire) {
      firedRef.current.expire = true;
      expireRef.current();
    }
  }, [remaining]);

  const time = formatCountdown(endsAt, now);
  return (
    <span className="countdown" role="timer" aria-label={t('play.timeLeftAria', { time })}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 2.5M9 2h6" />
      </svg>
      <span aria-hidden="true">{time}</span>
    </span>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLiveStatus } from '../api/sessions';
import type { LiveStatusResponse } from '../types';
import { useStaffLive } from './useStaffLive';

/**
 * Live participants and per-question counts of one session, refreshed from the staff room. Owns the
 * data so each screen makes one request per event; responses that arrive out of order are dropped.
 */
export function useLiveStatus(sessionId: number | null): { data: LiveStatusResponse | null; refresh: () => void } {
  // Tagged with its session, so a switch to another session never shows the previous one's data.
  const [state, setState] = useState<{ sessionId: number; data: LiveStatusResponse } | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    if (sessionId === null) return;
    const mine = ++seq.current;
    getLiveStatus(sessionId)
      .then((result) => {
        if (mine === seq.current) setState({ sessionId, data: result });
      })
      .catch(() => {
        // non-critical live view; the next event or reconnect refetches
      });
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // session:update too: the monitor's "Reopen" buttons follow the session's state (S15).
  useStaffLive(sessionId, refresh, { events: ['session:live', 'session:update'] });
  return { data: state && state.sessionId === sessionId ? state.data : null, refresh };
}

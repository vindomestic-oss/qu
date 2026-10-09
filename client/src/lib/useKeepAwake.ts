import { useEffect } from 'react';

const HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000;

/**
 * Pings /api/health every 4 minutes while a staff screen (admin or grading panel) is open, so the
 * free Render plan does not put the server to sleep (and wipe the database) during grading.
 */
export function useKeepAwake(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => {
      fetch('/api/health').catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(tick);
  }, [active]);
}

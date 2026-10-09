import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createOrGetSession, endSession, getSession, startSession } from '../../api/sessions';
import type { QuizSession } from '../../types';
import { ApiError } from '../../api/client';
import { useStaffLive } from '../../lib/useStaffLive';
import { useLiveStatus } from '../../lib/useLiveStatus';
import { LiveMonitor } from './LiveMonitor';

interface Props {
  quizId: number;
  initialSession?: QuizSession;
  onSessionEnded?: () => void;
}

function formatCountdown(endsAt: string, now: number): string {
  const remainingMs = new Date(endsAt).getTime() - now;
  if (remainingMs <= 0) return '0:00';
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function SessionPanel({ quizId, initialSession, onSessionEnded }: Props) {
  const [session, setSession] = useState<QuizSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const onSessionEndedRef = useRef(onSessionEnded);
  onSessionEndedRef.current = onSessionEnded;

  // Restores an in-progress session after a page reload/navigation, since this
  // component otherwise starts with no memory of a session created earlier.
  useEffect(() => {
    if (initialSession && !session) setSession(initialSession);
  }, [initialSession, session]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const sessionId = session?.id ?? null;
  const live = useLiveStatus(sessionId);
  const refetchingRef = useRef(false);
  const refetchAgainRef = useRef(false);
  const seqRef = useRef(0);
  const lastStatusRef = useRef<QuizSession['status'] | null>(null);

  // Background refresh: a 401 shows the banner instead of leaving the page. A call that arrives while
  // one is in flight runs once more afterwards, and an outdated response never overwrites a newer one.
  const refetchSession = useCallback(() => {
    if (sessionId === null) return;
    if (refetchingRef.current) {
      refetchAgainRef.current = true;
      return;
    }
    const run = () => {
      refetchingRef.current = true;
      const mine = ++seqRef.current;
      getSession(sessionId, { background: true })
        .then(({ session: fresh }) => {
          if (mine === seqRef.current) setSession(fresh);
        })
        .catch(() => {
          // transient; the next event, reconnect or expiry check tries again
        })
        .finally(() => {
          refetchingRef.current = false;
          if (refetchAgainRef.current) {
            refetchAgainRef.current = false;
            run();
          }
        });
    };
    run();
  }, [sessionId]);

  // Status changes arrive in the staff room; after a reconnect the session is fetched again.
  useStaffLive(sessionId, refetchSession, { events: ['session:update'] });

  useEffect(() => {
    if (!session) return;
    if (session.status === 'ended' && lastStatusRef.current && lastStatusRef.current !== 'ended') {
      onSessionEndedRef.current?.();
    }
    lastStatusRef.current = session.status;
  }, [session]);

  // Fallback for a missed broadcast: once the countdown is over, ask the server every 3 s.
  const expired = session?.status === 'active' && session.ends_at !== null && Date.parse(session.ends_at) <= now;
  useEffect(() => {
    if (!expired) return;
    refetchSession();
    const retry = setInterval(refetchSession, 3000);
    return () => clearInterval(retry);
  }, [expired, refetchSession]);

  async function handleCreateOrShow() {
    setBusy(true);
    setError(null);
    try {
      const { session } = await createOrGetSession(quizId);
      setSession(session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create session');
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const { session: updated } = await startSession(session.id);
      seqRef.current += 1;
      setSession(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start session');
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    if (!session) return;
    if (!confirm('End this session now for all participants?')) return;
    setBusy(true);
    setError(null);
    try {
      const { session: updated } = await endSession(session.id);
      seqRef.current += 1;
      setSession(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to end session');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--border-strong)', padding: 16, marginTop: 24, background: 'var(--surface-alt)' }}>
      <h2 style={{ marginTop: 0 }}>Live Session</h2>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {!session && (
        <button onClick={handleCreateOrShow} disabled={busy}>
          Create session / get join code
        </button>
      )}

      {session && session.status === 'pending' && (
        <div>
          <p>
            Join code: <strong style={{ fontSize: 24, letterSpacing: 2 }}>{session.join_code}</strong>
          </p>
          <button onClick={handleStart} disabled={busy}>
            Start now
          </button>
          <LiveMonitor sessionId={session.id} data={live.data} onRefresh={live.refresh} />
        </div>
      )}

      {session && session.status === 'active' && (
        <div>
          <p>
            Join code: <strong style={{ fontSize: 24, letterSpacing: 2 }}>{session.join_code}</strong>
          </p>
          <p>
            Time remaining: <strong>{session.ends_at ? formatCountdown(session.ends_at, now) : '--'}</strong>
          </p>
          <button onClick={handleEnd} disabled={busy}>
            End early
          </button>{' '}
          <Link to={`/admin/sessions/${session.id}/results`}>Grade finished participants</Link>
          <LiveMonitor sessionId={session.id} data={live.data} onRefresh={live.refresh} />
        </div>
      )}

      {session && session.status === 'ended' && (
        <div>
          <p>Session ended.</p>
          <Link to={`/admin/sessions/${session.id}/results`}>View results / grade answers</Link>
          <div style={{ marginTop: 8 }}>
            <button onClick={handleCreateOrShow} disabled={busy}>
              Start a new session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createOrGetSession, endSession, getSession, setJoiningLocked, startSession } from '../../api/sessions';
import type { QuizSession } from '../../types';
import { ApiError } from '../../api/client';
import { useStaffLive } from '../../lib/useStaffLive';
import { useLiveStatus } from '../../lib/useLiveStatus';
import { LiveMonitor } from './LiveMonitor';
import { JoinLinkActions } from './JoinLinkActions';
import { GraderAccessDialog } from './GraderAccessDialog';
import { JoinQrCode } from '../JoinQrCode';
import { displayHost, formatJoinCode } from '../../lib/joinLink';
import { formatCountdown } from '../../lib/time';

interface Props {
  quizId: number;
  initialSession?: QuizSession;
  onSessionEnded?: () => void;
  /** Called after create, start, end and lock, so the editor's session history refreshes at once. */
  onSessionChanged?: () => void;
}

export function SessionPanel({ quizId, initialSession, onSessionEnded, onSessionChanged }: Props) {
  const [session, setSession] = useState<QuizSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [graderAccessOpen, setGraderAccessOpen] = useState(false);
  const onSessionEndedRef = useRef(onSessionEnded);
  const onSessionChangedRef = useRef(onSessionChanged);
  useEffect(() => {
    onSessionEndedRef.current = onSessionEnded;
    onSessionChangedRef.current = onSessionChanged;
  });

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
      onSessionChangedRef.current?.();
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
      onSessionChangedRef.current?.();
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
      onSessionChangedRef.current?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to end session');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleLock() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const { session: updated } = await setJoiningLocked(session.id, !session.joining_locked);
      setSession(updated);
      onSessionChangedRef.current?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change joining');
    } finally {
      setBusy(false);
    }
  }

  const joinedCount = live.data?.participants.length ?? 0;

  function joinBlock(s: QuizSession) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 12 }}>
        <JoinQrCode code={s.join_code} width="180px" locked={Boolean(s.joining_locked)} />
        <div>
          <div style={{ color: 'var(--text-muted)' }}>Join code</div>
          <div
            data-testid="join-code"
            data-code={s.join_code}
            style={{ fontSize: 32, fontWeight: 800, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', letterSpacing: 2 }}
          >
            <bdi dir="ltr">{formatJoinCode(s.join_code)}</bdi>
          </div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
            <bdi dir="ltr">
              {displayHost}/j/{s.join_code}
            </bdi>
          </div>
          <JoinLinkActions code={s.join_code} />
        </div>
      </div>
    );
  }

  function hostTools(s: QuizSession) {
    return (
      <>
        <button type="button" onClick={handleToggleLock} disabled={busy}>
          {s.joining_locked ? 'Unlock joining' : 'Lock joining'}
        </button>{' '}
        <Link to={`/admin/sessions/${s.id}/host`} target="_blank" rel="noopener">
          Open projector screen
        </Link>
      </>
    );
  }

  // Grading (wish 8): the panel for admins, and access links for other graders.
  function gradingTools(s: QuizSession) {
    return (
      <>
        <Link to={`/grade/${s.id}`}>Grading panel</Link>{' '}
        <button type="button" onClick={() => setGraderAccessOpen(true)}>
          Grader access
        </button>
        <GraderAccessDialog sessionId={s.id} open={graderAccessOpen} onClose={() => setGraderAccessOpen(false)} />
      </>
    );
  }

  // Names stay in a collapsed block, so they are not shown if someone projects the editor (Q-names).
  function joinedAndDetails(s: QuizSession) {
    return (
      <>
        <p style={{ fontSize: 20, fontWeight: 700 }} aria-live="polite" aria-atomic="true">
          Joined: {joinedCount}
        </p>
        <details>
          <summary style={{ cursor: 'pointer', padding: '10px 0' }}>
            Details (host only)
          </summary>
          <LiveMonitor sessionId={s.id} data={live.data} onRefresh={live.refresh} />
        </details>
      </>
    );
  }

  return (
    <div style={{ border: '1px solid var(--border-strong)', padding: 16, marginTop: 24, background: 'var(--surface-alt)' }}>
      <h2 style={{ marginTop: 0 }}>Live Session</h2>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {!session && (
        <button onClick={handleCreateOrShow} disabled={busy}>
          Start quiz (open lobby)
        </button>
      )}

      {session && session.status === 'pending' && (
        <div>
          {joinBlock(session)}
          <button onClick={handleStart} disabled={busy}>
            Start now
          </button>{' '}
          {hostTools(session)}
          {joinedAndDetails(session)}
        </div>
      )}

      {session && session.status === 'active' && (
        <div>
          {joinBlock(session)}
          <p>
            Time remaining: <strong>{session.ends_at ? formatCountdown(session.ends_at, now, session.started_at) : '--'}</strong>
          </p>
          <button onClick={handleEnd} disabled={busy}>
            End early
          </button>{' '}
          {hostTools(session)}{' '}
          {gradingTools(session)}
          {joinedAndDetails(session)}
        </div>
      )}

      {session && session.status === 'ended' && (
        <div>
          <p>Session ended.</p>
          <Link to={`/admin/sessions/${session.id}/results`}>View results</Link> {gradingTools(session)}
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

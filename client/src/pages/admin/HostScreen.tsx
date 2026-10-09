import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { endSession, getSession, setJoiningLocked, startSession } from '../../api/sessions';
import { ApiError } from '../../api/client';
import type { QuizSession, SessionQuizMeta } from '../../types';
import { useStaffLive } from '../../lib/useStaffLive';
import { useLiveStatus } from '../../lib/useLiveStatus';
import { useWakeLock } from '../../lib/useWakeLock';
import { formatCountdown } from '../../lib/time';
import { displayHost, formatJoinCode } from '../../lib/joinLink';
import { JoinQrCode } from '../../components/JoinQrCode';
import { LiveMonitor } from '../../components/admin/LiveMonitor';
import './HostScreen.css';

const STATUS_LABEL: Record<QuizSession['status'], string> = {
  pending: 'Lobby · not started',
  active: 'Live',
  ended: 'Finished',
};

/** Shown on the projector next to the QR; hard-coded on purpose (the projector is not a participant UI). */
function JoinCaption() {
  return (
    <div className="host-caption">
      <p lang="en">Scan with your camera or enter the code</p>
      <p lang="de">Mit der Kamera scannen oder Code eingeben</p>
      <p lang="ru">Наведите камеру или введите код</p>
      <p lang="he" dir="rtl">
        סרקו במצלמה או הזינו את הקוד
      </p>
    </div>
  );
}

/**
 * Projector screen for one run: lobby (QR, address, code, "Joined: N"), live (countdown) and finished.
 * Names appear only in the collapsed "Details (host only)" block (decision Q-names).
 */
export function HostScreen() {
  const { sessionId: param } = useParams();
  const sessionId = Number(param);
  const [session, setSession] = useState<QuizSession | null>(null);
  const [quiz, setQuiz] = useState<SessionQuizMeta | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [showQr, setShowQr] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const refetchingRef = useRef(false);
  useWakeLock();

  const refetch = useCallback(() => {
    if (refetchingRef.current) return;
    refetchingRef.current = true;
    getSession(sessionId)
      .then(({ session, quiz }) => {
        setSession(session);
        setQuiz(quiz);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
      })
      .finally(() => {
        refetchingRef.current = false;
      });
  }, [sessionId]);

  // Staff room first (status changes, reconnects), then the initial load.
  useStaffLive(sessionId, refetch, { events: ['session:update'] });
  useEffect(() => {
    refetch();
  }, [refetch]);
  const live = useLiveStatus(sessionId);
  const joined = live.data?.participants.length ?? 0;

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // A missed "ended" broadcast must not leave the projector at 0:00: ask every 3 s once time is up.
  const expired = session?.status === 'active' && session.ends_at !== null && Date.parse(session.ends_at) <= now;
  useEffect(() => {
    if (!expired) return;
    refetch();
    const retry = setInterval(refetch, 3000);
    return () => clearInterval(retry);
  }, [expired, refetch]);

  // Q toggles the full-screen QR (by key position, so Hebrew and Russian layouts work); Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.code === 'KeyQ' && !e.ctrlKey && !e.metaKey && !e.altKey) setShowQr((v) => !v);
      if (e.key === 'Escape') setShowQr(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  async function run(action: () => Promise<{ session: QuizSession }>) {
    setBusy(true);
    setError(null);
    try {
      const { session: updated } = await action();
      setSession(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed');
      refetch();
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (joined === 0 && !confirm('Nobody has joined yet. Start anyway?')) return;
    setBusy(true);
    setError(null);
    try {
      const { session: updated } = await startSession(sessionId);
      setSession(updated);
    } catch (err) {
      // Another admin may have started it a moment earlier: that is the outcome we wanted.
      const fresh = await getSession(sessionId).catch(() => null);
      if (fresh?.session.status === 'active') setSession(fresh.session);
      else setError(err instanceof ApiError ? err.message : 'Failed to start');
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    if (!confirm('Cancel this run? Participants in the lobby will be sent out.')) return;
    void run(() => endSession(sessionId));
  }

  function handleEnd() {
    if (!confirm('End the quiz now for all participants?')) return;
    void run(() => endSession(sessionId));
  }

  function toggleLock() {
    if (!session) return;
    void run(() => setJoiningLocked(sessionId, !session.joining_locked));
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }

  if (notFound) {
    return (
      <div className="host">
        <p>Session not found.</p>
        <Link to="/admin">Back to quizzes</Link>
      </div>
    );
  }
  if (!session || !quiz) return <p style={{ margin: 40 }}>Loading…</p>;

  const locked = Boolean(session.joining_locked);
  const code = formatJoinCode(session.join_code);
  const lockButton = (
    <button type="button" onClick={toggleLock} disabled={busy}>
      {locked ? 'Unlock joining' : 'Lock joining'}
    </button>
  );

  return (
    <div className="host">
      <header className="host-header">
        <h1>{quiz.title}</h1>
        <span className={`host-pill host-pill--${session.status}`}>{STATUS_LABEL[session.status]}</span>
        <span className="host-header__actions">
          {document.fullscreenEnabled && (
            <button type="button" onClick={toggleFullscreen}>
              {isFullscreen ? 'Exit full screen' : 'Full screen'}
            </button>
          )}
          <Link to={`/admin/quizzes/${quiz.id}`}>Back to quiz</Link>
        </span>
      </header>
      {error && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {session.status === 'pending' && (
        <main className="host-lobby">
          <JoinQrCode code={session.join_code} width="min(60vh, 45vw)" locked={locked} />
          <div className="host-lobby__info">
            <p className="host-label">Join at</p>
            <p className="host-address">
              <bdi dir="ltr">{displayHost}/join</bdi>
            </p>
            <p className="host-label">Code</p>
            <p className={locked ? 'host-code host-code--muted' : 'host-code'}>
              <bdi dir="ltr">{code}</bdi>
            </p>
            {!locked && <JoinCaption />}
            <p className="host-joined" aria-live="polite">
              Joined: {joined}
            </p>
            <div className="host-buttons">
              <button type="button" onClick={handleStart} disabled={busy}>
                Start
              </button>
              {lockButton}
              <button type="button" className="btn-outline-danger" onClick={handleCancel} disabled={busy}>
                Cancel run
              </button>
            </div>
          </div>
        </main>
      )}

      {session.status === 'active' && (
        <main className="host-live">
          <p className="host-countdown" aria-label="Time left">
            {session.ends_at ? formatCountdown(session.ends_at, now) : '--'}
          </p>
          <p className="host-joined" aria-live="polite">
            Joined: {joined}
          </p>
          <div className="host-live__join">
            <JoinQrCode code={session.join_code} width="25vh" locked={locked} />
            <p className={locked ? 'host-code-small host-code--muted' : 'host-code-small'}>
              <bdi dir="ltr">{code}</bdi>
            </p>
          </div>
          <div className="host-buttons">
            <button type="button" onClick={() => setShowQr(true)}>
              Show QR
            </button>
            {lockButton}
            <button type="button" className="btn-outline-danger" onClick={handleEnd} disabled={busy}>
              End early
            </button>
          </div>
        </main>
      )}

      {session.status === 'ended' && (
        <main className="host-ended">
          <h2>Quiz finished</h2>
          <p>
            <Link to={`/admin/sessions/${session.id}/results`}>Results &amp; grading</Link>
          </p>
          <p>
            <Link to="/admin">Back to quizzes</Link>
          </p>
        </main>
      )}

      {session.status !== 'ended' && (
        <details className="host-details">
          <summary>Details (host only)</summary>
          <LiveMonitor sessionId={session.id} data={live.data} onRefresh={live.refresh} />
        </details>
      )}

      {showQr && session.status !== 'ended' && (
        <div className="host-qr-overlay" role="dialog" aria-label="Join QR code" onClick={() => setShowQr(false)}>
          <JoinQrCode code={session.join_code} width="min(80vh, 80vw)" locked={locked} />
          <p className="host-code">
            <bdi dir="ltr">{code}</bdi>
          </p>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createOrGetSession, endSession, startSession } from '../../api/sessions';
import type { QuizSession } from '../../types';
import { ApiError } from '../../api/client';
import { getSocket } from '../../lib/socket';
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

  useEffect(() => {
    if (!session) return;
    const socket = getSocket();
    socket.emit('session:join', session.id);
    const handler = (updated: QuizSession) => {
      if (updated.id !== session.id) return;
      setSession(updated);
      if (updated.status === 'ended') onSessionEndedRef.current?.();
    };
    socket.on('session:update', handler);
    return () => {
      socket.off('session:update', handler);
    };
  }, [session?.id]);

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
      setSession(updated);
      onSessionEndedRef.current?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to end session');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: '1px solid #999', padding: 16, marginTop: 24, background: '#f7f7f7' }}>
      <h2 style={{ marginTop: 0 }}>Live Session</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}

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
          <LiveMonitor sessionId={session.id} />
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
          </button>
          <LiveMonitor sessionId={session.id} />
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

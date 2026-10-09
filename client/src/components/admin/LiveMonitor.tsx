import { useEffect, useRef, useState } from 'react';
import { allowRejoin, getLiveStatus } from '../../api/sessions';
import type { LiveStatusResponse } from '../../types';
import { getSocket, joinSessionRoom } from '../../lib/socket';

interface Props {
  sessionId: number;
}

export function LiveMonitor({ sessionId }: Props) {
  const [data, setData] = useState<LiveStatusResponse | null>(null);
  const [rejoinMessage, setRejoinMessage] = useState('');
  const [rejoinError, setRejoinError] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  async function handleAllowRejoin(participantId: number, name: string) {
    setRejoinError(null);
    try {
      await allowRejoin(sessionId, participantId);
      setRejoinMessage(`Rejoin allowed for ${name}. The next device that joins with this name gets this place.`);
      // The clicked button disappears; keep keyboard focus on the confirmation instead of the page body.
      statusRef.current?.focus();
      await refresh();
    } catch (err) {
      setRejoinError(err instanceof Error ? err.message : 'Failed to allow rejoin');
    }
  }

  async function refresh() {
    try {
      const result = await getLiveStatus(sessionId);
      setData(result);
    } catch {
      // non-critical live view; ignore transient errors
    }
  }

  useEffect(() => {
    refresh();
    const socket = getSocket();
    joinSessionRoom(sessionId, 'admin');
    const handler = () => refresh();
    socket.on('session:live', handler);
    return () => {
      socket.off('session:live', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (!data) return null;

  const totalQuestions = data.questions.length;

  return (
    <div style={{ marginTop: 12, border: '1px solid var(--border)', padding: 12, background: 'var(--surface)' }}>
      <p>
        <strong>{data.participants.length}</strong> participant(s) joined
      </p>

      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: rejoinMessage ? '0 0 8px' : 0 }}>
        {rejoinMessage}
      </p>
      {rejoinError && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {rejoinError}
        </p>
      )}
      {data.participants.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
              <th>Name</th>
              <th>Progress</th>
              <th>
                <span title="Lets this name join again from another device, without the secret stored on the first one">
                  Rejoin
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.participants.map((p) => (
              <tr key={p.id}>
                <td>{p.display_name}</td>
                <td>
                  {p.answered_count} / {totalQuestions} answered
                </td>
                <td>
                  {p.rejoin_open ? (
                    <span>Rejoin allowed</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAllowRejoin(p.id, p.display_name)}
                      aria-label={`Allow rejoin for ${p.display_name}`}
                      style={{ minHeight: 32, padding: '4px 10px', fontSize: 14 }}
                    >
                      Allow rejoin
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.questions.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
              <th>Question</th>
              <th>Answered</th>
            </tr>
          </thead>
          <tbody>
            {data.questions.map((q, i) => (
              <tr key={q.id}>
                <td>
                  Q{i + 1}: {q.text}
                </td>
                <td>
                  {q.answered_count} / {data.participants.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

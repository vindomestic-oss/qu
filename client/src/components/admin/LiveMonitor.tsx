import { useEffect, useState } from 'react';
import { allowRejoin, getLiveStatus } from '../../api/sessions';
import type { LiveStatusResponse } from '../../types';
import { getSocket, joinSessionRoom } from '../../lib/socket';

interface Props {
  sessionId: number;
}

export function LiveMonitor({ sessionId }: Props) {
  const [data, setData] = useState<LiveStatusResponse | null>(null);
  const [rejoinAllowed, setRejoinAllowed] = useState<Set<number>>(new Set());
  const [rejoinError, setRejoinError] = useState<string | null>(null);

  async function handleAllowRejoin(participantId: number) {
    setRejoinError(null);
    try {
      await allowRejoin(sessionId, participantId);
      setRejoinAllowed((prev) => new Set(prev).add(participantId));
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

      {rejoinError && <p style={{ color: 'var(--danger)' }}>{rejoinError}</p>}
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
                  {rejoinAllowed.has(p.id) ? (
                    <span role="status">Rejoin allowed</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAllowRejoin(p.id)}
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

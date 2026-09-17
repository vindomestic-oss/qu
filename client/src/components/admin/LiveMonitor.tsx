import { useEffect, useState } from 'react';
import { getLiveStatus } from '../../api/sessions';
import type { LiveStatusResponse } from '../../types';
import { getSocket } from '../../lib/socket';

interface Props {
  sessionId: number;
}

export function LiveMonitor({ sessionId }: Props) {
  const [data, setData] = useState<LiveStatusResponse | null>(null);

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
    socket.emit('session:join', sessionId);
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
    <div style={{ marginTop: 12, border: '1px solid #ccc', padding: 12, background: '#fff' }}>
      <p>
        <strong>{data.participants.length}</strong> participant(s) joined
      </p>

      {data.participants.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #999' }}>
              <th>Name</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {data.participants.map((p) => (
              <tr key={p.id}>
                <td>{p.display_name}</td>
                <td>
                  {p.answered_count} / {totalQuestions} answered
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.questions.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #999' }}>
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

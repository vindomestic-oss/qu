import { useRef, useState } from 'react';
import { allowRejoin, reopenSubmission } from '../../api/sessions';
import type { LiveParticipant, LiveStatusResponse } from '../../types';
import { formatServerTime } from '../../lib/parseServerDate';

interface Props {
  sessionId: number;
  /** Owned by the screen (useLiveStatus), so one event triggers one request per screen. */
  data: LiveStatusResponse | null;
  onRefresh: () => void;
}

export function LiveMonitor({ sessionId, data, onRefresh }: Props) {
  const [rejoinMessage, setRejoinMessage] = useState('');
  const [rejoinError, setRejoinError] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  // S15: a child who pressed Finish too early gets the questions back (their page follows at once).
  async function handleReopen(participantId: number, name: string) {
    const ok = confirm(
      `Reopen the submission of ${name}?\n\nTheir screen goes back to the questions. They can change answers until the time is up and should press Finish again (the end of the session submits them anyway). Grades already given stay; a changed answer has to be graded again.`,
    );
    if (!ok) return;
    setRejoinError(null);
    try {
      const r = await reopenSubmission(sessionId, participantId);
      setRejoinMessage(r.reopened ? `Reopened: ${name} can answer again until the time is up.` : `${name} has not submitted.`);
      statusRef.current?.focus();
      onRefresh();
    } catch (err) {
      setRejoinMessage('');
      setRejoinError(err instanceof Error ? err.message : 'Failed to reopen the submission');
    }
  }

  async function handleAllowRejoin(participantId: number, name: string) {
    setRejoinError(null);
    try {
      await allowRejoin(sessionId, participantId);
      setRejoinMessage(`Rejoin allowed: the next device that joins as ${name} gets this place.`);
      // The clicked button disappears; keep keyboard focus on the confirmation instead of the page body.
      statusRef.current?.focus();
      onRefresh();
    } catch (err) {
      setRejoinMessage('');
      setRejoinError(err instanceof Error ? err.message : 'Failed to allow rejoin');
    }
  }

  if (!data) return null;

  const totalQuestions = data.questions.length;
  const running = data.session.status === 'active';

  function submission(p: LiveParticipant) {
    if (!p.submitted_at) return <span style={{ color: 'var(--text-muted)' }}>{running ? 'Answering' : '—'}</span>;
    const label = `${p.submit_source === 'session_end' ? 'At the end' : 'Submitted'} ${formatServerTime(p.submitted_at, 'en-GB')}`;
    return (
      <span className="nowrap" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span>{label}</span>
        {running && (
          <button
            type="button"
            className="monitor-btn"
            onClick={() => handleReopen(p.id, p.display_name)}
            aria-label={`Reopen the submission of ${p.display_name}`}
            title="Lets this participant change answers again until the time is up"
          >
            Reopen
          </button>
        )}
      </span>
    );
  }

  return (
    <div style={{ marginTop: 12, border: '1px solid var(--border)', padding: 12, background: 'var(--surface)' }}>
      <p>
        <strong>{data.participants.length}</strong> participant(s) joined
      </p>

      {/* One reserved line for the confirmation or the error, so the table below never moves. */}
      <div className="monitor-message">
        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0 }}>
          {rejoinMessage}
        </p>
        {rejoinError && (
          <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>
            {rejoinError}
          </p>
        )}
      </div>
      {data.participants.length > 0 && (
        <div className="monitor-scroll">
          <table className="monitor-table">
            <colgroup>
              <col />
              <col style={{ inlineSize: '9em' }} />
              <col style={{ inlineSize: '13.5em' }} />
              <col style={{ inlineSize: '8.5em' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Name</th>
                <th>Progress</th>
                <th>Finished</th>
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
                  <td className="nowrap">
                    {p.answered_count} / {totalQuestions} answered
                  </td>
                  <td>{submission(p)}</td>
                  <td className="nowrap">
                    {p.rejoin_open ? (
                      <span>Rejoin allowed</span>
                    ) : (
                      <button
                        type="button"
                        className="monitor-btn"
                        onClick={() => handleAllowRejoin(p.id, p.display_name)}
                        aria-label={`Allow rejoin for ${p.display_name}`}
                      >
                        Allow rejoin
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

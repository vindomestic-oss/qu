import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getSessionResults, gradeAnswer } from '../../api/sessions';
import type { Question, SessionAnswer, SessionParticipant, SessionResultsResponse } from '../../types';
import { ApiError } from '../../api/client';

function computeScore(participantId: number, questions: Question[], answers: SessionAnswer[]) {
  let scored = 0;
  let max = 0;
  let pending = 0;
  for (const q of questions) {
    max += q.points;
    const a = answers.find((a) => a.participant_id === participantId && a.question_id === q.id);
    if (q.type === 'text') {
      if (a && a.points_awarded == null) pending += 1;
      else if (a) scored += a.points_awarded ?? 0;
    } else if (a) {
      scored += a.points_awarded ?? 0;
    }
  }
  return { scored, max, pending };
}

function toCsvCell(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildCsv(questions: Question[], participants: SessionParticipant[], answers: SessionAnswer[]): string {
  const header = ['Name', ...questions.map((q, i) => `Q${i + 1}: ${q.text}`), 'Score', 'Max'];
  const rows = participants.map((p) => {
    const { scored, max } = computeScore(p.id, questions, answers);
    const cells = questions.map((q) => {
      const a = answers.find((a) => a.participant_id === p.id && a.question_id === q.id);
      if (!a) return '';
      if (q.type === 'text') return a.text_answer ?? '';
      const ids: number[] = a.selected_choice_ids ? JSON.parse(a.selected_choice_ids) : [];
      return q.choices.filter((c) => ids.includes(c.id)).map((c) => c.text).join('; ');
    });
    return [p.display_name, ...cells, scored, max];
  });
  return [header, ...rows].map((row) => row.map(toCsvCell).join(',')).join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SessionResults() {
  const { sessionId } = useParams();
  const id = Number(sessionId);
  const [data, setData] = useState<SessionResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gradeInputs, setGradeInputs] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  async function refresh() {
    try {
      const result = await getSessionResults(id);
      setData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load results');
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleGrade(answer: SessionAnswer, maxPoints: number) {
    const raw = gradeInputs[answer.id];
    const points = Number(raw);
    if (!Number.isFinite(points) || points < 0 || points > maxPoints) {
      setError(`Points must be between 0 and ${maxPoints}`);
      return;
    }
    setSavingId(answer.id);
    setError(null);
    try {
      await gradeAnswer(id, answer.id, points);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save grade');
    } finally {
      setSavingId(null);
    }
  }

  if (error && !data) return <p style={{ margin: 40, color: 'red', fontFamily: 'sans-serif' }}>{error}</p>;
  if (!data) return <p style={{ margin: 40, fontFamily: 'sans-serif' }}>Loading…</p>;

  const { session, quiz, questions, participants, answers } = data;
  const textQuestions = questions.filter((q) => q.type === 'text');
  const scored = participants
    .map((p) => ({ participant: p, ...computeScore(p.id, questions, answers) }))
    .sort((a, b) => b.scored - a.scored);

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <Link to={`/admin/quizzes/${quiz.id}`}>&larr; Back to quiz</Link>
      <h1>{quiz.title} — Results</h1>
      <p>
        Session status: <strong>{session.status}</strong> · Join code: {session.join_code}
      </p>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      <button onClick={() => downloadCsv(`${quiz.title}-${session.join_code}.csv`, buildCsv(questions, participants, answers))}>
        Export CSV
      </button>

      <h2 style={{ marginTop: 32 }}>Scoreboard</h2>
      {scored.length === 0 ? (
        <p>No participants joined this session.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
              <th>Name</th>
              <th>Score</th>
              <th>Pending grading</th>
            </tr>
          </thead>
          <tbody>
            {scored.map(({ participant, scored: s, max, pending }) => (
              <tr key={participant.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td>{participant.display_name}</td>
                <td>
                  {s} / {max}
                </td>
                <td>{pending > 0 ? pending : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {textQuestions.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>Grade text answers</h2>
          {textQuestions.map((q) => {
            const questionAnswers = answers.filter((a) => a.question_id === q.id);
            return (
              <div key={q.id} style={{ marginBottom: 24 }}>
                <h3>
                  {q.text} ({q.points} pt{q.points !== 1 ? 's' : ''})
                </h3>
                {questionAnswers.length === 0 ? (
                  <p>No answers submitted.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
                        <th>Participant</th>
                        <th>Answer</th>
                        <th>Points (0–{q.points})</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {questionAnswers.map((a) => {
                        const participant = participants.find((p) => p.id === a.participant_id);
                        const currentValue = gradeInputs[a.id] ?? (a.points_awarded != null ? String(a.points_awarded) : '');
                        return (
                          <tr key={a.id} style={{ borderBottom: '1px solid #ddd' }}>
                            <td>{participant?.display_name ?? `#${a.participant_id}`}</td>
                            <td>{a.text_answer || <em>(no answer)</em>}</td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                max={q.points}
                                value={currentValue}
                                onChange={(e) => setGradeInputs((prev) => ({ ...prev, [a.id]: e.target.value }))}
                                style={{ width: 60 }}
                              />
                            </td>
                            <td>
                              <button onClick={() => handleGrade(a, q.points)} disabled={savingId === a.id}>
                                {a.graded_at ? 'Re-save' : 'Save'}
                              </button>
                              {a.graded_at && <span style={{ marginLeft: 6 }}>✓ graded</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

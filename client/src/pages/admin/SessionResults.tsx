import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getSessionResults } from '../../api/sessions';
import { getGradingSummary } from '../../api/grading';
import type { Question, SessionAnswer, SessionParticipant } from '../../types';
import { ApiError } from '../../api/client';
import { formatJoinCode } from '../../lib/joinLink';
import { useStaffLive } from '../../lib/useStaffLive';
import { useLoader } from '../../lib/useLoader';
import { GraderAccessDialog } from '../../components/admin/GraderAccessDialog';

function computeScore(participantId: number, questions: Question[], answers: SessionAnswer[]) {
  let scored = 0;
  let max = 0;
  for (const q of questions) {
    max += q.points;
    const a = answers.find((a) => a.participant_id === participantId && a.question_id === q.id);
    if (a) scored += a.points_awarded ?? 0;
  }
  return { scored, max };
}

function toCsvCell(value: unknown): string {
  let s = String(value ?? '');
  // A text that starts like a formula (=, +, -, @, tab, CR) would run in Excel or LibreOffice:
  // a leading apostrophe keeps it text. Numbers (scores) are left alone.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
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

const STATUS_TEXT = {
  not_started: 'not started',
  answering: 'still answering',
  needs_review: 'submitted — needs review',
  graded: '✓ graded',
} as const;

/**
 * Scoreboard and CSV export of one session (admin). Grading happens in the grading panel
 * (/grade/:sessionId); this page reads the same live summary, so grades show up without a reload.
 */
export function SessionResults() {
  const { sessionId } = useParams();
  const id = Number(sessionId);
  const load = useCallback(() => getGradingSummary(id), [id]);
  const { data, error: loadError, reload } = useLoader(load);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [graderAccessOpen, setGraderAccessOpen] = useState(false);
  const [joinCode, setJoinCode] = useState<string | null>(null);

  useEffect(() => {
    reload();
  }, [reload, id]);
  // Like the grading dashboard: answers and joins (session:live) at most every 5 s.
  useStaffLive(id, reload, { events: ['grading:changed', 'session:update', 'session:live'], intervals: { 'session:live': 5000 } });

  // The join code, quiz id and answers come from the admin results endpoint (also used for the CSV).
  const [quizId, setQuizId] = useState<number | null>(null);
  useEffect(() => {
    getSessionResults(id)
      .then((r) => {
        setJoinCode(r.session.join_code);
        setQuizId(r.quiz.id);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load results'));
  }, [id]);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      // Fetched at click time, so the file has the latest grades.
      const r = await getSessionResults(id);
      downloadCsv(`${r.quiz.title}-${r.session.join_code}.csv`, buildCsv(r.questions, r.participants, r.answers));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to export');
    } finally {
      setExporting(false);
    }
  }

  if (!data) {
    if (loadError || error) {
      return (
        <p role="alert" style={{ margin: 40, color: 'var(--danger)' }}>
          {error ?? 'Failed to load results'}
        </p>
      );
    }
    return <p style={{ margin: 40 }}>Loading…</p>;
  }

  const { session, quiz, counters } = data;
  const scored = [...data.participants].sort((a, b) => b.score - a.score || a.number - b.number);

  return (
    <div style={{ maxWidth: 800, margin: '16px auto', paddingInline: 16 }}>
      {quizId !== null && <Link to={`/admin/quizzes/${quizId}`}>&larr; Back to quiz</Link>}
      <h1>{quiz.title} — Results</h1>
      <p>
        Session status: <strong>{session.status}</strong>
        {joinCode && (
          <>
            {' '}
            · Join code: <bdi dir="ltr">{formatJoinCode(joinCode)}</bdi>
          </>
        )}
      </p>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button onClick={handleExport} disabled={exporting}>
          Export CSV
        </button>
        <Link to={`/grade/${id}/quiz?filter=needs_review`}>
          Grade answers{counters.needs_review > 0 ? ` (${counters.needs_review} to review)` : ''}
        </Link>
        <Link to={`/grade/${id}`}>Grading panel</Link>
        <button type="button" onClick={() => setGraderAccessOpen(true)}>
          Grader access
        </button>
      </div>
      <GraderAccessDialog sessionId={id} open={graderAccessOpen} onClose={() => setGraderAccessOpen(false)} />

      <h2 style={{ marginTop: 32 }}>Scoreboard</h2>
      {scored.length === 0 ? (
        <p>No participants joined this session.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="scoreboard">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--text)' }}>
              <th>Name</th>
              <th>Status</th>
              <th>Score</th>
              <th>Needs review</th>
            </tr>
          </thead>
          <tbody>
            {scored.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td>
                  <Link to={`/grade/${id}/participants/${p.id}`}>{p.display_name ?? `Participant ${p.number}`}</Link>
                </td>
                <td>{STATUS_TEXT[p.status]}</td>
                <td>
                  {p.score} / {p.max_score}
                </td>
                <td>{p.needs_review_count > 0 ? p.needs_review_count : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

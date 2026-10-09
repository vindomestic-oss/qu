import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { createQuiz, deleteQuiz, listQuizzes } from '../../api/quizzes';
import type { Quiz } from '../../types';
import { ApiError, downloadAdminFile } from '../../api/client';

export function AdminDashboard() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(10);
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const { quizzes } = await listQuizzes();
      setQuizzes(quizzes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load quizzes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function handleLogout() {
    logout();
    navigate('/admin/login');
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const { quiz } = await createQuiz({
        title,
        description,
        time_limit_seconds: timeLimitMinutes * 60,
      });
      setTitle('');
      setDescription('');
      setTimeLimitMinutes(10);
      navigate(`/admin/quizzes/${quiz.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create quiz');
    } finally {
      setCreating(false);
    }
  }

  async function handleDownloadBackup() {
    setBackupError(null);
    setDownloading(true);
    try {
      await downloadAdminFile('/admin/backups/latest', `quiz-backup-${new Date().toISOString().slice(0, 10)}.db`);
    } catch (err) {
      setBackupError(err instanceof ApiError ? err.message : 'Failed to download the backup');
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this quiz and all its questions?')) return;
    try {
      await deleteQuiz(id);
      setQuizzes((prev) => prev.filter((q) => q.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete quiz');
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '16px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Quizzes</h1>
        <div>
          <span style={{ marginRight: 12 }}>Logged in as {admin?.username}</span>
          <button onClick={handleLogout}>Log out</button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <h2>Create a new quiz</h2>
      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400 }}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required style={{ display: 'block', width: '100%' }} />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label>
          Time limit (minutes)
          <input
            type="number"
            min={1}
            value={timeLimitMinutes}
            onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
            required
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <button type="submit" disabled={creating} style={{ alignSelf: 'flex-start', padding: '8px 16px' }}>
          {creating ? 'Creating…' : 'Create quiz'}
        </button>
      </form>

      <h2 style={{ marginTop: 32 }}>Existing quizzes</h2>
      {loading ? (
        <p>Loading…</p>
      ) : quizzes.length === 0 ? (
        <p>No quizzes yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {quizzes.map((q) => (
            <li
              key={q.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <strong>{q.title}</strong> — {q.question_count ?? 0} question(s),{' '}
                {Math.round(q.time_limit_seconds / 60)} min
              </div>
              <div>
                <Link to={`/admin/quizzes/${q.id}`} style={{ marginRight: 12 }}>
                  Edit
                </Link>
                <button onClick={() => handleDelete(q.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 32 }}>Backup</h2>
      <p style={{ color: 'var(--text-muted)' }}>
        A copy of the whole database as it is right now. It contains participants' names and answers: store it only on
        EJKA's OneDrive.
      </p>
      <button type="button" onClick={handleDownloadBackup} disabled={downloading}>
        {downloading ? 'Preparing…' : 'Download database backup'}
      </button>
      {backupError && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          Backup failed: {backupError}
        </p>
      )}
    </div>
  );
}

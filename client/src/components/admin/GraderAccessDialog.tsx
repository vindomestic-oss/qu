import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createGraderLink, listGraderLinks, revokeGraderLink } from '../../api/grading';
import { ApiError } from '../../api/client';
import { formatServerTime } from '../../lib/parseServerDate';
import type { GraderLink } from '../../types';
import { QrCard } from '../QrCard';
import '../grader/grader.css';

interface Props {
  sessionId: number;
  open: boolean;
  onClose: () => void;
}

type Created = { code: string; url: string; label: string | null; expires_at: string };

function linkState(l: GraderLink): 'revoked' | 'expired' | 'active' {
  if (l.revoked_at) return 'revoked';
  return Date.parse(l.expires_at) <= Date.now() ? 'expired' : 'active';
}

/**
 * Admin only (English): creates grader access for one session (code, link and QR, shown once) and
 * lists and revokes the existing links. Never render this QR on the projector or in a lobby view:
 * the code opens every correct answer of the quiz.
 */
export function GraderAccessDialog({ sessionId, open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const [created, setCreated] = useState<Created | null>(null);
  const [links, setLinks] = useState<GraderLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const canCopy = typeof window !== 'undefined' && window.isSecureContext && Boolean(navigator.clipboard);

  const refreshLinks = useCallback(async () => {
    try {
      setLinks((await listGraderLinks(sessionId)).links);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load grader links');
    }
  }, [sessionId]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      void refreshLinks();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open, refreshLinks]);

  // The plain code is shown once: forget it when the dialog closes.
  function close() {
    setCreated(null);
    setCopied(false);
    setError(null);
    onClose();
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const r = await createGraderLink(sessionId, { label: label.trim() || undefined, expires_in_days: days });
      setCreated({ code: r.code, url: r.url, label: r.link.label, expires_at: r.link.expires_at });
      setLabel('');
      await refreshLinks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create grader access');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(link: GraderLink) {
    if (!confirm(`Revoke access${link.label ? ` for ${link.label}` : ''}? Open grading pages stop working at once.`)) return;
    setError(null);
    try {
      await revokeGraderLink(sessionId, link.id);
      await refreshLinks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke');
    }
  }

  async function handleCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      linkInputRef.current?.select();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="grader-dialog"
      aria-labelledby="grader-dialog-title"
      onClose={close}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="grader-dialog__head">
        <h2 id="grader-dialog-title">Grader access</h2>
        <button type="button" className="small-button" onClick={close}>
          Close
        </button>
      </div>
      <p className="grader-dialog__warning" role="note">
        <strong>Do not show this on the projector</strong> — this code reveals the correct answers.
      </p>

      <form onSubmit={handleCreate} className="grader-dialog__form">
        <label>
          For whom
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="e.g. Rav K." />
        </label>
        <label>
          Valid for
          <select value={days} onChange={(e) => setDays(Number(e.target.value) as 1 | 7 | 30)}>
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
          </select>
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create access'}
        </button>
      </form>
      <p className="grader-dialog__hint">Counted from the end of the quiz (or from now, if it has already ended).</p>

      {error && (
        <p role="alert" className="grader-dialog__error">
          {error}
        </p>
      )}

      {created && (
        <section className="grader-dialog__result" aria-label="New grader access">
          <div className="grader-dialog__qr">
            <QrCard value={created.url} width="200px" title="Grader access QR code" />
          </div>
          <div className="grader-dialog__details">
            <p>
              {created.label ? `For ${created.label}, ` : ''}valid until {formatServerTime(created.expires_at, 'en-GB')}
            </p>
            <div className="grader-dialog__code" data-testid="grader-code">
              <bdi dir="ltr">{created.code}</bdi>
            </div>
            <label className="grader-dialog__link">
              Link
              <input
                ref={linkInputRef}
                readOnly
                value={created.url}
                dir="ltr"
                data-testid="grader-link"
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
            {canCopy ? (
              <button type="button" onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            ) : (
              <p className="grader-dialog__hint">Select the link above and copy it (copying needs https).</p>
            )}
            <p className="grader-dialog__once" role="status">
              The code is shown only once. If it gets lost, create a new one and revoke the old one.
            </p>
          </div>
        </section>
      )}

      <h3 className="grader-dialog__list-title">Grader access for this session</h3>
      {links.length === 0 ? (
        <p className="grader-dialog__hint">None yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="grade-table">
            <thead>
              <tr>
                <th scope="col">For</th>
                <th scope="col">Expires</th>
                <th scope="col">Last used</th>
                <th scope="col">
                  <span className="visually-hidden">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {links.map((l) => {
                const state = linkState(l);
                return (
                  <tr key={l.id}>
                    <td>{l.label ?? `Link #${l.id}`}</td>
                    <td>{formatServerTime(l.expires_at, 'en-GB')}</td>
                    <td>{l.last_used_at ? formatServerTime(l.last_used_at, 'en-GB') : '—'}</td>
                    <td>
                      {state === 'active' ? (
                        <button
                          type="button"
                          className="btn-outline-danger small-button"
                          onClick={() => handleRevoke(l)}
                          aria-label={`Revoke access${l.label ? ` for ${l.label}` : ` link #${l.id}`}`}
                        >
                          Revoke
                        </button>
                      ) : (
                        <span>{state === 'revoked' ? 'Revoked' : 'Expired'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </dialog>
  );
}

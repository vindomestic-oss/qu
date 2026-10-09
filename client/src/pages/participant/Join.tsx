import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useParticipant } from '../../auth/ParticipantContext';
import { ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { Logo } from '../../components/Logo';
import { normalizeJoinCode } from '../../lib/joinLink';

export function Join() {
  const { join, hasRejoinSecret } = useParticipant();
  const { t } = useLanguage();
  const navigate = useNavigate();
  // /j/CODE (the QR) and /join?code=CODE prefill the code; the participant only types a name.
  const [searchParams] = useSearchParams();
  const codeFromLink = normalizeJoinCode(searchParams.get('code') ?? '');
  const [joinCode, setJoinCode] = useState(codeFromLink);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set when this device already joined this session under the typed name: ask before reusing it,
  // so a second child on a shared iPad cannot silently continue someone else's quiz.
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  async function doJoin(useSecret: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      await join(joinCode.trim().toUpperCase(), displayName.trim(), { useSecret });
      navigate('/play', { replace: true });
    } catch (err) {
      // t() returns the key itself when no dictionary has it, so an unknown code shows the generic text.
      const code = err instanceof ApiError ? err.code : undefined;
      const key = code ? `join.error.${code}` : '';
      setError(key && t(key) !== key ? t(key) : t('join.error.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setHint(null);
    if (hasRejoinSecret(joinCode, displayName)) {
      setConfirmName(displayName.trim());
      return;
    }
    await doJoin(true);
  }

  function confirmSelf() {
    setConfirmName(null);
    void doJoin(true);
  }

  function confirmSomeoneElse() {
    setConfirmName(null);
    setDisplayName('');
    setHint(t('join.rejoin.otherName'));
    nameInputRef.current?.focus();
  }

  return (
    <div style={{ maxWidth: 360, margin: '24px auto', paddingInline: 16, textAlign: 'center' }}>
      <Logo />
      <h1>{t('join.title')}</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'start' }}>
        <label>
          {t('join.joinCode')}
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(normalizeJoinCode(e.target.value))}
            required
            autoFocus={!codeFromLink}
            dir="ltr"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            style={{ display: 'block', width: '100%', textTransform: 'uppercase', fontSize: 20, letterSpacing: 2 }}
          />
        </label>
        {codeFromLink && <p className="note-success">{t('join.codeFromLink')}</p>}
        <label>
          {t('join.yourName')}
          <input
            ref={nameInputRef}
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setConfirmName(null);
            }}
            required
            maxLength={50}
            dir="auto"
            autoFocus={!!codeFromLink}
            className={codeFromLink ? 'field-highlight' : undefined}
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        {hint && <p role="status">{hint}</p>}
        {confirmName !== null && (
          <div
            role="alertdialog"
            aria-labelledby="rejoin-question"
            style={{ border: '1px solid var(--border-strong)', borderRadius: 8, padding: 12 }}
          >
            <p id="rejoin-question" style={{ marginTop: 0 }}>
              {t('join.rejoin.question', { name: confirmName })}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={confirmSelf} autoFocus>
                {t('join.rejoin.yes')}
              </button>
              <button type="button" onClick={confirmSomeoneElse}>
                {t('join.rejoin.no')}
              </button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting || confirmName !== null} style={{ padding: '8px 16px' }}>
          {submitting ? t('join.joining') : t('join.join')}
        </button>
      </form>
    </div>
  );
}

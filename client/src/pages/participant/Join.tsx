import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useParticipant } from '../../auth/ParticipantContext';
import { ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { UiLanguageMenu } from '../../components/UiLanguageMenu';
import { Logo } from '../../components/Logo';

export function Join() {
  const { join, hasRejoinSecret } = useParticipant();
  const { t, isRtl } = useLanguage();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
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
      navigate('/play');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NAME_TAKEN') setError(t('join.error.NAME_TAKEN'));
      else setError(err instanceof ApiError ? err.message : 'Failed to join');
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
    <div dir={isRtl ? 'rtl' : 'ltr'} style={{ maxWidth: 360, margin: '80px auto', textAlign: 'center' }}>
      <Logo />
      <UiLanguageMenu />
      <h1>{t('join.title')}</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: isRtl ? 'right' : 'left' }}>
        <label>
          {t('join.joinCode')}
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            required
            autoFocus
            style={{ display: 'block', width: '100%', textTransform: 'uppercase', fontSize: 20, letterSpacing: 2 }}
            maxLength={6}
          />
        </label>
        <label>
          {t('join.yourName')}
          <input
            value={displayName}
            ref={nameInputRef}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setConfirmName(null);
            }}
            required
            maxLength={50}
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        {hint && <p role="status">{hint}</p>}
        {confirmName !== null && (
          <div role="alertdialog" aria-labelledby="rejoin-question" style={{ border: '1px solid var(--border-strong)', borderRadius: 8, padding: 12 }}>
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

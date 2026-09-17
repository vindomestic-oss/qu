import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useParticipant } from '../../auth/ParticipantContext';
import { ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

export function Join() {
  const { join } = useParticipant();
  const { t, isRtl } = useLanguage();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await join(joinCode.trim().toUpperCase(), displayName.trim());
      navigate('/play');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to join');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <LanguageSwitcher />
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
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={50}
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={submitting} style={{ padding: '8px 16px' }}>
          {submitting ? t('join.joining') : t('join.join')}
        </button>
      </form>
    </div>
  );
}

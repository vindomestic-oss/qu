import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { exchangeGraderCode } from '../../api/grading';
import { setGraderToken } from '../../api/graderClient';
import { getToken, ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { Logo } from '../../components/Logo';
import '../../components/grader/grader.css';

const NAME_MAX = 40;

/** "abcd efgh…" → "ABCD-EFGH-…" as it is typed (letters and digits only, groups of four). */
function groupCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  return clean.match(/.{1,4}/g)?.join('-') ?? '';
}

/**
 * /g/:code (link or QR from the admin) and /grade (type the code): a grader enters their name and
 * gets a token for that one session. The page then replaces itself with the panel, so the code
 * leaves the address bar and the history.
 */
export function GraderEntry() {
  const { code: codeParam } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [code, setCode] = useState(() => groupCode(codeParam ?? ''));
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const expired = params.get('expired') === '1';
  const hasAdmin = Boolean(getToken());
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const title = t('grader.entry.title');

  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);

  // The button stays enabled; what is missing is said on submit, next to the field to fix.
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (code.replace(/-/g, '').length !== 16) {
      setError(t('grader.error.CODE_INCOMPLETE'));
      codeRef.current?.focus();
      return;
    }
    if (!name.trim()) {
      setError(t('grader.error.NAME_REQUIRED'));
      nameRef.current?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const r = await exchangeGraderCode(code, name.trim());
      setGraderToken(r.session_id, r.token);
      navigate(`/grade/${r.session_id}`, { replace: true });
    } catch (err) {
      const key = err instanceof ApiError && err.code ? `grader.error.${err.code}` : 'grader.error.generic';
      const text = t(key);
      setError(text === key ? t('grader.error.generic') : text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grade-entry">
      <Logo />
      <h1>{t('grader.entry.title')}</h1>
      {expired && (
        <p className="grade-banner grade-banner--warning" role="alert">
          {t('grader.entry.expired')}
        </p>
      )}
      <p className="grade-muted">{t('grader.entry.intro')}</p>
      <form onSubmit={submit} className="grade-entry__form" noValidate>
        <label className="grade-field">
          <span>{t('grader.entry.code')}</span>
          <bdi dir="ltr" className="grade-entry__code">
            <input
              ref={codeRef}
              aria-describedby="grade-entry-code-hint"
              value={code}
              onChange={(e) => setCode(groupCode(e.target.value))}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              dir="ltr"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              required
              autoFocus={!codeParam}
            />
          </bdi>
        </label>
        <small id="grade-entry-code-hint" className="grade-muted grade-entry__hint">
          {t('grader.entry.codeHint')}
        </small>
        <label className="grade-field">
          <span>{t('grader.entry.name')}</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            autoComplete="name"
            required
            autoFocus={Boolean(codeParam)}
            aria-describedby="grade-entry-name-hint"
          />
        </label>
        {/* Outside the label, so screen readers do not read it twice (it is the field's description). */}
        <small id="grade-entry-name-hint" className="grade-muted grade-entry__hint">
          {t('grader.entry.nameHint')}
        </small>
        {error && (
          <p className="grade-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="grade-entry__submit" aria-disabled={busy || undefined}>
          {busy ? t('grader.entry.submitting') : t('grader.entry.submit')}
        </button>
      </form>
      {hasAdmin && (
        <p className="grade-entry__admin">
          <Link to="/admin">{t('grader.entry.asAdmin')}</Link>
        </p>
      )}
    </div>
  );
}

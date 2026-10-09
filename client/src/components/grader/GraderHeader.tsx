import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { setGraderToken } from '../../api/graderClient';
import { useLanguage } from '../../i18n/LanguageContext';
import { formatCountdown } from '../../lib/time';
import { serverNow } from '../../lib/clock';
import type { SessionStatus } from '../../types';
import { Interpolate } from './Interpolate';

interface Props {
  sessionId: number;
  title: string;
  session: { status: SessionStatus; ends_at: string | null; started_at?: string | null };
  viewer?: { kind: 'admin' | 'grader'; name: string } | null;
  /** A link back (e.g. to the overview); none on the overview itself. */
  back?: { to: string; label: string };
  /** The page's own heading under the quiz title. */
  heading?: string;
  /** The quiz title is the page's h1 (overview). */
  titleIsHeading?: boolean;
}

/** Quiz title, session state (with the time left while it runs), who is grading, and a way back. */
export function GraderHeader({ sessionId, title, session, viewer, back, heading, titleIsHeading = false }: Props) {
  const { t } = useLanguage();
  const docTitle = t('grader.docTitle', { quiz: title });
  useEffect(() => {
    const before = document.title;
    document.title = docTitle;
    return () => {
      document.title = before;
    };
  }, [docTitle]);
  const navigate = useNavigate();
  const [now, setNow] = useState(() => serverNow());
  const running = session.status === 'active' && session.ends_at !== null;

  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(tick);
  }, [running]);

  const status =
    session.status === 'pending'
      ? t('grader.session.pending')
      : session.status === 'active'
        ? t('grader.session.active', { time: session.ends_at ? formatCountdown(session.ends_at, now, session.started_at) : '--' })
        : t('grader.session.ended');

  function signOut() {
    setGraderToken(sessionId, null);
    navigate('/grade', { replace: true });
  }

  return (
    <header className="grade-header">
      <div className="grade-header__nav">
        {back && (
          <Link to={back.to} className="grade-header__back">
            {back.label}
          </Link>
        )}
        {viewer?.kind === 'admin' && (
          <Link to="/admin" className="grade-header__back">
            {t('grader.header.admin')}
          </Link>
        )}
      </div>
      <div className="grade-header__main">
        <div>
          {titleIsHeading ? (
            <h1 className="grade-header__quiz">
              <bdi>{title}</bdi>
            </h1>
          ) : (
            <p className="grade-header__quiz">
              <bdi>{title}</bdi>
            </p>
          )}
          {heading && <h1 className="grade-header__title">{heading}</h1>}
        </div>
        <div className="grade-header__meta">
          <span className={`grade-header__status grade-header__status--${session.status}`}>{status}</span>
          {viewer && (
            <span className="grade-header__viewer">
              <Interpolate
                template={t('grader.header.gradingAs')}
                values={{ name: <bdi>{viewer.kind === 'admin' ? `${viewer.name} (${t('grader.row.admin')})` : viewer.name}</bdi> }}
              />
            </span>
          )}
          {viewer?.kind === 'grader' && (
            <button type="button" className="small-button" onClick={signOut}>
              {t('grader.header.signOut')}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

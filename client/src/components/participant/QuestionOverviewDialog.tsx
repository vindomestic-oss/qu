import { useEffect, useRef, useState } from 'react';
import type { ParticipantQuestion } from '../../types';
import type { QuizLang } from '../../i18n/contentLanguages';
import { useLanguage } from '../../i18n/LanguageContext';
import { resolveFieldWithLang } from '../../i18n/resolveText';
import { isAnswered } from '../../lib/answered';
import type { NavGroup } from '../../lib/navGroups';
import { sectionStyle, useNavItemLabel } from '../../lib/navLabels';

type Filter = 'all' | 'unanswered' | 'flagged';

interface Props {
  open: boolean;
  questions: ParticipantQuestion[];
  groups: NavGroup[];
  currentIndex: number;
  flagged: Set<number>;
  contentLanguage: QuizLang;
  base: QuizLang;
  onSelect: (index: number) => void;
  onClose: () => void;
  /** Saves every draft and waits for all saves; resolves false if one failed. */
  onFinish: () => Promise<'ok' | 'save-failed' | 'error'>;
}

/**
 * "All questions": the full grid with counters and filters, and the finish step (this dialog is the
 * confirmation; there is no second one). Native <dialog>: Esc and a backdrop click close it.
 */
export function QuestionOverviewDialog({ open, questions, groups, currentIndex, flagged, contentLanguage, base, onSelect, onClose, onFinish }: Props) {
  const { t } = useLanguage();
  const itemLabel = useNavItemLabel();
  const ref = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const total = questions.length;
  const answered = questions.filter(isAnswered).length;
  const unansweredNumbers = questions.map((q, i) => (isAnswered(q) ? null : i + 1)).filter((n): n is number => n !== null);
  const flaggedCount = questions.filter((q) => flagged.has(q.id)).length;
  const visible = (q: ParticipantQuestion) =>
    filter === 'all' || (filter === 'unanswered' ? !isAnswered(q) : flagged.has(q.id));

  async function finish() {
    setBusy(true);
    setFailed(null);
    const result = await onFinish();
    setBusy(false);
    if (result === 'save-failed') setFailed(t('play.saveFailed'));
    else if (result === 'error') setFailed(t('play.finishFailed'));
  }

  return (
    <dialog
      ref={ref}
      className="qoverview"
      aria-labelledby="qoverview-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="qoverview__inner">
          <div className="qoverview__head">
            <h2 id="qoverview-title">{t('play.overview.title')}</h2>
            <button type="button" className="qoverview__close" onClick={onClose}>
              {t('play.overview.close')}
            </button>
          </div>
          <p className="qoverview__summary">
            {t('play.overview.summary', { answered, unanswered: total - answered, flagged: flaggedCount })}
          </p>
          <p className="qoverview__legend">
            <span className="legend-swatch legend-swatch--answered" aria-hidden="true" /> {t('play.nav.answered')} ·{' '}
            <span className="legend-swatch" aria-hidden="true" /> {t('play.nav.unanswered')} ·{' '}
            <span className="legend-swatch legend-swatch--flagged" aria-hidden="true" /> {t('play.nav.flagged')} ·{' '}
            <span className="legend-swatch legend-swatch--current" aria-hidden="true" /> {t('play.nav.current')}
          </p>
          <div className="qoverview__filters" role="group">
            {(['all', 'unanswered', 'flagged'] as Filter[]).map((f) => (
              <button key={f} type="button" className="toggle-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all'
                  ? t('play.overview.filterAll')
                  : f === 'unanswered'
                    ? `${t('play.overview.filterUnanswered')} (${total - answered})`
                    : `${t('play.overview.filterFlagged')} (${flaggedCount})`}
              </button>
            ))}
          </div>
          {groups.map((g) => {
            const items = questions.slice(g.startIndex, g.endIndex + 1).map((q, k) => ({ q, i: g.startIndex + k })).filter(({ q }) => visible(q));
            if (!items.length) return null;
            const name = g.section ? resolveFieldWithLang(g.section, 'name', contentLanguage, base) : null;
            const open_ = questions.slice(g.startIndex, g.endIndex + 1).filter((q) => !isAnswered(q)).length;
            return (
              <section key={g.key} className="qoverview__group" style={sectionStyle(g.colorIndex)}>
                <h3>
                  {g.colorIndex > 0 && <span className="qnav-band qoverview__band" aria-hidden="true" />}
                  {name && <span lang={name.lang}>{name.text} </span>}
                  <span className="qoverview__range">
                    {g.startIndex + 1}–{g.endIndex + 1} ·{' '}
                    {open_ > 0 ? t('play.overview.groupUnanswered', { k: open_ }) : t('play.overview.groupAllAnswered')}
                  </span>
                </h3>
                <ol className="qoverview__grid">
                  {items.map(({ q, i }) => {
                    const done = isAnswered(q);
                    return (
                      <li key={q.id}>
                        <button
                          type="button"
                          className="qnav-item"
                          data-state={done ? 'answered' : 'unanswered'}
                          data-flagged={flagged.has(q.id) || undefined}
                          aria-current={i === currentIndex ? 'step' : undefined}
                          aria-label={itemLabel(i + 1, total, name?.text ?? null, done, flagged.has(q.id))}
                          onClick={() => {
                            onClose();
                            onSelect(i);
                          }}
                        >
                          {i + 1}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
          <div className="qoverview__footer">
            {unansweredNumbers.length > 0 && (
              <div className="warn">
                <p>{t('play.unansweredList', { list: unansweredNumbers.join(', ') })}</p>
                <p>{t('play.unansweredHint')}</p>
              </div>
            )}
            <p>{t('play.finishConfirmBody')}</p>
            {failed && (
              <p role="alert" className="qoverview__error">
                {failed}
              </p>
            )}
            <div className="qoverview__actions">
              <button type="button" autoFocus onClick={onClose} disabled={busy}>
                {t('play.overview.back')}
              </button>
              <button type="button" className="btn-finish" onClick={finish} disabled={busy}>
                {busy ? t('play.finishing') : t('play.finish')}
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ParticipantQuestion } from '../../types';
import type { QuizLang } from '../../i18n/contentLanguages';
import { useLanguage } from '../../i18n/LanguageContext';
import { resolveFieldWithLang } from '../../i18n/resolveText';
import { isAnswered } from '../../lib/answered';
import type { NavGroup } from '../../lib/navGroups';
import { sectionStyle, useNavItemLabel } from '../../lib/navLabels';

interface Props {
  questions: ParticipantQuestion[];
  groups: NavGroup[];
  currentIndex: number;
  flagged: Set<number>;
  contentLanguage: QuizLang;
  base: QuizLang;
  onSelect: (index: number) => void;
  onOpenOverview: () => void;
}

/** Scroll-arrow chevron. Drawn pointing back/forward in LTR; play.css mirrors it in RTL, so both
 *  arrows always point outward (a text ‹ › would be mirrored by the bidi algorithm on top). */
function Chevron({ back }: { back?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={back ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

/** Grid icon of the "All questions" button; on a phone it stands in for the hidden label. */
function GridIcon() {
  return (
    <svg className="qnav-all__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </svg>
  );
}

/**
 * One-line strip of all question numbers above the card (wish 10). States by shape: filled = saved
 * answer, outline = none, ring + triangle = current, red corner = marked. One Tab stop (roving
 * tabindex); arrow keys move along the strip and mirror in RTL.
 */
export function QuestionNavigator({ questions, groups, currentIndex, flagged, contentLanguage, base, onSelect, onOpenOverview }: Props) {
  const { t, isRtl } = useLanguage();
  const itemLabel = useNavItemLabel();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });
  const total = questions.length;
  const answeredCount = questions.filter(isAnswered).length;

  function updateEdges() {
    const el = scrollerRef.current;
    if (!el) return;
    // scrollLeft is negative in RTL (Chromium/WebKit), so compare magnitudes.
    const pos = Math.abs(el.scrollLeft);
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ atStart: pos <= 1, atEnd: pos >= max - 1 });
  }

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateEdges, { passive: true });
    window.addEventListener('resize', updateEdges);
    return () => {
      el.removeEventListener('scroll', updateEdges);
      window.removeEventListener('resize', updateEdges);
    };
  }, []);

  // Keep the current number in view (the page itself was already scrolled to the top by Play).
  useLayoutEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    itemRefs.current[currentIndex]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    // eslint-disable-next-line react/set-state-in-effect -- measuring the scroller needs an effect
    updateEdges();
  }, [currentIndex]);

  function scrollByPage(direction: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * (isRtl ? -1 : 1) * 0.8 * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
  }

  function onKeyDown(e: KeyboardEvent, i: number) {
    const forward = isRtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = isRtl ? 'ArrowRight' : 'ArrowLeft';
    let target: number | null = null;
    if (e.key === forward) target = Math.min(i + 1, total - 1);
    else if (e.key === backward) target = Math.max(i - 1, 0);
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = total - 1;
    if (target === null) return;
    e.preventDefault();
    itemRefs.current[target]?.focus();
  }

  // Roving tabindex: the strip is one Tab stop. While focus is inside, the focused number holds it;
  // when focus leaves, the current question's number takes it back.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const tabStop = focusIndex ?? currentIndex;

  // At an end the arrow stays focusable (aria-disabled, the click is ignored): a disabled button
  // would drop keyboard focus to the page. When the whole strip fits, both arrows are hidden but keep
  // their space, so nothing moves.
  return (
    <nav className="qnav" aria-label={t('play.nav.label')} data-fits={(edges.atStart && edges.atEnd) || undefined}>
      <button
        type="button"
        className="qnav-arrow"
        aria-label={t('play.nav.scrollBack')}
        aria-disabled={edges.atStart}
        onClick={() => {
          if (!edges.atStart) scrollByPage(-1);
        }}
      >
        <Chevron back />
      </button>
      <div
        className="qnav-scroller"
        data-testid="question-nav"
        ref={scrollerRef}
        data-at-start={edges.atStart || undefined}
        data-at-end={edges.atEnd || undefined}
        onBlur={(e) => {
          if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setFocusIndex(null);
        }}
      >
        {groups.map((g) => {
          const name = g.section ? resolveFieldWithLang(g.section, 'name', contentLanguage, base) : null;
          // A run without a rubric has no name, so it is no group either (the nav already says "Questions").
          return (
            <div key={g.key} className="qnav-group" role={name ? 'group' : undefined} aria-label={name?.text} style={sectionStyle(g.colorIndex)}>
              {name && (
                <span className="qnav-group-label" aria-hidden="true" lang={name.lang} title={name.text}>
                  {name.text}
                </span>
              )}
              {g.colorIndex > 0 && <span className="qnav-band" aria-hidden="true" />}
              <ol className="qnav-list">
                {questions.slice(g.startIndex, g.endIndex + 1).map((q, k) => {
                  const i = g.startIndex + k;
                  const answered = isAnswered(q);
                  return (
                    <li key={q.id}>
                      <button
                        type="button"
                        ref={(el) => {
                          itemRefs.current[i] = el;
                        }}
                        className="qnav-item"
                        data-state={answered ? 'answered' : 'unanswered'}
                        data-flagged={flagged.has(q.id) || undefined}
                        data-testid={`nav-item-${i + 1}`}
                        aria-current={i === currentIndex ? 'step' : undefined}
                        aria-label={itemLabel(i + 1, total, name?.text ?? null, answered, flagged.has(q.id))}
                        tabIndex={i === tabStop ? 0 : -1}
                        onFocus={() => setFocusIndex(i)}
                        onKeyDown={(e) => onKeyDown(e, i)}
                        onClick={() => onSelect(i)}
                      >
                        {i + 1}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="qnav-arrow"
        aria-label={t('play.nav.scrollForward')}
        aria-disabled={edges.atEnd}
        onClick={() => {
          if (!edges.atEnd) scrollByPage(1);
        }}
      >
        <Chevron />
      </button>
      <button type="button" className="qnav-all" aria-haspopup="dialog" onClick={onOpenOverview}>
        <GridIcon />
        <span className="qnav-all__label">{t('play.nav.all')}</span>{' '}
        {/* The hidden "50/50" reserves the widest count, so the button keeps its width at 10/50. */}
        <span className="qnav-all__count">
          <span>{t('play.nav.answeredCount', { answered: answeredCount, total })}</span>
          <span className="is-hidden" aria-hidden="true">
            {t('play.nav.answeredCount', { answered: total, total })}
          </span>
        </span>
      </button>
    </nav>
  );
}

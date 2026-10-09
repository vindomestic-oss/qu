import { useLayoutEffect, useRef, useState } from 'react';
import type { QuizLang } from '../../i18n/contentLanguages';
import { useLanguage } from '../../i18n/LanguageContext';
import { dirOf } from '../../i18n/languageMeta';
import { resolveFieldWithLang } from '../../i18n/resolveText';
import type { NavGroup } from '../../lib/navGroups';
import { sectionStyle } from '../../lib/navLabels';

interface Props {
  groups: NavGroup[];
  /** The question on screen (0-based). */
  index: number;
  /** The quiz's offered languages: the cell is reserved for the rubric names in all of them. */
  languages: QuizLang[];
  contentLanguage: QuizLang;
  base: QuizLang;
}

/**
 * The rubric of the question on screen, under "Question n of N" in the card head (wish 10): the
 * colour of its group in the strip plus its name in the question language. Hidden copies of every
 * rubric name in every offered language share its grid cell (as LangStack does for question texts),
 * so the cell keeps one width on every question and in every question language, and nothing in the
 * head moves. When the counter itself needs two lines (a narrow phone with the language chips) the
 * line is left out, so the head stays 44 px; the strip's label still names the rubric. A quiz without
 * rubrics shows nothing; a question without one keeps an empty line, so the counter stays in place.
 */
export function RubricBadge({ groups, index, languages, contentLanguage, base }: Props) {
  const { t } = useLanguage();
  const lineRef = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);

  // The counter wraps only for lack of room in the row; the rubric line never changes that room
  // (the cell shrinks to what is left either way), so this never flips back and forth.
  useLayoutEffect(() => {
    const reserve = lineRef.current?.parentElement?.querySelector<HTMLElement>(':scope > .is-hidden');
    if (!reserve) return;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(reserve).lineHeight) || 18;
      setCompact(reserve.getBoundingClientRect().height > lineHeight * 1.5);
    };
    // eslint-disable-next-line react/set-state-in-effect -- measuring the counter needs an effect
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(reserve);
    return () => observer.disconnect();
  }, []);

  const names = new Map<string, { text: string; lang: QuizLang }>();
  for (const g of groups) {
    if (!g.section) continue;
    for (const l of [contentLanguage, ...languages]) {
      const name = resolveFieldWithLang(g.section, 'name', l, base);
      if (!names.has(name.text)) names.set(name.text, name);
    }
  }
  if (names.size === 0) return null;
  const group = groups.find((g) => index >= g.startIndex && index <= g.endIndex);
  const name = group?.section ? resolveFieldWithLang(group.section, 'name', contentLanguage, base) : null;
  const hidden = compact ? ' is-off' : '';
  return (
    <>
      {[...names.values()].map((n) => (
        <span key={n.text} className={`qcard-rubric is-ghost${hidden}`} aria-hidden="true">
          <span className="qcard-rubric__name" lang={n.lang} dir={dirOf(n.lang)}>
            {n.text}
          </span>
        </span>
      ))}
      {group?.section && name ? (
        <span
          ref={lineRef}
          className={`qcard-rubric${hidden}`}
          data-testid="rubric-badge"
          style={sectionStyle(group.colorIndex)}
          title={name.text}
        >
          <span className="visually-hidden">{t('play.rubric')}: </span>
          <span className="qcard-rubric__name" lang={name.lang} dir={dirOf(name.lang)}>
            {name.text}
          </span>
        </span>
      ) : (
        <span ref={lineRef} className={`qcard-rubric${hidden}`} aria-hidden="true" />
      )}
    </>
  );
}

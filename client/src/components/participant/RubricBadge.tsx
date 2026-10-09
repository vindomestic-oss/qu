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
  contentLanguage: QuizLang;
  base: QuizLang;
}

/**
 * The rubric of the question on screen, under "Question n of N" in the card head (wish 10): the
 * colour of its group in the strip plus its name in the question language. Hidden copies of every
 * rubric name (in this language) share its grid cell, so the cell is as wide as the longest name on
 * every question and the flag beside it never moves. A quiz without rubrics shows nothing; in a quiz
 * with rubrics a question without one keeps an empty line, so the counter stays in place too.
 */
export function RubricBadge({ groups, index, contentLanguage, base }: Props) {
  const { t } = useLanguage();
  const names = new Map<string, { text: string; lang: QuizLang }>();
  for (const g of groups) {
    if (!g.section) continue;
    const name = resolveFieldWithLang(g.section, 'name', contentLanguage, base);
    names.set(name.text, name);
  }
  if (names.size === 0) return null;
  const group = groups.find((g) => index >= g.startIndex && index <= g.endIndex);
  const name = group?.section ? resolveFieldWithLang(group.section, 'name', contentLanguage, base) : null;
  return (
    <>
      {[...names.values()].map((n) => (
        <span key={n.text} className="qcard-rubric is-ghost" aria-hidden="true">
          <span className="qcard-rubric__name" lang={n.lang} dir={dirOf(n.lang)}>
            {n.text}
          </span>
        </span>
      ))}
      {group?.section && name ? (
        <span className="qcard-rubric" data-testid="rubric-badge" style={sectionStyle(group.colorIndex)} title={name.text}>
          <span className="visually-hidden">{t('play.rubric')}: </span>
          <span className="qcard-rubric__name" lang={name.lang} dir={dirOf(name.lang)}>
            {name.text}
          </span>
        </span>
      ) : (
        <span className="qcard-rubric" aria-hidden="true" />
      )}
    </>
  );
}

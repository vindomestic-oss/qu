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
 * colour of its group in the strip plus its name in the question language. A quiz without rubrics
 * shows nothing; in a quiz with rubrics a question without one keeps an empty line, so the counter
 * never moves between questions.
 */
export function RubricBadge({ groups, index, contentLanguage, base }: Props) {
  const { t } = useLanguage();
  if (!groups.some((g) => g.section)) return null;
  const group = groups.find((g) => index >= g.startIndex && index <= g.endIndex);
  if (!group?.section) return <span className="qcard-rubric" aria-hidden="true" />;
  const name = resolveFieldWithLang(group.section, 'name', contentLanguage, base);
  return (
    <span className="qcard-rubric" data-testid="rubric-badge" style={sectionStyle(group.colorIndex)} title={name.text}>
      <span className="visually-hidden">{t('play.rubric')}: </span>
      <span className="qcard-rubric__name" lang={name.lang} dir={dirOf(name.lang)}>
        {name.text}
      </span>
    </span>
  );
}

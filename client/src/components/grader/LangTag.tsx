import { useLanguage } from '../../i18n/LanguageContext';
import { localizedLanguageName } from '../../i18n/languageMeta';
import { isQuizLang, type QuizLang } from '../../i18n/contentLanguages';

/**
 * The language of one answer or of a group of identical answers (wish 8, S15): "DE", "RU · DE". Shown
 * when the quiz is offered in more than one language, or when an answer is not in the quiz's base
 * language (a Russian answer in a German-only quiz); nothing otherwise. The code is spoken as the
 * language's name.
 */
export function LangTag({ langs, base, offered }: { langs: (string | null | undefined)[]; base: QuizLang; offered: QuizLang[] }) {
  const { t, uiLanguage } = useLanguage();
  const known = [...new Set(langs.filter((l): l is QuizLang => isQuizLang(l)))];
  if (known.length === 0) return null;
  if (offered.length < 2 && known.every((l) => l === base)) return null;
  const names = known.map((l) => localizedLanguageName(l, uiLanguage)).join(', ');
  return (
    <span className="lang-tag" title={t('grader.lang.tag', { lang: names })} data-testid="lang-tag">
      <span aria-hidden="true" dir="ltr">
        {known.map((l) => l.toUpperCase()).join(' · ')}
      </span>
      <span className="visually-hidden">{t('grader.lang.tag', { lang: names })}</span>
    </span>
  );
}

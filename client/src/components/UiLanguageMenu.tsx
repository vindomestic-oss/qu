import { useLanguage } from '../i18n/LanguageContext';
import { UI_LANGUAGES } from '../i18n/translations';
import { LanguageMenu } from './LanguageMenu';

/** Interface language picker: exactly en, de, he, ru. The trigger's name is its visible endonym (WCAG 2.5.3). */
export function UiLanguageMenu() {
  const { uiLanguage, setUiLanguage, t } = useLanguage();
  return (
    <nav aria-label={t('lang.uiMenuLabel')} className="lang-menu-bar">
      <LanguageMenu idPrefix="ui-lang" options={UI_LANGUAGES} value={uiLanguage} onChange={setUiLanguage} icon="globe" />
    </nav>
  );
}

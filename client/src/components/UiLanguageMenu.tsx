import { useLanguage } from '../i18n/LanguageContext';
import { LANGUAGES, UI_LANGUAGES, type Language } from '../i18n/translations';

const OPTIONS = LANGUAGES.filter((l) => UI_LANGUAGES.includes(l.code));

/** Interface (menu/button) language picker — restricted to the 4 fully-translated languages. */
export function UiLanguageMenu() {
  const { language, setLanguage } = useLanguage();

  return (
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as Language)}
      aria-label="Interface language"
      style={{ padding: '4px 8px', fontSize: 14 }}
    >
      {OPTIONS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

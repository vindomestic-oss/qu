import { useLanguage } from '../i18n/LanguageContext';
import { LANGUAGES } from '../i18n/translations';

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLanguage(l.code)}
          aria-pressed={l.code === language}
          style={{
            padding: '4px 10px',
            fontWeight: l.code === language ? 'bold' : 'normal',
            background: l.code === language ? '#e0e0e0' : undefined,
          }}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

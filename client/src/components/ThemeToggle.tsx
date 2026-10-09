import { useLanguage } from '../i18n/LanguageContext';
import { useTheme } from '../theme/useTheme';

// Inline SVGs instead of ☀/☾: iPadOS Safari may draw ☀ as a colour emoji that ignores the theme.
function SunIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 1.5a1 1 0 0 1 1 1V4a1 1 0 1 1-2 0V2.5a1 1 0 0 1 1-1Zm0 17.5a1 1 0 0 1 1 1v1.5a1 1 0 1 1-2 0V20a1 1 0 0 1 1-1ZM1.5 12a1 1 0 0 1 1-1H4a1 1 0 1 1 0 2H2.5a1 1 0 0 1-1-1Zm17.5 0a1 1 0 0 1 1-1h1.5a1 1 0 1 1 0 2H20a1 1 0 0 1-1-1ZM4.22 4.22a1 1 0 0 1 1.42 0l1.06 1.06a1 1 0 0 1-1.42 1.42L4.22 5.64a1 1 0 0 1 0-1.42Zm13.08 13.08a1 1 0 0 1 1.42 0l1.06 1.06a1 1 0 0 1-1.42 1.42l-1.06-1.06a1 1 0 0 1 0-1.42ZM4.22 19.78a1 1 0 0 1 0-1.42l1.06-1.06a1 1 0 1 1 1.42 1.42l-1.06 1.06a1 1 0 0 1-1.42 0ZM17.3 6.7a1 1 0 0 1 0-1.42l1.06-1.06a1 1 0 1 1 1.42 1.42L18.72 6.7a1 1 0 0 1-1.42 0Z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a.75.75 0 0 0-.98-.94A10 10 0 1 0 21.44 15.6a.75.75 0 0 0-.94-1Z" />
    </svg>
  );
}

export function ThemeToggle() {
  const { t } = useLanguage();
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark');

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={label} title={label}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

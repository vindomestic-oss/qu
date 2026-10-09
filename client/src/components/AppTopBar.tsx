import { useLocation } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { ThemeToggle } from './ThemeToggle';

/** The only global bar: in normal flow, so it never covers page buttons. Flips to the left in RTL. */
export function AppTopBar() {
  const { isRtl } = useLanguage();
  const isAdmin = useLocation().pathname.startsWith('/admin');
  return (
    <header className="app-topbar" dir={!isAdmin && isRtl ? 'rtl' : 'ltr'}>
      <ThemeToggle />
    </header>
  );
}

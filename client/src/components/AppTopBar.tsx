import { useLocation } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { ThemeToggle } from './ThemeToggle';
import { UiLanguageMenu } from './UiLanguageMenu';

// Participant and grader pages; never /admin/** (English only).
const UI_MENU_PATHS = ['/', '/join', '/play', '/results', '/grade'];

/** The only global bar: in normal flow, so it never covers page buttons. <html dir> flips it in Hebrew. */
export function AppTopBar() {
  const { uiLanguageLocked } = useLanguage();
  const { pathname } = useLocation();
  const showUiMenu =
    !uiLanguageLocked && (UI_MENU_PATHS.includes(pathname) || pathname.startsWith('/grade/') || pathname.startsWith('/g/'));
  // During the quiz /play draws its own header (title, timer, theme toggle): never two bars.
  if (pathname === '/play' && uiLanguageLocked) return null;
  return (
    <header className="app-topbar">
      {showUiMenu && <UiLanguageMenu />}
      <ThemeToggle />
    </header>
  );
}

import { useMemo, useState } from 'react';
import type { Language } from './translations';
import { isQuizLang } from './contentLanguages';
import { useLanguage } from './LanguageContext';

const STORAGE_KEY = 'quiz_content_language';

/**
 * The language a quiz's questions are shown in — independent of the interface (menu) language,
 * and restricted to the languages this specific quiz actually offers. Defaults to the interface
 * language when the quiz offers it, else the quiz's own base language. Scoped per tab, like the
 * participant's join token, so it resets for the next participant on a shared device.
 */
export function useContentLanguage(offered: Language[]): {
  contentLanguage: Language;
  setContentLanguage: (lang: Language) => void;
} {
  const { language: uiLanguage } = useLanguage();
  const [stored, setStored] = useState<Language | null>(() => {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return isQuizLang(v) ? v : null;
  });

  const contentLanguage = useMemo(() => {
    if (stored && offered.includes(stored)) return stored;
    if (offered.includes(uiLanguage)) return uiLanguage;
    return offered[0] ?? 'en';
  }, [stored, uiLanguage, offered]);

  function setContentLanguage(lang: Language) {
    sessionStorage.setItem(STORAGE_KEY, lang);
    setStored(lang);
  }

  return { contentLanguage, setContentLanguage };
}

export function clearStoredContentLanguage(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

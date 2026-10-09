import { useMemo, useState } from 'react';
import { isQuizLang, type QuizLang } from './contentLanguages';
import { useLanguage } from './LanguageContext';

const STORAGE_KEY = 'quiz_content_language';

function readStored(): QuizLang | null {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return isQuizLang(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * The language a quiz's questions are shown in: independent of the interface language and limited
 * to the languages this quiz offers. Resolution: the participant's explicit pick (per tab), else the
 * interface language if offered, else the quiz's base (offered[0]). Until a pick it follows UI
 * language changes in the waiting room. Call it once, at the top of Play / Results.
 */
export function useContentLanguage(offered: QuizLang[] | null): {
  contentLanguage: QuizLang;
  base: QuizLang;
  setContentLanguage: (lang: QuizLang) => void;
} {
  const { uiLanguage } = useLanguage();
  const [stored, setStored] = useState<QuizLang | null>(readStored);

  const base: QuizLang = offered?.[0] ?? 'en';
  const contentLanguage = useMemo<QuizLang>(() => {
    if (!offered) return 'en';
    if (stored && offered.includes(stored)) return stored;
    if (offered.includes(uiLanguage)) return uiLanguage;
    return offered[0] ?? 'en';
  }, [stored, uiLanguage, offered]);

  function setContentLanguage(lang: QuizLang) {
    try {
      sessionStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // storage blocked: the pick applies until reload
    }
    setStored(lang);
  }

  return { contentLanguage, base, setContentLanguage };
}

export function clearStoredContentLanguage(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked
  }
}

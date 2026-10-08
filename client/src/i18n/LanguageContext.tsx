import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { DICTIONARIES, RTL_LANGUAGES, UI_LANGUAGES, type Language } from './translations';

const STORAGE_KEY = 'quiz_ui_language';

function isUiLanguage(value: string | null): value is Language {
  return value !== null && (UI_LANGUAGES as string[]).includes(value);
}

// Interface language is scoped to this browser tab (sessionStorage), not the device, so the
// next participant on a shared iPad always starts from English rather than inheriting a
// previous child's choice. Older builds stored this in localStorage; drop any such leftover.
localStorage.removeItem(STORAGE_KEY);

function detectDefaultLanguage(): Language {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (isUiLanguage(stored)) return stored;
  return 'en';
}

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  isRtl: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(detectDefaultLanguage);

  function setLanguage(lang: Language) {
    sessionStorage.setItem(STORAGE_KEY, lang);
    setLanguageState(lang);
  }

  function t(key: string, vars?: Record<string, string | number>): string {
    let str = DICTIONARIES[language][key] ?? DICTIONARIES.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  }

  const isRtl = RTL_LANGUAGES.includes(language);

  return <LanguageContext.Provider value={{ language, setLanguage, isRtl, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}

import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { DICTIONARIES, LANGUAGES, RTL_LANGUAGES, type Language } from './translations';

const STORAGE_KEY = 'quiz_ui_language';
const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

function isLanguage(value: string | null): value is Language {
  return value !== null && (LANGUAGE_CODES as string[]).includes(value);
}

function detectDefaultLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (isLanguage(stored)) return stored;
  const browserLang = navigator.language?.slice(0, 2).toLowerCase();
  if (isLanguage(browserLang)) return browserLang;
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
    localStorage.setItem(STORAGE_KEY, lang);
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

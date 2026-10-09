import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { DICTIONARIES, UI_LANGUAGES, type UiLanguage } from './translations';
import { dirOf } from './languageMeta';

const STORAGE_KEY = 'quiz_ui_language';

function isUiLanguage(value: string | null): value is UiLanguage {
  return value !== null && (UI_LANGUAGES as readonly string[]).includes(value);
}

// Interface language is scoped to this browser tab (sessionStorage), not the device, so the
// next participant on a shared iPad always starts from English rather than inheriting a
// previous child's choice. The device locale is ignored on purpose.
function detectDefaultLanguage(): UiLanguage {
  try {
    // Older builds stored this in localStorage (with codes like 'lt'); drop any leftover.
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked
  }
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (isUiLanguage(stored)) return stored;
  } catch {
    // storage blocked
  }
  return 'en';
}

interface LanguageContextValue {
  uiLanguage: UiLanguage;
  setUiLanguage: (lang: UiLanguage) => void;
  isRtl: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Plural-aware lookup: `${baseKey}.${Intl plural category}`, falling back to `${baseKey}.other`; replaces {n}. */
  tCount: (baseKey: string, n: number) => string;
  /** True while a quiz is running: the interface-language menu is hidden (decision Q-ui-lang-after-join). */
  uiLanguageLocked: boolean;
  setUiLanguageLocked: (locked: boolean) => void;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [uiLanguage, setUiLanguageState] = useState<UiLanguage>(detectDefaultLanguage);
  const [uiLanguageLocked, setUiLanguageLocked] = useState(false);
  const { pathname } = useLocation();
  // /admin/** always stays English and LTR.
  const isAdmin = pathname.startsWith('/admin');
  const activeLanguage: UiLanguage = isAdmin ? 'en' : uiLanguage;
  const isRtl = dirOf(activeLanguage) === 'rtl';

  const setUiLanguage = useCallback((lang: UiLanguage) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // storage blocked: the choice applies to this page view only
    }
    setUiLanguageState(lang);
  }, []);

  useEffect(() => {
    document.documentElement.lang = activeLanguage;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  }, [activeLanguage, isRtl]);

  const value = useMemo<LanguageContextValue>(() => {
    const dict = DICTIONARIES[activeLanguage];
    const has = (key: string) => key in dict || key in DICTIONARIES.en;
    const t = (key: string, vars?: Record<string, string | number>) => {
      let str = dict[key] ?? DICTIONARIES.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, String(v));
      }
      return str;
    };
    const tCount = (baseKey: string, n: number) => {
      let category = 'other';
      try {
        category = new Intl.PluralRules(activeLanguage).select(n);
      } catch {
        // keep 'other'
      }
      const key = has(`${baseKey}.${category}`) ? `${baseKey}.${category}` : `${baseKey}.other`;
      return t(key, { n });
    };
    return { uiLanguage, setUiLanguage, isRtl, t, tCount, uiLanguageLocked, setUiLanguageLocked };
  }, [activeLanguage, uiLanguage, setUiLanguage, isRtl, uiLanguageLocked]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}

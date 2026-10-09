import type { CSSProperties } from 'react';
import { useLanguage } from '../i18n/LanguageContext';

export function sectionStyle(colorIndex: number): CSSProperties | undefined {
  return colorIndex ? ({ '--section-color': `var(--section-${colorIndex})` } as CSSProperties) : undefined;
}

/** Accessible name of one question number: "Question 3 of 50, Multiple choice, answered, marked". */
export function useNavItemLabel() {
  const { t } = useLanguage();
  return (n: number, total: number, sectionName: string | null, answered: boolean, flagged: boolean) => {
    const state = t(answered ? 'play.nav.answered' : 'play.nav.unanswered') + (flagged ? `, ${t('play.nav.flagged')}` : '');
    return sectionName
      ? t('play.nav.item', { n, total, section: sectionName, state })
      : t('play.nav.itemNoSection', { n, total, state });
  };
}

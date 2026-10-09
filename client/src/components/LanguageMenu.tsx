import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import type { QuizLang } from '../i18n/contentLanguages';
import { LANGUAGE_META, localizedLanguageName } from '../i18n/languageMeta';
import { useLanguage } from '../i18n/LanguageContext';

interface Props<L extends QuizLang> {
  idPrefix: string;
  options: readonly L[];
  value: L;
  onChange: (code: L) => void;
  icon?: 'globe' | 'none';
  /** Extra text after the current language, e.g. "12 languages". */
  countLabel?: string;
  /** Id of a visible label; the trigger is then named "<label> <current language>". */
  labelledBy?: string;
}

function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="lang-menu__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * The only language dropdown (WAI-ARIA disclosure pattern: a button plus a list of buttons, no menu
 * roles, focus stays on the trigger when it opens). The trigger keeps the width of the widest
 * endonym, so switching never shifts the layout.
 */
export function LanguageMenu<L extends QuizLang>({ idPrefix, options, value, onChange, icon = 'none', countLabel, labelledBy }: Props<L>) {
  const { uiLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  // Fit the open list to the screen: as much height as is left below the trigger, or open upwards
  // when the space below is small, so no option ends up out of reach (12 languages on a phone).
  const [placement, setPlacement] = useState<{ up: boolean; maxHeight: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Safari does not focus a clicked button, so relatedTarget is null on those clicks: ignore null,
  // otherwise the list would close before the click lands and the choice would be lost.
  function onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget;
    if (next instanceof Node && !wrapperRef.current?.contains(next)) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const up = below < 200 && above > below;
    // eslint-disable-next-line react/set-state-in-effect -- measuring layout needs an effect
    setPlacement({ up, maxHeight: Math.max(120, Math.min(up ? above : below, 576)) });
  }, [open]);

  function optionButtons(): HTMLButtonElement[] {
    return Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.lang-menu__option') ?? []);
  }

  function onTriggerKeyDown(e: KeyboardEvent) {
    if (open && e.key === 'ArrowDown') {
      e.preventDefault();
      const buttons = optionButtons();
      (buttons[options.indexOf(value)] ?? buttons[0])?.focus();
    }
  }

  function onOptionKeyDown(e: KeyboardEvent, index: number) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = optionButtons();
    const next = e.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1) : Math.max(index - 1, 0);
    buttons[next]?.focus();
  }

  function pick(code: L) {
    onChange(code);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const showSecondary = options.length > 5;

  return (
    <div className="lang-menu" ref={wrapperRef} onBlur={onFocusOut}>
      <button
        type="button"
        ref={triggerRef}
        className="lang-menu__trigger"
        aria-expanded={open}
        aria-controls={`${idPrefix}-list`}
        aria-labelledby={labelledBy ? `${labelledBy} ${idPrefix}-current` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        {icon === 'globe' && <GlobeIcon />}
        <span className="lang-menu__stack">
          {options.map((code) =>
            code === value ? (
              <span key={code} id={`${idPrefix}-current`} lang={code} className="is-current">
                {LANGUAGE_META[code].endonym}
              </span>
            ) : (
              <span key={code} lang={code} aria-hidden="true">
                {LANGUAGE_META[code].endonym}
              </span>
            ),
          )}
        </span>
        <ChevronIcon />
        {countLabel && <span className="lang-menu__count">· {countLabel}</span>}
      </button>
      <ul
        id={`${idPrefix}-list`}
        ref={listRef}
        className={placement?.up ? 'lang-menu__panel lang-menu__panel--up' : 'lang-menu__panel'}
        style={placement ? { maxBlockSize: placement.maxHeight } : undefined}
        hidden={!open}
      >
        {options.map((code, i) => {
          const endonym = LANGUAGE_META[code].endonym;
          const secondary = showSecondary ? localizedLanguageName(code, uiLanguage) : '';
          return (
            <li key={code}>
              <button
                type="button"
                className="lang-menu__option"
                aria-current={code === value ? 'true' : undefined}
                onClick={() => pick(code)}
                onKeyDown={(e) => onOptionKeyDown(e, i)}
              >
                <span className="lang-menu__check" aria-hidden="true">
                  {code === value ? '✓' : ''}
                </span>
                <span lang={code}>{endonym}</span>
                {secondary && secondary.toLowerCase() !== endonym.toLowerCase() && (
                  <span className="lang-menu__secondary">{secondary}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

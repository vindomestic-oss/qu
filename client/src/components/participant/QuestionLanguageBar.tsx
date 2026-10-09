import { useEffect, useRef, useState } from 'react';
import type { QuizLang } from '../../i18n/contentLanguages';
import { LANGUAGE_META, dirOf } from '../../i18n/languageMeta';
import { useLanguage } from '../../i18n/LanguageContext';
import { LanguageMenu } from '../LanguageMenu';

interface Props {
  /** The quiz's offered languages (declared and complete), base first. */
  languages: QuizLang[];
  value: QuizLang;
  onChange: (lang: QuizLang) => void;
  idPrefix: string;
  /**
   * Defensive fallback only (stale data): "No Deutsch translation, shown in English". Pass a string
   * only where some question can lack the picked language, and pass it for the whole quiz ('' while
   * there is nothing to say): a fixed ⚠ slot is then reserved before the label, so the note showing
   * up never changes the row. Undefined = no slot.
   */
  note?: string;
  /** Changes when the note should be announced again (the question on screen). */
  noteKey?: string | number;
  /** Centre the label and control when they wrap (waiting room). */
  centered?: boolean;
}

function WarningIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3 2 20h20L12 3Z" strokeLinejoin="round" />
      <path d="M12 10v4M12 17v.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The ⚠ of the fallback note: a small button in a slot of fixed size whose name is the whole
 * sentence. A click, a tap or keyboard focus shows the sentence in a bubble laid over the card
 * (nothing moves); Escape, a tap elsewhere or leaving the button closes it. A live region repeats
 * the sentence one tick after it changes, so it is announced even on the first question.
 */
function FallbackNote({ note, noteKey }: { note: string; noteKey?: string | number }) {
  const [open, setOpen] = useState(false);
  const [spoken, setSpoken] = useState('');
  const wrapRef = useRef<HTMLSpanElement>(null);
  const pointerRef = useRef(false);

  useEffect(() => {
    const clear = setTimeout(() => setSpoken(''), 0);
    const say = setTimeout(() => setSpoken(note), 150);
    return () => {
      clearTimeout(clear);
      clearTimeout(say);
    };
  }, [note, noteKey]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <span className="qlang__note" ref={wrapRef} data-empty={note ? undefined : ''}>
      <button
        type="button"
        className="qlang__note-btn"
        aria-label={note || undefined}
        onPointerDown={() => {
          pointerRef.current = true;
        }}
        onPointerCancel={() => {
          pointerRef.current = false;
        }}
        // Keyboard focus opens the bubble; a pointer press lets the click toggle it instead (Chrome
        // focuses on mousedown, Safari does not focus buttons at all).
        onFocus={() => {
          if (!pointerRef.current) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onClick={() => {
          pointerRef.current = false;
          setOpen((o) => !o);
        }}
      >
        <WarningIcon />
      </button>
      {open && note && (
        <span className="qlang__tip" aria-hidden="true">
          {note}
        </span>
      )}
      <span className="visually-hidden" aria-live="polite">
        {spoken}
      </span>
    </span>
  );
}

/**
 * Question-language control (decision Q-card-languages): 1 language → static text, 2 → two chips,
 * 3 or more → one menu with a count. Switching never touches answers: no request, no remount.
 */
export function QuestionLanguageBar({ languages, value, onChange, idPrefix, note, noteKey, centered }: Props) {
  const { t, tCount } = useLanguage();
  const only = languages[0] ?? value;
  const chipsRef = useRef<HTMLSpanElement>(null);

  // Two long names on a narrow phone scroll inside their group: fade the edge that has more, so the
  // row never looks cut off. Attributes only, no re-render.
  useEffect(() => {
    const el = chipsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      // scrollLeft is negative in RTL (Chromium/WebKit), so compare magnitudes.
      const pos = Math.abs(el.scrollLeft);
      const max = el.scrollWidth - el.clientWidth;
      el.toggleAttribute('data-fade-start', max > 1 && pos > 1);
      el.toggleAttribute('data-fade-end', max > 1 && pos < max - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const chip of Array.from(el.children)) observer.observe(chip);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [languages]);

  return (
    <div className={centered ? 'qlang qlang--center' : 'qlang'} role="group" aria-labelledby={`${idPrefix}-label`}>
      {note !== undefined && <FallbackNote note={note} noteKey={noteKey} />}
      <span id={`${idPrefix}-label`} className="qlang__label">
        {t('play.questionLanguage')}
      </span>
      {languages.length <= 1 ? (
        <span lang={only} dir={dirOf(only)} className="qlang__static">
          {LANGUAGE_META[only].endonym}
        </span>
      ) : languages.length === 2 ? (
        <span className="qlang__chips" ref={chipsRef}>
          {languages.map((l) => (
            <button
              key={l}
              type="button"
              className="toggle-chip"
              lang={l}
              dir={dirOf(l)}
              aria-pressed={l === value}
              onClick={() => onChange(l)}
            >
              {LANGUAGE_META[l].endonym}
            </button>
          ))}
        </span>
      ) : (
        <LanguageMenu
          idPrefix={idPrefix}
          labelledBy={`${idPrefix}-label`}
          options={languages}
          value={value}
          onChange={onChange}
          icon="none"
          countLabel={tCount('lang.count', languages.length)}
        />
      )}
    </div>
  );
}

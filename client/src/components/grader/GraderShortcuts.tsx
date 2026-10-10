import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import {
  GRADE_ROW_SELECTOR,
  sendGradeShortcut,
  setShortcutsEnabled,
  useShortcutsEnabled,
  type GradeShortcutAction,
} from '../../lib/graderShortcuts';
import { formatPoints } from './format';
import { KeyboardIcon } from './icons';

/**
 * The key a shortcut listens for: the character on Latin layouts (so AZERTY and Dvorak keep their
 * letters), the physical key on others (a Russian or Hebrew layout types 'о' or 'ח' on J), so the
 * shortcuts work whatever layout the grader types answers in. null = not a shortcut key.
 */
function shortcutKey(e: KeyboardEvent): string | null {
  if (e.key === '?') return '?';
  if (e.shiftKey) return null;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return e.key;
  if (/^[a-z0-9]$/i.test(e.key)) return e.key.toLowerCase();
  const physical = /^(?:Key([A-Z])|Digit([0-9])|Numpad([0-9]))$/.exec(e.code);
  if (physical && e.key.length === 1) return (physical[1] ?? physical[2] ?? physical[3]).toLowerCase();
  return null;
}

/** The answer rows on screen, in reading order (rows of a closed group are hidden, so left out). */
function visibleRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(GRADE_ROW_SELECTOR)].filter((el) => el.getClientRects().length > 0);
}

function currentRow(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement ? active.closest<HTMLElement>(GRADE_ROW_SELECTOR) : null;
}

/** Without a focused row, moves start at the first row on screen below the sticky bar. */
function firstOnScreen(rows: HTMLElement[]): number {
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grade-sticky-offset')) || 0;
  const i = rows.findIndex((el) => el.getBoundingClientRect().bottom > top);
  return i < 0 ? 0 : i;
}

/** Ungraded, gradable and not being saved right now (N right after a grade key moves on). */
const isOpen = (el: HTMLElement) => el.dataset.graded === 'false' && el.dataset.gradable === 'true' && el.dataset.saving !== 'true';

/** Fields that take typed text; checkboxes, radios and buttons do not block the shortcuts. */
const TEXT_ENTRY =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="image"]), textarea, select, [contenteditable]:not([contenteditable="false"])';

function focusRow(el: HTMLElement) {
  el.focus({ preventScroll: true });
  // "nearest" keeps the list still when the row is already in view; html scroll-padding keeps it
  // below the sticky bar of the whole-quiz page.
  el.scrollIntoView({ block: 'nearest' });
}

/**
 * Wish 8 (S15): keyboard shortcuts for grading, on the whole-quiz and participant pages. J/↓ and K/↑
 * move the focus between answers, N to the next ungraded one; C or X (or I), and the digits (points),
 * grade the focused answer; P opens its points field; ? shows the list. A (accept the AI suggestion)
 * stays with useAiAcceptKey. Never while typing in a field, in a dialog, or with Ctrl/Alt/Cmd (Shift
 * only for ?); switched off with the checkbox in the list (stored per browser, WCAG 2.1.4). The
 * button opens the list in any case. Outcomes the row does not show itself are announced politely.
 */
export function GraderShortcuts({ aiAccept }: { aiAccept: boolean }) {
  const { t, uiLanguage } = useLanguage();
  const on = useShortcutsEnabled();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [message, setMessage] = useState('');
  const sayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleared first, so the same sentence twice is announced twice.
  const say = useCallback((text: string) => {
    setMessage('');
    if (sayTimer.current) clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(() => setMessage(text), 60);
  }, []);
  useEffect(
    () => () => {
      if (sayTimer.current) clearTimeout(sayTimer.current);
    },
    [],
  );

  const openHelp = useCallback(() => {
    const d = dialogRef.current;
    if (!d || d.open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    d.showModal();
    // The title, not the first control (Space on the switch would turn the shortcuts off), and the
    // list opens at its top on a small screen.
    titleRef.current?.focus();
  }, []);

  function onClose() {
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back && back.isConnected && back !== document.body) back.focus();
    else buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!on) return;

    function move(dir: 1 | -1) {
      const rows = visibleRows();
      if (rows.length === 0) return say(t('grader.keys.noRows'));
      const current = currentRow();
      const at = current ? rows.indexOf(current) : -1;
      const next = at < 0 ? firstOnScreen(rows) : at + dir;
      if (next < 0) return say(t('grader.keys.first'));
      if (next >= rows.length) return say(t('grader.keys.last'));
      focusRow(rows[next]);
    }

    function nextUngraded() {
      const rows = visibleRows();
      if (rows.length === 0) return say(t('grader.keys.noRows'));
      const current = currentRow();
      const at = current ? rows.indexOf(current) : firstOnScreen(rows) - 1;
      for (let k = 1; k <= rows.length; k += 1) {
        const el = rows[(at + k + rows.length) % rows.length];
        if (isOpen(el)) return focusRow(el);
      }
      // Ungraded rows that cannot be graded yet (the participant is still answering).
      const waiting = rows.some((el) => el.dataset.graded === 'false' && el.dataset.gradable === 'false');
      say(t(waiting ? 'grader.keys.notGradable' : 'grader.keys.allGraded'));
    }

    function grade(action: GradeShortcutAction) {
      const row = currentRow();
      if (!row) return say(t('grader.keys.noRow'));
      const out = sendGradeShortcut(row, action);
      if (out.result === 'too_high') say(t('grader.keys.tooHigh', { max: formatPoints(out.max ?? 0, uiLanguage) }));
      else if (out.result === 'not_gradable') say(t('grader.keys.notGradable'));
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      if (document.querySelector('dialog[open]')) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      // Esc in a points field with nothing typed to discard: back to its row.
      if (e.key === 'Escape') {
        if (!e.defaultPrevented && target?.matches('.points-field input')) {
          const row = target.closest<HTMLElement>(GRADE_ROW_SELECTOR);
          if (row) {
            e.preventDefault();
            row.focus();
          }
        }
        return;
      }
      if (e.defaultPrevented || !target || target.closest(TEXT_ENTRY)) return;
      const key = shortcutKey(e);
      if (key === null) return;
      const inList = target.closest(GRADE_ROW_SELECTOR) !== null;
      let act: (() => void) | null = null;
      if (key === '?') act = openHelp;
      else if (key === 'j' || (key === 'ArrowDown' && inList)) act = () => move(1);
      else if (key === 'k' || (key === 'ArrowUp' && inList)) act = () => move(-1);
      else if (key === 'n') act = nextUngraded;
      else if (!e.repeat) {
        if (key === 'c') act = () => grade({ kind: 'correct' });
        else if (key === 'x' || key === 'i') act = () => grade({ kind: 'incorrect' });
        else if (key === 'p') act = () => grade({ kind: 'editPoints' });
        else if (/^[0-9]$/.test(key)) act = () => grade({ kind: 'points', points: Number(key) });
        // A on a non-Latin layout (useAiAcceptKey reads the character 'a' only).
        else if (key === 'a' && aiAccept && !/^a$/i.test(e.key)) {
          const button = currentRow()?.querySelector<HTMLButtonElement>('[data-ai-accept="offered"]');
          if (button) act = () => button.click();
        }
      }
      if (!act) return;
      e.preventDefault();
      act();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [on, aiAccept, t, uiLanguage, say, openHelp]);

  const keys: { keys: string[]; label: string }[] = [
    { keys: ['J', '↓'], label: t('grader.keys.next') },
    { keys: ['K', '↑'], label: t('grader.keys.prev') },
    { keys: ['N'], label: t('grader.keys.nextUngraded') },
    { keys: ['C'], label: t('grader.keys.correct') },
    { keys: ['X', 'I'], label: t('grader.keys.incorrect') },
    { keys: ['0–9'], label: t('grader.keys.points') },
    { keys: ['P'], label: t('grader.keys.editPoints') },
    ...(aiAccept ? [{ keys: ['A'], label: t('grader.keys.accept') }] : []),
    { keys: ['?'], label: t('grader.keys.help') },
    { keys: ['Esc'], label: t('grader.keys.closeKey') },
  ];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="small-button shortcut-button"
        aria-haspopup="dialog"
        aria-keyshortcuts={on ? '?' : undefined}
        title={on ? t('grader.keys.tooltip', { key: '?' }) : undefined}
        onClick={openHelp}
        data-testid="grader-shortcuts"
      >
        <KeyboardIcon /> <span className="shortcut-button__label">{t('grader.keys.button')}</span>
      </button>
      <span className="visually-hidden" role="status">
        {message}
      </span>
      <dialog ref={dialogRef} className="ai-dialog shortcut-dialog" aria-labelledby={`${id}-title`} onClose={onClose}>
        <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1}>
          {t('grader.keys.title')}
        </h2>
        <p className="grade-muted">{t('grader.keys.intro')}</p>
        <table className="shortcut-table">
          <tbody>
            {keys.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  {row.keys.map((k, i) => (
                    <span key={k}>
                      {i > 0 && <span className="shortcut-table__or"> {t('grader.keys.or')} </span>}
                      <kbd dir="ltr">{k}</kbd>
                    </span>
                  ))}
                </th>
                <td>{row.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="shortcut-toggle">
          <input type="checkbox" checked={on} onChange={(e) => setShortcutsEnabled(e.target.checked)} />
          <span>{t('grader.keys.enabled')}</span>
        </label>
        <div className="ai-dialog__actions">
          <button type="button" onClick={() => dialogRef.current?.close()}>
            {t('grader.keys.close')}
          </button>
        </div>
      </dialog>
    </>
  );
}

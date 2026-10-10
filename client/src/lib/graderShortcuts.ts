import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';

// Wish 8 (S15): keyboard shortcuts of the grading panel. The keys are read by GraderShortcuts (one
// listener per page); a grade key is handed to the answer row that has the focus as a DOM event, so
// the row grades with its own logic (versions, conflicts, one save at a time). Single-character
// shortcuts can be switched off (WCAG 2.1.4), per browser; blocked storage means "on" for this view.

export const SHORTCUTS_KEY = 'ejka_grader_shortcuts';

/** Marks an answer row that J/K/N move between and that takes grade keys (AnswerGradeRow, AnswerGroupRow). */
export const GRADE_ROW_ATTR = 'data-grade-row';
export const GRADE_ROW_SELECTOR = `[${GRADE_ROW_ATTR}]`;
/** The event a row receives for a grade key; it writes its outcome into `detail.result`. */
export const GRADE_SHORTCUT_EVENT = 'grader:shortcut';

export type GradeShortcutAction =
  | { kind: 'correct' }
  | { kind: 'incorrect' }
  /** A digit: this many points (0 = incorrect, the maximum = correct). */
  | { kind: 'points'; points: number }
  /** P: move into the row's points field (half points, e.g. 0.5). */
  | { kind: 'editPoints' };

/** ok: done (the row's own status line announces saving / saved); the rest are announced by the page. */
export type GradeShortcutResult = 'ok' | 'too_high' | 'not_gradable' | 'busy';

export interface GradeShortcutDetail {
  action: GradeShortcutAction;
  result?: GradeShortcutResult;
  /** too_high: the question's maximum. */
  max?: number;
}

function read(): boolean {
  try {
    return localStorage.getItem(SHORTCUTS_KEY) !== '0';
  } catch {
    return true;
  }
}

let enabled = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SHORTCUTS_KEY) return;
    enabled = read();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setShortcutsEnabled(next: boolean): void {
  enabled = next;
  try {
    if (next) localStorage.removeItem(SHORTCUTS_KEY);
    else localStorage.setItem(SHORTCUTS_KEY, '0');
  } catch {
    // storage blocked: applies to this page view only
  }
  for (const l of listeners) l();
}

/** Whether the grading shortcuts are on in this browser (default on). */
export function useShortcutsEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled);
}

/** An answer row's part: grade keys aimed at this row run `handler`, which reports the outcome. */
export function useGradeShortcut(
  ref: RefObject<HTMLElement | null>,
  handler: (action: GradeShortcutAction) => GradeShortcutResult | { result: GradeShortcutResult; max: number },
): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onShortcut = (e: Event) => {
      const detail = (e as CustomEvent<GradeShortcutDetail>).detail;
      const out = latest.current(detail.action);
      if (typeof out === 'string') detail.result = out;
      else {
        detail.result = out.result;
        detail.max = out.max;
      }
    };
    el.addEventListener(GRADE_SHORTCUT_EVENT, onShortcut);
    return () => el.removeEventListener(GRADE_SHORTCUT_EVENT, onShortcut);
  }, [ref]);
}

/** Sends a grade key to a row; `result` stays undefined when the row did not handle it. */
export function sendGradeShortcut(row: HTMLElement, action: GradeShortcutAction): GradeShortcutDetail {
  const detail: GradeShortcutDetail = { action };
  row.dispatchEvent(new CustomEvent(GRADE_SHORTCUT_EVENT, { detail }));
  return detail;
}

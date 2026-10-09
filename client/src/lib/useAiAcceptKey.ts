import { useEffect } from 'react';

/**
 * Wish 7 (S14), keyboard shortcut A = accept the suggestion of the answer row that has the focus (one of its
 * buttons). Active only inside the answer list (a question card), never while typing in a field or
 * in a dialog, never in blind mode. One listener per page.
 */
export function useAiAcceptKey(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.key !== 'a' && e.key !== 'A') || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!target || target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      const row = target.closest('.review-card .answer-row');
      const button = row?.querySelector<HTMLButtonElement>('[data-ai-accept="offered"]');
      if (!button) return;
      e.preventDefault();
      button.click();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

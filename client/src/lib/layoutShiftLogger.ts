// Development only (imported from main.tsx under import.meta.env.DEV): logs every layout shift with
// the nodes that moved, including shifts right after input. Chromium only.
interface ShiftSource {
  node?: Node;
  previousRect: DOMRectReadOnly;
  currentRect: DOMRectReadOnly;
}
interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
  sources?: ShiftSource[];
}

try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as LayoutShiftEntry[]) {
      console.log('[layout-shift]', entry.value.toFixed(4), entry.hadRecentInput ? '(after input)' : '', entry.sources ?? []);
    }
  }).observe({ type: 'layout-shift', buffered: true });
} catch {
  // not supported in this browser
}

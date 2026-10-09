import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data for a staff page and reloads it on demand. Responses that arrive out of order are
 * dropped (sequence guard), and a failed reload keeps the last good data with an error flag.
 */
export function useLoader<T>(load: (() => Promise<T>) | null): {
  data: T | null;
  error: boolean;
  reload: () => void;
  setData: (update: (prev: T | null) => T | null) => void;
} {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const seq = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => {
    const fn = loadRef.current;
    if (!fn) return;
    const mine = ++seq.current;
    fn()
      .then((result) => {
        if (mine !== seq.current) return;
        setDataState(result);
        setError(false);
      })
      .catch(() => {
        if (mine === seq.current) setError(true);
      });
  }, []);

  const setData = useCallback((update: (prev: T | null) => T | null) => {
    // A local change (e.g. a saved grade) wins over a reload that started before it.
    seq.current += 1;
    setDataState(update);
  }, []);

  return { data, error, reload, setData };
}

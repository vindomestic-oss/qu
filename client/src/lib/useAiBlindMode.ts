import { useCallback, useEffect, useState } from 'react';

// Wish 7 (S14): "Hide AI suggestions until I decide" (blind mode), per browser, for training
// graders and spot checks. Every storage access is guarded: blocked storage means "off".

export const AI_BLIND_KEY = 'ejka_grader_hide_ai';

function read(): boolean {
  try {
    return localStorage.getItem(AI_BLIND_KEY) === '1';
  } catch {
    return false;
  }
}

export function useAiBlindMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(read);
  // Another tab changed it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === AI_BLIND_KEY) setOn(read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      if (next) localStorage.setItem(AI_BLIND_KEY, '1');
      else localStorage.removeItem(AI_BLIND_KEY);
    } catch {
      // storage blocked: applies to this page view only
    }
  }, []);
  return [on, set];
}

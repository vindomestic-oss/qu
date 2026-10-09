import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { getParticipantToken, setParticipantToken } from '../api/participantClient';
import { joinSession } from '../api/participant';
import { clearStoredContentLanguage } from '../i18n/useContentLanguage';
import { nameKey } from '../lib/names';

const NAME_KEY = 'quiz_participant_name';
const REJOIN_PREFIX = 'quiz_rejoin:';
const CURRENT_REJOIN_KEY = 'quiz_rejoin_current';

// The rejoin secret lives in localStorage (unlike the per-tab token), so a child who closes the tab
// can join again under the same name on the same device. Join codes are unique per session. Only
// the most recent session's secrets are kept, so a shared iPad does not collect children's names.
function rejoinKey(joinCode: string, name: string): string {
  return `${REJOIN_PREFIX}${joinCode.trim().toUpperCase()}:${nameKey(name)}`;
}

function readRejoinSecret(joinCode: string, name: string): string | undefined {
  try {
    return localStorage.getItem(rejoinKey(joinCode, name)) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeRejoinSecret(joinCode: string, name: string, secret: string): void {
  try {
    const codePrefix = `${REJOIN_PREFIX}${joinCode.trim().toUpperCase()}:`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(REJOIN_PREFIX) && !k.startsWith(codePrefix)) localStorage.removeItem(k);
    }
    localStorage.setItem(rejoinKey(joinCode, name), secret);
    sessionStorage.setItem(CURRENT_REJOIN_KEY, rejoinKey(joinCode, name));
  } catch {
    // Storage blocked: rejoining then needs the host's "Allow rejoin"
  }
}

function forgetCurrentRejoinSecret(): void {
  try {
    const key = sessionStorage.getItem(CURRENT_REJOIN_KEY);
    if (key) localStorage.removeItem(key);
    sessionStorage.removeItem(CURRENT_REJOIN_KEY);
  } catch {
    // storage blocked
  }
}

interface ParticipantContextValue {
  displayName: string | null;
  isJoined: boolean;
  /** True when this device already joined this session under this name (the Join page asks "Continue as …?"). */
  hasRejoinSecret: (joinCode: string, displayName: string) => boolean;
  /** `useSecret: false` joins as a new person even if this device holds a secret for the name. */
  join: (joinCode: string, displayName: string, opts?: { useSecret?: boolean }) => Promise<void>;
  leave: () => void;
}

const ParticipantContext = createContext<ParticipantContextValue | undefined>(undefined);

export function ParticipantProvider({ children }: { children: ReactNode }) {
  const [displayName, setDisplayName] = useState<string | null>(sessionStorage.getItem(NAME_KEY));
  const [isJoined, setIsJoined] = useState<boolean>(Boolean(getParticipantToken()));

  function hasRejoinSecret(joinCode: string, name: string): boolean {
    return readRejoinSecret(joinCode, name) !== undefined;
  }

  async function join(joinCode: string, name: string, { useSecret = true }: { useSecret?: boolean } = {}) {
    clearStoredContentLanguage();
    const result = await joinSession(joinCode, name, useSecret ? readRejoinSecret(joinCode, name) : undefined);
    storeRejoinSecret(joinCode, name, result.rejoinSecret);
    setParticipantToken(result.token);
    sessionStorage.setItem(NAME_KEY, result.participant.display_name);
    setDisplayName(result.participant.display_name);
    setIsJoined(true);
  }

  // Called when the session or the participant is gone (401/404): the secret is of no further use.
  function leave() {
    forgetCurrentRejoinSecret();
    setParticipantToken(null);
    sessionStorage.removeItem(NAME_KEY);
    clearStoredContentLanguage();
    setDisplayName(null);
    setIsJoined(false);
  }

  return (
    <ParticipantContext.Provider value={{ displayName, isJoined, hasRejoinSecret, join, leave }}>
      {children}
    </ParticipantContext.Provider>
  );
}

export function useParticipant(): ParticipantContextValue {
  const ctx = useContext(ParticipantContext);
  if (!ctx) throw new Error('useParticipant must be used within ParticipantProvider');
  return ctx;
}

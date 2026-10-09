import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { getParticipantToken, setParticipantToken } from '../api/participantClient';
import { joinSession } from '../api/participant';
import { clearStoredContentLanguage } from '../i18n/useContentLanguage';

const NAME_KEY = 'quiz_participant_name';

// The rejoin secret lives in localStorage (unlike the per-tab token), so a child who closes the tab
// can join again under the same name on the same device. Join codes are unique per session.
function rejoinKey(joinCode: string, name: string): string {
  return `quiz_rejoin:${joinCode.trim().toUpperCase()}:${name.trim()}`;
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
    localStorage.setItem(rejoinKey(joinCode, name), secret);
  } catch {
    // Storage blocked: rejoining then needs the host's "Allow rejoin"
  }
}

interface ParticipantContextValue {
  displayName: string | null;
  isJoined: boolean;
  join: (joinCode: string, displayName: string) => Promise<void>;
  leave: () => void;
}

const ParticipantContext = createContext<ParticipantContextValue | undefined>(undefined);

export function ParticipantProvider({ children }: { children: ReactNode }) {
  const [displayName, setDisplayName] = useState<string | null>(sessionStorage.getItem(NAME_KEY));
  const [isJoined, setIsJoined] = useState<boolean>(Boolean(getParticipantToken()));

  async function join(joinCode: string, name: string) {
    clearStoredContentLanguage();
    const result = await joinSession(joinCode, name, readRejoinSecret(joinCode, name));
    storeRejoinSecret(joinCode, name, result.rejoinSecret);
    setParticipantToken(result.token);
    sessionStorage.setItem(NAME_KEY, result.participant.display_name);
    setDisplayName(result.participant.display_name);
    setIsJoined(true);
  }

  function leave() {
    setParticipantToken(null);
    sessionStorage.removeItem(NAME_KEY);
    clearStoredContentLanguage();
    setDisplayName(null);
    setIsJoined(false);
  }

  return (
    <ParticipantContext.Provider value={{ displayName, isJoined, join, leave }}>
      {children}
    </ParticipantContext.Provider>
  );
}

export function useParticipant(): ParticipantContextValue {
  const ctx = useContext(ParticipantContext);
  if (!ctx) throw new Error('useParticipant must be used within ParticipantProvider');
  return ctx;
}

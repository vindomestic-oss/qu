import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { getParticipantToken, setParticipantToken } from '../api/participantClient';
import { joinSession } from '../api/participant';

const NAME_KEY = 'quiz_participant_name';

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
    const result = await joinSession(joinCode, name);
    setParticipantToken(result.token);
    sessionStorage.setItem(NAME_KEY, result.participant.display_name);
    setDisplayName(result.participant.display_name);
    setIsJoined(true);
  }

  function leave() {
    setParticipantToken(null);
    sessionStorage.removeItem(NAME_KEY);
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

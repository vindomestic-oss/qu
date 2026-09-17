import { ApiError } from './client';

const TOKEN_KEY = 'quiz_participant_token';

// sessionStorage (not localStorage) is deliberate: it's isolated per browser
// tab/window, so two participants on the same device (or two tabs open during
// testing) can never silently share or overwrite each other's identity.
export function getParticipantToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setParticipantToken(token: string | null) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export async function participantApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getParticipantToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error || 'Request failed');
  }
  return data as T;
}

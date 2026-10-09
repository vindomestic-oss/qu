import { ApiError, getToken, setToken } from './client';
import { recordServerTime } from '../lib/clock';

// Grading panel (wish 8): admins use their admin token; graders a token from a grader link, stored
// per session. The admin token wins when both exist and it is still valid.

const graderKey = (sessionId: number) => `quiz_grader_token_${sessionId}`;

export function getGraderToken(sessionId: number): string | null {
  try {
    return localStorage.getItem(graderKey(sessionId));
  } catch {
    return null;
  }
}

export function setGraderToken(sessionId: number, token: string | null): void {
  try {
    if (token) localStorage.setItem(graderKey(sessionId), token);
    else localStorage.removeItem(graderKey(sessionId));
  } catch {
    // storage blocked: the token lives until the page is left
  }
}

/** The `exp` claim of a JWT (seconds), read without a library; null when it cannot be read. */
export function tokenExp(token: string): number | null {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

export function isTokenAlive(token: string | null): token is string {
  if (!token) return false;
  const exp = tokenExp(token);
  return exp === null || exp * 1000 > Date.now();
}

export type StaffToken = { kind: 'admin' | 'grader'; token: string };

/** An error from the grading API with its JSON body (e.g. the current grade of a 409 conflict). */
export class StaffApiError extends ApiError {
  body: Record<string, unknown>;
  constructor(status: number, message: string, code: string | undefined, body: Record<string, unknown>) {
    super(status, message, code);
    this.body = body;
  }
}

export function getStaffToken(sessionId: number): StaffToken | null {
  const admin = getToken();
  if (isTokenAlive(admin)) return { kind: 'admin', token: admin };
  const grader = getGraderToken(sessionId);
  if (isTokenAlive(grader)) return { kind: 'grader', token: grader };
  return null;
}

/** The staff token went bad: admins log in again and come back; graders see "access expired or revoked". */
export function handleStaffUnauthorized(sessionId: number, kind: 'admin' | 'grader'): void {
  if (kind === 'admin') {
    setToken(null);
    try {
      localStorage.removeItem('quiz_admin_username');
    } catch {
      // storage blocked
    }
    location.assign(`/admin/login?expired=1&next=${encodeURIComponent(location.pathname + location.search)}`);
  } else {
    setGraderToken(sessionId, null);
    location.assign('/grade?expired=1');
  }
}

/** A request to /api/grading/:sessionId<path> with the staff token of that session. */
export async function staffApi<T>(sessionId: number, path: string, options: RequestInit = {}): Promise<T> {
  const staff = getStaffToken(sessionId);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (staff) headers.Authorization = `Bearer ${staff.token}`;
  const sentAt = Date.now();
  const res = await fetch(`/api/grading/${sessionId}${path}`, { ...options, headers });
  // The header's countdown (S15): grading responses are never cached (no-store), so their Date header
  // (1 s resolution) is a fresh reading of the server clock.
  const date = res.headers.get('Date');
  if (date) recordServerTime(Date.parse(date), sentAt, Date.now(), 1000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) handleStaffUnauthorized(sessionId, staff?.kind ?? 'grader');
    throw new StaffApiError(res.status, data.error || 'Request failed', data.code, data);
  }
  return data as T;
}

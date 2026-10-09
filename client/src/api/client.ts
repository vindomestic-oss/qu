import { recordServerNow } from '../lib/clock';

const TOKEN_KEY = 'quiz_admin_token';
const USERNAME_KEY = 'quiz_admin_username';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  /** Machine-readable error code from the server (e.g. 'NAME_TAKEN'), when it sends one. */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const ADMIN_EXPIRED_EVENT = 'quiz:admin-session-expired';

export function adminLoginUrl(): string {
  return `/admin/login?expired=1&next=${encodeURIComponent(location.pathname + location.search)}`;
}

/**
 * The admin token expired or was revoked (or another tab already dropped it). A request the admin
 * started goes to the login page, which brings them back here. A background refresh (live monitor)
 * only raises a banner, so a half-typed question is not thrown away by a redirect.
 */
function handleExpiredAdminToken(background: boolean): void {
  setToken(null);
  localStorage.removeItem(USERNAME_KEY);
  if (background) window.dispatchEvent(new Event(ADMIN_EXPIRED_EVENT));
  else location.assign(adminLoginUrl());
}

function isExpiredAdmin(status: number, path: string, hadToken: boolean): boolean {
  return status === 401 && path !== '/auth/login' && (hadToken || location.pathname.startsWith('/admin'));
}

export async function api<T>(path: string, options: RequestInit & { background?: boolean } = {}): Promise<T> {
  const { background = false, ...init } = options;
  options = init;
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const sentAt = Date.now();
  const res = await fetch(`/api${path}`, { ...options, headers });
  const receivedAt = Date.now();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (isExpiredAdmin(res.status, path, Boolean(token))) handleExpiredAdminToken(background);
    throw new ApiError(res.status, data.error || 'Request failed', data.code);
  }
  // GET /api/sessions/:id carries the server's clock for the host's countdown (S15).
  recordServerNow(data?.server_now, sentAt, receivedAt);
  return data as T;
}

/** Downloads a file from an admin endpoint with the bearer token and saves it under `fallbackName`. */
export async function downloadAdminFile(path: string, fallbackName: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (isExpiredAdmin(res.status, path, Boolean(token))) handleExpiredAdminToken(false);
    throw new ApiError(res.status, data.error || 'Download failed', data.code);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

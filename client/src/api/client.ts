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

/** The admin token expired or was revoked: drop it and go to the login page, which brings the admin back here. */
function handleExpiredAdminToken(): void {
  setToken(null);
  localStorage.removeItem(USERNAME_KEY);
  location.assign(`/admin/login?expired=1&next=${encodeURIComponent(location.pathname + location.search)}`);
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && path !== '/auth/login') handleExpiredAdminToken();
    throw new ApiError(res.status, data.error || 'Request failed', data.code);
  }
  return data as T;
}

/** Downloads a file from an admin endpoint with the bearer token and saves it under `fallbackName`. */
export async function downloadAdminFile(path: string, fallbackName: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) handleExpiredAdminToken();
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

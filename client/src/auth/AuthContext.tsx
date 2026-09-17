import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { api, getToken, setToken } from '../api/client';

interface AdminUser {
  username: string;
}

interface AuthContextValue {
  admin: AdminUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(
    getToken() ? { username: localStorage.getItem('quiz_admin_username') || '' } : null,
  );
  const [loading] = useState(false);

  async function login(username: string, password: string) {
    const result = await api<{ token: string; username: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setToken(result.token);
    localStorage.setItem('quiz_admin_username', result.username);
    setAdmin({ username: result.username });
  }

  function logout() {
    setToken(null);
    localStorage.removeItem('quiz_admin_username');
    setAdmin(null);
  }

  return <AuthContext.Provider value={{ admin, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

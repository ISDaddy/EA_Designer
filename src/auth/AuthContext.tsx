import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, parseJsonOrError } from '../api';
import type { ApiUser } from '../api';
import { AuthContext } from './context';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/auth/me');
      if (res.status === 401) { setUser(null); return; }
      const data = await parseJsonOrError(res);
      setUser(data as ApiUser);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = (await parseJsonOrError(res)) as ApiUser | { requiresTotp: true; challengeToken: string };
    if ('requiresTotp' in data && data.requiresTotp) return { requiresTotp: true as const, challengeToken: data.challengeToken };
    setUser(data as ApiUser);
    return { requiresTotp: false as const };
  }, []);

  const loginWithGoogle = useCallback(async (credential: string) => {
    const res = await apiFetch('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
    const data = (await parseJsonOrError(res)) as ApiUser | { requiresTotp: true; challengeToken: string };
    if ('requiresTotp' in data && data.requiresTotp) return { requiresTotp: true as const, challengeToken: data.challengeToken };
    setUser(data as ApiUser);
    return { requiresTotp: false as const };
  }, []);

  const verifyTotp = useCallback(async (challengeToken: string, code: string) => {
    const res = await apiFetch('/auth/login/verify-totp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken, code }),
    });
    const data = await parseJsonOrError(res);
    setUser(data as ApiUser);
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, verifyTotp, logout, refresh, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

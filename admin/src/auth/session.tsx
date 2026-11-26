import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, deviceId, onSessionChange, refreshSession, request, setAccessToken } from '../api/client';
import type { LoginResult, PublicUser } from '../api/types';
import { SessionContext, type SessionContextValue, type SessionStatus } from './context';

/** Works out where a freshly authenticated session stands. */
async function resolveStatus(): Promise<{ status: SessionStatus; user: PublicUser | null }> {
  const user = await api.get<PublicUser>('/v1/me');
  if (user.role !== 'admin') return { status: 'signedOut', user: null };
  // An admin who has not turned on 2FA can only reach the setup screen.
  const { enabled } = await api.get<{ enabled: boolean }>('/v1/admin/2fa');
  return { status: enabled ? 'signedIn' : 'needsMfaSetup', user };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);

  const apply = useCallback((s: { status: SessionStatus; user: PublicUser | null }) => {
    setUser(s.user);
    setStatus(s.status);
  }, []);

  // Restore the session from the refresh cookie on page load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await refreshSession();
      const next = ok ? await resolveStatus().catch(() => ({ status: 'signedOut' as const, user: null })) : null;
      if (!cancelled) apply(next ?? { status: 'signedOut', user: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // A failed refresh anywhere means the session is over.
  useEffect(
    () =>
      onSessionChange((signedIn) => {
        if (!signedIn) apply({ status: 'signedOut', user: null });
      }),
    [apply],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      async signIn(email, password) {
        const res = await request<LoginResult>('/v1/auth/login/email', {
          method: 'POST',
          anonymous: true,
          body: { email, password, app: 'admin', deviceId: deviceId() },
        });
        if ('challengeToken' in res) return { challengeToken: res.challengeToken };
        setAccessToken(res.tokens.accessToken);
        apply(await resolveStatus());
        return null;
      },
      async verifyCode(challengeToken, code) {
        const res = await request<Extract<LoginResult, { tokens: unknown }>>('/v1/auth/login/totp', {
          method: 'POST',
          anonymous: true,
          body: { challengeToken, code, deviceId: deviceId() },
        });
        setAccessToken(res.tokens.accessToken);
        apply(await resolveStatus());
      },
      async mfaCompleted() {
        apply(await resolveStatus());
      },
      async signOut() {
        await request('/v1/auth/logout', { method: 'POST', anonymous: true, body: {} }).catch(() => undefined);
        setAccessToken(null);
      },
    }),
    [status, user, apply],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

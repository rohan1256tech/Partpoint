import { createContext, useContext } from 'react';
import type { PublicUser } from '../api/types';

/**
 * signedOut      → sign-in page
 * needsMfaSetup  → signed in with a password only; must set up 2FA before anything else
 * signedIn       → full access
 */
export type SessionStatus = 'loading' | 'signedOut' | 'needsMfaSetup' | 'signedIn';

export interface SessionContextValue {
  status: SessionStatus;
  user: PublicUser | null;
  /** Step 1. Returns a challenge when a 2FA code is needed. */
  signIn(email: string, password: string): Promise<{ challengeToken: string } | null>;
  /** Step 2 (when 2FA is set up). */
  verifyCode(challengeToken: string, code: string): Promise<void>;
  /** After finishing 2FA setup in this session. */
  mfaCompleted(): Promise<void>;
  signOut(): Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

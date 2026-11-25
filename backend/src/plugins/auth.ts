import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Database } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { ClientApp, Role, TokenSigner } from '../modules/auth/tokens.js';

export interface AuthUser {
  id: string;
  role: Role;
  status: 'pending' | 'approved' | 'blocked';
  app: ClientApp;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthUser;
  }
}

export interface GuardOptions {
  /** Restrict to these roles. Omit to allow any signed-in role. */
  roles?: readonly Role[];
  /** Let users awaiting admin approval through (profile, account deletion). Default false. */
  allowPending?: boolean;
}

export type Authenticate = (opts?: GuardOptions) => preHandlerAsyncHookHandler;

/**
 * Builds the shared auth guard. Besides verifying the JWT it checks the session and user
 * in the database on every request, so blocking a user or revoking a session takes effect
 * immediately instead of when the 15-minute access token expires.
 */
export function createAuthGuard(db: Database, signer: TokenSigner): Authenticate {
  return (opts = {}) =>
    async function authenticate(request: FastifyRequest) {
      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw unauthorized();
      const claims = await signer.verifyAccess(header.slice('Bearer '.length).trim());

      const [row] = await db
        .select({ role: users.role, status: users.status })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(
            eq(sessions.id, claims.sid),
            eq(sessions.userId, claims.sub),
            isNull(sessions.revokedAt),
            isNull(users.deletedAt),
          ),
        );

      if (!row || row.role !== claims.role) throw unauthorized('SESSION_REVOKED', 'Session ended. Please sign in again');
      if (row.status === 'blocked') throw forbidden('ACCOUNT_BLOCKED', 'This account has been blocked');
      if (row.status === 'pending' && !opts.allowPending) {
        throw forbidden('ACCOUNT_PENDING', 'Your account is awaiting approval');
      }
      if (opts.roles && !opts.roles.includes(row.role)) throw forbidden();

      request.auth = { id: claims.sub, role: row.role, status: row.status, app: claims.app, sessionId: claims.sid };
    };
}

/** Returns the authenticated user. Only call from routes that run the guard. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

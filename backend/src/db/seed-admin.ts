/**
 * Creates (or resets the password of) an admin account. Admins cannot self-register.
 *
 *   ADMIN_EMAIL=ops@example.in ADMIN_NAME="Ops" ADMIN_PASSWORD='…' pnpm db:seed:admin
 *
 * Add ADMIN_RESET_2FA=1 to clear the admin's two-factor setup (lost phone).
 */
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { hashPassword } from '../lib/password.js';
import { createDb } from './index.js';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { sessions, users } from './schema.js';

const input = z
  .object({
    ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
    ADMIN_NAME: z.string().trim().min(1).default('Admin'),
    ADMIN_PASSWORD: z.string().min(12, 'ADMIN_PASSWORD must be at least 12 characters'),
  })
  .parse(process.env);

const resetMfa = process.env.ADMIN_RESET_2FA === '1';
const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL, 1);

try {
  const passwordHash = await hashPassword(input.ADMIN_PASSWORD);
  const now = new Date();
  await db
    .insert(users)
    .values({
      role: 'admin',
      status: 'approved',
      name: input.ADMIN_NAME,
      email: input.ADMIN_EMAIL,
      passwordHash,
      emailVerifiedAt: now,
      approvedAt: now,
      consentAt: now,
      consentVersion: env.CONSENT_VERSION,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash,
        role: 'admin',
        status: 'approved',
        // Lost authenticator: clear 2FA so it can be set up again at the next sign-in.
        ...(resetMfa ? { totpSecret: null, totpEnabledAt: null, totpLastStep: null } : {}),
      },
    });
  if (resetMfa) {
    // End every session of that admin, so nothing signed in under the old factor survives.
    await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(isNull(sessions.revokedAt), inArray(sessions.userId, db.select({ id: users.id }).from(users).where(eq(users.email, input.ADMIN_EMAIL)))));
  }
  process.stdout.write(`Admin ${input.ADMIN_EMAIL} is ready${resetMfa ? ' (2FA reset; set it up again at sign-in)' : ''}.\n`);
} finally {
  await pool.end();
}

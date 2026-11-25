/**
 * Creates (or resets the password of) an admin account. Admins cannot self-register.
 *
 *   ADMIN_EMAIL=ops@example.in ADMIN_NAME="Ops" ADMIN_PASSWORD='…' pnpm db:seed:admin
 */
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { hashPassword } from '../lib/password.js';
import { createDb } from './index.js';
import { users } from './schema.js';

const input = z
  .object({
    ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
    ADMIN_NAME: z.string().trim().min(1).default('Admin'),
    ADMIN_PASSWORD: z.string().min(12, 'ADMIN_PASSWORD must be at least 12 characters'),
  })
  .parse(process.env);

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
    .onConflictDoUpdate({ target: users.email, set: { passwordHash, role: 'admin', status: 'approved' } });
  process.stdout.write(`Admin ${input.ADMIN_EMAIL} is ready.\n`);
} finally {
  await pool.end();
}

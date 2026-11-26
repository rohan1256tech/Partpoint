import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const secret = z.string().min(32, 'must be at least 32 characters (use `openssl rand -base64 48`)');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    CORS_ORIGINS: csv,

    // Auth
    JWT_SECRET: secret,
    REFRESH_TOKEN_SECRET: secret,
    OTP_SECRET: secret,
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    /** Current privacy-policy version users consent to at signup (DPDP). */
    CONSENT_VERSION: z.string().min(1).default('2026-11-01'),

    // Play review demo accounts: these phones never receive an SMS and always use DEMO_OTP.
    DEMO_PHONES: csv,
    DEMO_OTP: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),

    // Messaging (optional in development: codes are written to the log instead)
    SMS_API_KEY: z.string().optional(),
    MAIL_API_KEY: z.string().optional(),
    MAIL_FROM: z.string().optional(),

    // Cloudflare R2 (images). Optional in development: upload URLs then return 503.
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_NAME: z.string().optional(),
    /** Public CDN base for images, e.g. https://img.example.in */
    R2_PUBLIC_URL: z.url().optional(),

    /** Firebase service-account JSON (raw or base64). Optional in development: pushes are logged instead. */
    FIREBASE_SERVICE_ACCOUNT: z.string().optional(),

    // Shown on the public privacy policy (DPDP Act: who is responsible and whom to contact).
    LEGAL_NAME: z.string().trim().min(2).max(200).optional(),
    LEGAL_ADDRESS: z.string().trim().min(5).max(500).optional(),
    GRIEVANCE_OFFICER: z.string().trim().min(2).max(100).optional(),
    PRIVACY_EMAIL: z.email().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.DEMO_PHONES.length > 0 && !env.DEMO_OTP) {
      ctx.addIssue({ code: 'custom', path: ['DEMO_OTP'], message: 'required when DEMO_PHONES is set' });
    }
    const secrets = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'OTP_SECRET'] as const;
    if (new Set(secrets.map((k) => env[k])).size !== secrets.length) {
      ctx.addIssue({ code: 'custom', path: ['OTP_SECRET'], message: 'auth secrets must all be different' });
    }
    if (env.NODE_ENV === 'production') {
      for (const key of secrets) {
        if (env[key].includes('replace-me')) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'placeholder secret used in production' });
        }
      }
      for (const key of [
        'SMS_API_KEY',
        'MAIL_API_KEY',
        'MAIL_FROM',
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET_NAME',
        'R2_PUBLIC_URL',
        'FIREBASE_SERVICE_ACCOUNT',
        'LEGAL_NAME',
        'LEGAL_ADDRESS',
        'GRIEVANCE_OFFICER',
        'PRIVACY_EMAIL',
      ] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Parses and validates environment variables. Fails fast on startup if anything is missing. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // `KEY=` in a .env file means "not set", so optional values and defaults apply.
  const defined = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = EnvSchema.safeParse(defined);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

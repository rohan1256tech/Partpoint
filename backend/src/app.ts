import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Env } from './config/env.js';
import type { Database } from './db/index.js';
import { AppError } from './lib/errors.js';
import { createMessaging, type Messaging } from './lib/messaging.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { OtpService } from './modules/auth/otp.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { TokenSigner } from './modules/auth/tokens.js';
import { healthRoutes, type HealthChecks } from './modules/health/health.routes.js';
import { adminUserRoutes, meRoutes } from './modules/users/users.routes.js';
import { UsersService } from './modules/users/users.service.js';
import { createAuthGuard } from './plugins/auth.js';

export interface AppDeps {
  env: Env;
  db: Database;
  checks: HealthChecks;
  /** Overrides the SMS/email senders (tests). */
  messaging?: Messaging;
}

export async function buildApp({ env, db, checks, messaging }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
      // Never log credentials or OTPs.
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.otp',
        '*.code',
        '*.password',
        '*.newPassword',
        '*.refreshToken',
        '*.registrationToken',
      ],
    },
    // Behind Cloudflare + Caddy: trust the proxy chain for the client IP.
    trustProxy: true,
    bodyLimit: 1024 * 1024, // 1 MB; images go directly to R2, never through the API
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: ctx.statusCode,
      code: 'RATE_LIMITED',
      message: `Too many requests. Try again in ${ctx.after}`,
    }),
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    // Do not leak internal error details to clients.
    void reply.status(status).send({
      error: status >= 500 ? 'Internal Server Error' : error.message,
      code: status >= 500 ? 'INTERNAL' : (error.code ?? 'ERROR'),
      statusCode: status,
      ...(error instanceof AppError && error.details !== undefined ? { details: error.details } : {}),
    });
  });

  // ---- composition root
  const signer = new TokenSigner(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
  const sessions = new SessionService(db, signer, env.REFRESH_TOKEN_SECRET, env.REFRESH_TOKEN_TTL_DAYS);
  const otp = new OtpService(db, {
    secret: env.OTP_SECRET,
    demoTargets: new Set(env.DEMO_PHONES),
    ...(env.DEMO_OTP ? { demoCode: env.DEMO_OTP } : {}),
  });
  const auth = new AuthService(
    db,
    otp,
    sessions,
    signer,
    messaging ?? createMessaging(env, app.log),
    env.CONSENT_VERSION,
    app.log,
  );
  const users = new UsersService(db, sessions);
  const authenticate = createAuthGuard(db, signer);

  await app.register(healthRoutes, { checks });
  await app.register(authRoutes, { prefix: '/v1/auth', auth });
  await app.register(meRoutes, { prefix: '/v1', users, authenticate });
  await app.register(adminUserRoutes, { prefix: '/v1/admin/users', users, authenticate });

  return app;
}

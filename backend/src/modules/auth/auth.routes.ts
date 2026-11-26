import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { unauthorized } from '../../lib/errors.js';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import {
  deviceIdSchema,
  emailLoginBody,
  emailOnlyBody,
  emailVerifyBody,
  otpRequestBody,
  otpVerifyBody,
  passwordResetBody,
  registerEmailBody,
  registerPhoneBody,
} from './auth.schemas.js';
import type { AuthService, RequestMeta } from './auth.service.js';
import type { TokenPair } from './session.service.js';

/**
 * The admin panel is a web app: its refresh token lives in an httpOnly cookie that page
 * scripts cannot read, scoped to the auth endpoints. The mobile apps keep the token in the
 * response body (stored in the Android Keystore).
 */
export const ADMIN_REFRESH_COOKIE = 'pp_admin_rt';
const COOKIE_PATH = '/v1/auth';

export interface AuthRouteOptions {
  auth: AuthService;
  /** Secure cookies (HTTPS only) outside local development. */
  secureCookies: boolean;
  refreshTtlDays: number;
}

const meta = (req: FastifyRequest): RequestMeta => {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, ...(ua ? { userAgent: ua.slice(0, 300) } : {}) };
};

/** Per-IP limits on top of the per-phone/email limits enforced in OtpService. */
const limit = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });

/** Mounted at /v1/auth. */
export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { auth, secureCookies, refreshTtlDays }) => {
  /** Puts the refresh token in the admin cookie and returns the tokens without it. */
  const toCookie = (reply: FastifyReply, tokens: TokenPair): Omit<TokenPair, 'refreshToken'> => {
    void reply.setCookie(ADMIN_REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: refreshTtlDays * 86_400,
    });
    const { refreshToken: _inCookie, ...rest } = tokens;
    return rest;
  };

  /** Sign-in results: for the admin app, the refresh token goes to the cookie instead of the body. */
  const deliver = <T extends object>(reply: FastifyReply, result: T, client: string) =>
    client === 'admin' && 'tokens' in result
      ? { ...result, tokens: toCookie(reply, (result as { tokens: TokenPair }).tokens) }
      : result;

  // ---- phone OTP (primary login for all mobile users)
  app.post('/otp/request', limit(10, '10 minutes'), async (req, reply) => {
    const { phone } = parse(otpRequestBody, req.body);
    await auth.requestPhoneOtp(phone, meta(req));
    return reply.status(202).send({ sent: true });
  });

  app.post('/otp/verify', limit(20, '10 minutes'), async (req) => {
    return auth.verifyPhoneOtp(parse(otpVerifyBody, req.body), meta(req));
  });

  app.post('/register/phone', limit(10, '1 hour'), async (req, reply) => {
    const result = await auth.registerWithPhone(parse(registerPhoneBody, req.body), meta(req));
    return reply.status(201).send(result);
  });

  // ---- email + password
  app.post('/register/email', limit(10, '1 hour'), async (req, reply) => {
    const user = await auth.registerWithEmail(parse(registerEmailBody, req.body), meta(req));
    return reply.status(201).send({ user, emailVerificationRequired: true });
  });

  app.post('/email/verify/request', limit(10, '1 hour'), async (req, reply) => {
    await auth.requestEmailVerification(parse(emailOnlyBody, req.body).email, meta(req));
    return reply.status(202).send({ sent: true });
  });

  app.post('/email/verify', limit(20, '10 minutes'), async (req) => {
    return auth.verifyEmail(parse(emailVerifyBody, req.body), meta(req));
  });

  app.post('/login/email', limit(10, '15 minutes'), async (req, reply) => {
    const input = parse(emailLoginBody, req.body);
    return deliver(reply, await auth.loginWithEmail(input, meta(req)), input.app);
  });

  app.post('/login/totp', limit(10, '10 minutes'), async (req, reply) => {
    const input = parse(
      z.object({
        challengeToken: z.string().min(1).max(2000),
        code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
        deviceId: deviceIdSchema,
      }),
      req.body,
    );
    return deliver(reply, await auth.loginWithTotp(input, meta(req)), 'admin');
  });

  app.post('/password/forgot', limit(5, '1 hour'), async (req, reply) => {
    await auth.forgotPassword(parse(emailOnlyBody, req.body).email, meta(req));
    return reply.status(202).send({ sent: true });
  });

  app.post('/password/reset', limit(10, '1 hour'), async (req, reply) => {
    await auth.resetPassword(parse(passwordResetBody, req.body), meta(req));
    return reply.status(204).send();
  });

  // ---- sessions
  // Mobile apps send the token in the body; the admin panel's comes from its cookie.
  app.post('/token/refresh', limit(60, '1 minute'), async (req, reply) => {
    const body = parse(z.object({ refreshToken: z.string().min(1).max(512).optional(), deviceId: deviceIdSchema }), req.body);
    const fromCookie = req.cookies[ADMIN_REFRESH_COOKIE];
    const token = body.refreshToken ?? fromCookie;
    if (!token) throw unauthorized('INVALID_REFRESH_TOKEN', 'Session expired. Please sign in again');
    const tokens = await auth.refresh(token, body.deviceId, meta(req));
    return body.refreshToken ? tokens : toCookie(reply, tokens);
  });

  app.post('/logout', async (req, reply) => {
    const body = parse(z.object({ refreshToken: z.string().min(1).max(512).optional() }), req.body ?? {});
    const token = body.refreshToken ?? req.cookies[ADMIN_REFRESH_COOKIE];
    if (token) await auth.logout(token);
    void reply.clearCookie(ADMIN_REFRESH_COOKIE, { path: COOKIE_PATH });
    return reply.status(204).send();
  });
};

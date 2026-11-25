import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { parse } from '../../lib/validate.js';
import {
  emailLoginBody,
  emailOnlyBody,
  emailVerifyBody,
  logoutBody,
  otpRequestBody,
  otpVerifyBody,
  passwordResetBody,
  refreshBody,
  registerEmailBody,
  registerPhoneBody,
} from './auth.schemas.js';
import type { AuthService, RequestMeta } from './auth.service.js';

const meta = (req: FastifyRequest): RequestMeta => {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, ...(ua ? { userAgent: ua.slice(0, 300) } : {}) };
};

/** Per-IP limits on top of the per-phone/email limits enforced in OtpService. */
const limit = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });

/** Mounted at /v1/auth. */
export const authRoutes: FastifyPluginAsync<{ auth: AuthService }> = async (app, { auth }) => {
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

  app.post('/login/email', limit(10, '15 minutes'), async (req) => {
    return auth.loginWithEmail(parse(emailLoginBody, req.body), meta(req));
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
  app.post('/token/refresh', limit(60, '1 minute'), async (req) => {
    const { refreshToken, deviceId } = parse(refreshBody, req.body);
    return auth.refresh(refreshToken, deviceId, meta(req));
  });

  app.post('/logout', async (req, reply) => {
    await auth.logout(parse(logoutBody, req.body).refreshToken);
    return reply.status(204).send();
  });
};

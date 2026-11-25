import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../config/env.js';

export interface SmsSender {
  /** Sends a one-time code to an E.164 phone number. */
  sendOtp(phone: string, code: string): Promise<void>;
}

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export interface Messaging {
  sms: SmsSender;
  mail: Mailer;
}

const TIMEOUT_MS = 5000;

/** Fast2SMS OTP route. Expects Indian numbers (+91XXXXXXXXXX). */
export class Fast2SmsSender implements SmsSender {
  constructor(private readonly apiKey: string) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    if (!phone.startsWith('+91')) throw new Error('Fast2SMS supports Indian numbers only');
    const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: { authorization: this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ route: 'otp', variables_values: code, numbers: phone.slice(3) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Fast2SMS responded ${res.status}`);
  }
}

/** Resend transactional email API. */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(to: string, subject: string, text: string): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [to], subject, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
  }
}

/** Development only: writes messages to the log instead of sending them. */
class LogMessaging implements SmsSender, Mailer {
  constructor(private readonly log: FastifyBaseLogger) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    this.log.warn({ phone, devCode: code }, 'DEV SMS (not sent)');
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    this.log.warn({ to, subject, text }, 'DEV EMAIL (not sent)');
  }
}

export function createMessaging(env: Env, log: FastifyBaseLogger): Messaging {
  const dev = new LogMessaging(log);
  if (env.NODE_ENV === 'production' && (!env.SMS_API_KEY || !env.MAIL_API_KEY || !env.MAIL_FROM)) {
    // loadEnv already enforces this; guard again so a log sender can never run in production.
    throw new Error('SMS and mail providers must be configured in production');
  }
  return {
    sms: env.SMS_API_KEY ? new Fast2SmsSender(env.SMS_API_KEY) : dev,
    mail: env.MAIL_API_KEY && env.MAIL_FROM ? new ResendMailer(env.MAIL_API_KEY, env.MAIL_FROM) : dev,
  };
}

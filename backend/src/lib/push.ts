import type { FastifyBaseLogger } from 'fastify';
import { importPKCS8, SignJWT } from 'jose';

/** Order updates go to the "orders" channel; everything else (approvals, announcements) to "general". */
export function androidChannel(data: Record<string, string>): 'orders' | 'general' {
  return data.type === 'order' ? 'orders' : 'general';
}

export interface PushMessage {
  title: string;
  body: string;
  /** Deep-link data for the app, e.g. { type: 'order', orderId }. */
  data: Record<string, string>;
}

/** 'invalid_token' means the app was uninstalled or the token rotated; the caller should forget it. */
export type PushResult = 'sent' | 'invalid_token';

export interface PushSender {
  send(token: string, message: PushMessage): Promise<PushResult>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Accepts the service-account JSON as-is or base64-encoded (easier to store in CI secrets). */
export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(text) as Partial<ServiceAccount>;
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key');
  }
  return sa as ServiceAccount;
}

/** Firebase Cloud Messaging HTTP v1 API, authenticated with a Google service account. */
export class FcmSender implements PushSender {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly sa: ServiceAccount) {}

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const key = await importPKCS8(this.sa.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.sa.client_email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Google token endpoint responded ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async send(token: string, message: PushMessage): Promise<PushResult> {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body },
          data: message.data,
          // Channel ids match the Android apps' notification channels (users can mute each one).
          android: { priority: 'high', notification: { channel_id: androidChannel(message.data) } },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return 'sent';
    const text = await res.text().catch(() => '');
    if (res.status === 404 || text.includes('UNREGISTERED') || text.includes('registration token is not a valid')) {
      return 'invalid_token';
    }
    throw new Error(`FCM responded ${res.status}: ${text.slice(0, 300)}`);
  }
}

/** Development: logs pushes instead of sending them. */
export class LogPushSender implements PushSender {
  constructor(private readonly log: FastifyBaseLogger) {}
  async send(token: string, message: PushMessage): Promise<PushResult> {
    this.log.info({ token: `${token.slice(0, 8)}…`, ...message }, 'DEV PUSH (not sent)');
    return 'sent';
  }
}

export function createPushSender(env: { NODE_ENV: string; FIREBASE_SERVICE_ACCOUNT?: string | undefined }, log: FastifyBaseLogger): PushSender {
  if (env.FIREBASE_SERVICE_ACCOUNT) return new FcmSender(parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT));
  if (env.NODE_ENV === 'production') throw new Error('FIREBASE_SERVICE_ACCOUNT must be set in production');
  return new LogPushSender(log);
}

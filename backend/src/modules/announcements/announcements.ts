import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import { auditLogs, pushTokens, users } from '../../db/schema.js';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';
import type { NotificationService } from '../notifications/notifications.service.js';

const AUDIENCES = ['retailer', 'wholesaler', 'delivery', 'all'] as const;
type Audience = (typeof AUDIENCES)[number];

export const announcementBody = z.object({
  audience: z.enum(AUDIENCES),
  // Short enough to show in full on a lock screen.
  title: z.string().trim().min(3).max(60),
  body: z.string().trim().min(3).max(200),
});

export interface Announcement {
  id: string;
  audience: Audience;
  title: string;
  body: string;
  recipients: number;
  devices: number;
  sentAt: string;
}

/**
 * Admin announcements: a push to every approved user of a role (or everyone). History is the
 * audit log itself, so there is one record of who sent what to whom.
 */
export class AnnouncementService {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationService,
  ) {}

  async send(adminId: string, input: z.infer<typeof announcementBody>, ip: string): Promise<Announcement> {
    const roles = input.audience === 'all' ? (['retailer', 'wholesaler', 'delivery'] as const) : ([input.audience] as const);
    const recipients = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.status, 'approved'), isNull(users.deletedAt), inArray(users.role, [...roles])));
    const ids = recipients.map((r) => r.id);
    const devices = ids.length
      ? (await this.db.select({ token: pushTokens.token }).from(pushTokens).where(inArray(pushTokens.userId, ids))).length
      : 0;

    const data = { audience: input.audience, title: input.title, body: input.body, recipients: ids.length, devices };
    // Recorded in the audit log, which is also the announcement history.
    const [row] = await this.db
      .insert(auditLogs)
      .values({ actorId: adminId, action: 'announcement.send', entity: 'announcement', data, ip })
      .returning({ id: auditLogs.id, at: auditLogs.createdAt });
    if (ids.length) {
      this.notifications.notifyUsers(ids, { title: input.title, body: input.body, data: { type: 'announcement' } });
    }
    return { id: String(row?.id), ...input, recipients: ids.length, devices, sentAt: (row?.at ?? new Date()).toISOString() };
  }

  async history(limit = 50): Promise<Announcement[]> {
    const rows = await this.db
      .select({ id: auditLogs.id, data: auditLogs.data, at: auditLogs.createdAt })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'announcement.send'))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
    return rows.map((r) => {
      const d = (r.data ?? {}) as Partial<Announcement>;
      return {
        id: String(r.id),
        audience: (d.audience ?? 'all') as Audience,
        title: d.title ?? '',
        body: d.body ?? '',
        recipients: d.recipients ?? 0,
        devices: d.devices ?? 0,
        sentAt: r.at.toISOString(),
      };
    });
  }
}

/** Mounted at /v1/admin/announcements. */
export const adminAnnouncementRoutes: FastifyPluginAsync<{ announcements: AnnouncementService; authenticate: Authenticate }> = async (
  app,
  { announcements, authenticate },
) => {
  app.addHook('preHandler', authenticate({ roles: ['admin'] }));
  app.get('/', async () => ({ items: await announcements.history() }));
  // A few per hour is plenty; this stops an accidental double-send storm.
  app.post('/', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req: FastifyRequest, reply) =>
    reply.status(201).send(await announcements.send(currentUser(req).id, parse(announcementBody, req.body), req.ip)),
  );
};

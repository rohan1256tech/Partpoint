import { and, desc, eq, isNull, lt, or, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { deliveryProfiles, retailerProfiles, users, wholesalerProfiles } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { conflict, notFound } from '../../lib/errors.js';
import { toPublicUser, type PublicUser } from '../auth/auth.service.js';
import type { SessionService } from '../auth/session.service.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { Role } from '../auth/tokens.js';

type Status = 'pending' | 'approved' | 'blocked';

export interface UserWithProfile extends PublicUser {
  profile: Record<string, unknown> | null;
  statusReason: string | null;
}

export interface ListUsersQuery {
  status?: Status;
  role?: Exclude<Role, 'admin'>;
  limit: number;
  cursor?: string;
}

export class UsersService {
  constructor(
    private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly notifications: NotificationService,
  ) {}

  async getWithProfile(userId: string): Promise<UserWithProfile> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));
    if (!user) throw notFound('USER_NOT_FOUND', 'User not found');
    return { ...toPublicUser(user), statusReason: user.statusReason, profile: await this.profile(user.id, user.role) };
  }

  private async profile(userId: string, role: Role): Promise<Record<string, unknown> | null> {
    const pick = async <T extends Record<string, unknown>>(rows: Promise<T[]>) => {
      const [row] = await rows;
      if (!row) return null;
      const { userId: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
      return rest;
    };
    switch (role) {
      case 'retailer':
        return pick(this.db.select().from(retailerProfiles).where(eq(retailerProfiles.userId, userId)));
      case 'wholesaler':
        return pick(this.db.select().from(wholesalerProfiles).where(eq(wholesalerProfiles.userId, userId)));
      case 'delivery': {
        // Live location is operational data, not part of the profile.
        const p = await pick(this.db.select().from(deliveryProfiles).where(eq(deliveryProfiles.userId, userId)));
        if (!p) return null;
        const { lastLatitude: _a, lastLongitude: _b, lastLocationAt: _c, ...rest } = p;
        return rest;
      }
      case 'admin':
        return null;
    }
  }

  /** Newest first, keyset-paginated. Admin accounts are never listed. */
  async list(q: ListUsersQuery): Promise<{ items: PublicUser[]; nextCursor: string | null }> {
    const filters: (SQL | undefined)[] = [isNull(users.deletedAt)];
    if (q.status) filters.push(eq(users.status, q.status));
    filters.push(q.role ? eq(users.role, q.role) : or(...(['retailer', 'wholesaler', 'delivery'] as const).map((r) => eq(users.role, r))));
    if (q.cursor) {
      const { createdAt, id } = decodeCursor(q.cursor);
      filters.push(or(lt(users.createdAt, createdAt), and(eq(users.createdAt, createdAt), lt(users.id, id))));
    }
    const rows = await this.db
      .select()
      .from(users)
      .where(and(...filters))
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(q.limit + 1);

    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map(toPublicUser),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async setStatus(
    adminId: string,
    userId: string,
    next: Status,
    reason: string | null,
    ip: string,
  ): Promise<UserWithProfile> {
    await this.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id, role: users.role, status: users.status })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .for('update');
      if (!user || user.role === 'admin') throw notFound('USER_NOT_FOUND', 'User not found');

      const allowed: Record<Status, Status[]> = {
        pending: [],
        approved: ['pending', 'blocked'],
        blocked: ['pending', 'approved'],
      };
      if (!allowed[next].includes(user.status)) {
        throw conflict('INVALID_STATUS_TRANSITION', `Cannot change a ${user.status} user to ${next}`);
      }

      await tx
        .update(users)
        .set({
          status: next,
          statusReason: reason,
          ...(next === 'approved' ? { approvedBy: adminId, approvedAt: new Date() } : {}),
        })
        .where(eq(users.id, userId));
      // Blocking ends every session at once; the auth guard rejects in-flight access tokens too.
      if (next === 'blocked') await this.sessions.revokeAllForUser(userId, tx);
      await audit(tx, {
        actorId: adminId,
        action: next === 'approved' ? (user.status === 'blocked' ? 'user.unblock' : 'user.approve') : 'user.block',
        entity: 'user',
        entityId: userId,
        data: { from: user.status, to: next, ...(reason ? { reason } : {}) },
        ip,
      });
    });
    if (next === 'approved') {
      this.notifications.notifyUsers([userId], {
        title: 'Account approved',
        body: 'Your Partpoint account is approved. You can start using the app now.',
        data: { type: 'account', status: 'approved' },
      });
    }
    return this.getWithProfile(userId);
  }
}


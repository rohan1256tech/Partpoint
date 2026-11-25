import type { Database } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

type Executor = Pick<Database, 'insert'>;

export interface AuditEntry {
  actorId: string | null;
  action: string; // e.g. 'user.approve'
  entity: string; // e.g. 'user'
  entityId?: string;
  data?: Record<string, unknown>;
  ip?: string;
}

/** Records an admin or security-relevant action. Pass a transaction to make it atomic with the change. */
export async function audit(db: Executor, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    data: entry.data ?? null,
    ip: entry.ip ?? null,
  });
}

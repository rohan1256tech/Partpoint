import { z } from 'zod';
import type { Database } from '../../db/index.js';
import { settings } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';

/** Platform-wide settings, editable by the admin. Every key has a safe default. */
export const SettingsSchema = z.object({
  /** Platform commission on goods value, in basis points (500 = 5%). A wholesaler can have an override. */
  commissionBps: z.number().int().min(0).max(5000),
  /** Delivery fee charged per wholesaler order, in paise. */
  deliveryFeePaise: z.number().int().min(0).max(100_000),
  /** Smallest order value per wholesaler, in paise (0 = no minimum). */
  minOrderPaise: z.number().int().min(0).max(10_000_000),
});
export type PlatformSettings = z.infer<typeof SettingsSchema>;
export const settingsPatch = SettingsSchema.partial().strict();

export const DEFAULT_SETTINGS: PlatformSettings = {
  commissionBps: 500,
  deliveryFeePaise: 0,
  minOrderPaise: 0,
};

const CACHE_MS = 60_000;

export class SettingsService {
  private cache: { at: number; value: PlatformSettings } | null = null;

  constructor(private readonly db: Database) {}

  async get(): Promise<PlatformSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const rows = await this.db.select().from(settings);
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const merged = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...stored });
    const value = merged.success ? merged.data : DEFAULT_SETTINGS;
    this.cache = { at: Date.now(), value };
    return value;
  }

  async update(adminId: string, patch: Partial<PlatformSettings>, ip: string): Promise<PlatformSettings> {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    await this.db.transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx
          .insert(settings)
          .values({ key, value, updatedBy: adminId })
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: adminId } });
      }
      await audit(tx, { actorId: adminId, action: 'settings.update', entity: 'settings', data: patch, ip });
    });
    this.cache = null;
    return this.get();
  }
}

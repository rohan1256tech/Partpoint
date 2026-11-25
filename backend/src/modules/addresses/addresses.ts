import { and, asc, count, desc, eq, ne } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import { addresses } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';
import { phoneSchema } from '../auth/auth.schemas.js';

export const MAX_ADDRESSES = 10;

const text = (max: number) => z.string().trim().min(1).max(max);
const addressFields = {
  label: text(30).default('Shop'),
  contactName: text(100),
  contactPhone: phoneSchema,
  line1: text(200),
  line2: text(200).optional(),
  landmark: text(100).optional(),
  city: text(80),
  state: text(80),
  pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isDefault: z.boolean().default(false),
};
export const addressCreate = z.object(addressFields);
export const addressUpdate = z
  .object({
    ...addressFields,
    label: text(30),
    line2: text(200).nullable(),
    landmark: text(100).nullable(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    isDefault: z.boolean(),
  })
  .partial();

type AddressRow = typeof addresses.$inferSelect;

/** Frozen copy stored on orders, so later edits never change a placed order. */
export interface AddressSnapshot {
  contactName: string;
  contactPhone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
}

export function snapshotOf(a: AddressRow): AddressSnapshot {
  return {
    contactName: a.contactName,
    contactPhone: a.contactPhone,
    line1: a.line1,
    line2: a.line2,
    landmark: a.landmark,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    latitude: a.latitude,
    longitude: a.longitude,
  };
}

const view = (a: AddressRow) => {
  const { userId: _u, createdAt: _c, updatedAt: _up, ...rest } = a;
  return rest;
};

export class AddressesService {
  constructor(private readonly db: Database) {}

  async list(userId: string) {
    const rows = await this.db
      .select()
      .from(addresses)
      .where(eq(addresses.userId, userId))
      .orderBy(desc(addresses.isDefault), asc(addresses.createdAt));
    return rows.map(view);
  }

  /** Object-level authorization: only the owner's address is ever returned. */
  async getOwn(userId: string, id: string): Promise<AddressRow> {
    const [a] = await this.db
      .select()
      .from(addresses)
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)));
    if (!a) throw notFound('ADDRESS_NOT_FOUND', 'Address not found');
    return a;
  }

  async create(userId: string, input: z.infer<typeof addressCreate>) {
    return this.db.transaction(async (tx) => {
      const [n] = await tx.select({ n: count() }).from(addresses).where(eq(addresses.userId, userId));
      const existing = n?.n ?? 0;
      if (existing >= MAX_ADDRESSES) throw badRequest('TOO_MANY_ADDRESSES', `You can save up to ${MAX_ADDRESSES} addresses`);
      const isDefault = input.isDefault || existing === 0; // the first address is the default
      if (isDefault) await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
      const [row] = await tx
        .insert(addresses)
        .values({
          userId,
          ...input,
          line2: input.line2 ?? null,
          landmark: input.landmark ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          isDefault,
        })
        .returning();
      return view(row as AddressRow);
    });
  }

  async update(userId: string, id: string, input: z.infer<typeof addressUpdate>) {
    await this.getOwn(userId, id);
    return this.db.transaction(async (tx) => {
      if (input.isDefault) {
        await tx
          .update(addresses)
          .set({ isDefault: false })
          .where(and(eq(addresses.userId, userId), ne(addresses.id, id)));
      }
      const [row] = await tx
        .update(addresses)
        .set(input)
        .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
        .returning();
      return view(row as AddressRow);
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const a = await this.getOwn(userId, id);
    await this.db.transaction(async (tx) => {
      await tx.delete(addresses).where(eq(addresses.id, id));
      if (a.isDefault) {
        // Promote the oldest remaining address so there is always a default.
        const [next] = await tx
          .select({ id: addresses.id })
          .from(addresses)
          .where(eq(addresses.userId, userId))
          .orderBy(asc(addresses.createdAt))
          .limit(1);
        if (next) await tx.update(addresses).set({ isDefault: true }).where(eq(addresses.id, next.id));
      }
    });
  }
}

const idParams = z.object({ id: z.uuid() });

/** Mounted at /v1/me/addresses. Retailer delivery addresses. */
export const addressRoutes: FastifyPluginAsync<{ addresses: AddressesService; authenticate: Authenticate }> = async (
  app,
  { addresses: svc, authenticate },
) => {
  app.addHook('preHandler', authenticate({ roles: ['retailer'] }));
  const me = (req: Parameters<typeof currentUser>[0]) => currentUser(req).id;

  app.get('/', async (req) => ({ items: await svc.list(me(req)) }));
  app.post('/', async (req, reply) => reply.status(201).send(await svc.create(me(req), parse(addressCreate, req.body))));
  app.patch('/:id', async (req) =>
    svc.update(me(req), parse(idParams, req.params).id, parse(addressUpdate, req.body)),
  );
  app.delete('/:id', async (req, reply) => {
    await svc.remove(me(req), parse(idParams, req.params).id);
    return reply.status(204).send();
  });
};

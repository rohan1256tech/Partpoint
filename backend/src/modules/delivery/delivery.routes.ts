import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import { listOrdersQuery } from '../orders/orders.schemas.js';
import type { OrdersService } from '../orders/orders.service.js';
import type { DeliveryService } from './delivery.service.js';

interface Deps {
  delivery: DeliveryService;
  orders: OrdersService;
  notifications: NotificationService;
  authenticate: Authenticate;
}

const idParams = z.object({ id: z.uuid() });
const me = (req: FastifyRequest) => currentUser(req).id;
const id = (req: FastifyRequest) => parse(idParams, req.params).id;

/** Mounted at /v1/delivery. The delivery partner app. */
export const deliveryRoutes: FastifyPluginAsync<Deps> = async (app, { delivery, orders, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['delivery'] }));

  app.patch('/availability', async (req) =>
    delivery.setAvailability(me(req), parse(z.object({ isAvailable: z.boolean() }), req.body).isAvailable),
  );

  /** Packed orders no rider has taken: the first to take one gets it. */
  app.get('/jobs', async () => ({ items: await delivery.openJobs() }));
  app.post('/jobs/:id/take', async (req) => {
    await delivery.claim(me(req), id(req));
    return orders.get('delivery', me(req), id(req));
  });

  app.get('/orders', async (req) => orders.list('delivery', me(req), parse(listOrdersQuery, req.query)));
  app.get('/orders/:id', async (req) => orders.get('delivery', me(req), id(req)));

  app.post('/orders/:id/accept', async (req) => {
    await delivery.respond(me(req), id(req), true, null);
    return orders.get('delivery', me(req), id(req));
  });
  app.post('/orders/:id/decline', async (req, reply) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(300).optional() }), req.body ?? {});
    await delivery.respond(me(req), id(req), false, reason ?? null);
    return reply.status(204).send(); // no longer theirs to view
  });
  app.post('/orders/:id/pickup', async (req) => {
    await delivery.advance(me(req), id(req), 'picked_up');
    return orders.get('delivery', me(req), id(req));
  });
  app.post('/orders/:id/out-for-delivery', async (req) => {
    await delivery.advance(me(req), id(req), 'out_for_delivery');
    return orders.get('delivery', me(req), id(req));
  });
  app.post('/orders/:id/deliver', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const { otp } = parse(z.object({ otp: z.string().regex(/^\d{4}$/, 'Enter the 4-digit code') }), req.body);
    await delivery.deliver(me(req), id(req), otp);
    return orders.get('delivery', me(req), id(req));
  });

  app.get('/earnings', async (req) => delivery.earnings(me(req)));
};

/** Mounted at /v1/admin. Delivery partners and assignment. */
export const adminDeliveryRoutes: FastifyPluginAsync<Deps> = async (app, { delivery, orders, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['admin'] }));

  app.get('/delivery-partners', async (req) => {
    const { available } = parse(z.object({ available: z.enum(['true', 'false']).optional() }), req.query);
    return { items: await delivery.listPartners(available === 'true') };
  });
  app.post('/orders/:id/assign', async (req) => {
    const { deliveryPartnerId } = parse(z.object({ deliveryPartnerId: z.uuid() }), req.body);
    await delivery.assign(me(req), id(req), deliveryPartnerId, req.ip);
    return orders.get('admin', me(req), id(req));
  });
  app.post('/orders/:id/reset-delivery-otp', async (req) => {
    await delivery.resetOtpAttempts(me(req), id(req), req.ip);
    return orders.get('admin', me(req), id(req));
  });
};

/** Mounted at /v1/me. Device push tokens for any signed-in user (including those awaiting approval). */
export const pushTokenRoutes: FastifyPluginAsync<Deps> = async (app, { notifications, authenticate }) => {
  app.addHook('preHandler', authenticate({ allowPending: true }));
  const body = z.object({ token: z.string().trim().min(20).max(4096) });

  app.put('/push-token', async (req, reply) => {
    const user = currentUser(req);
    await notifications.registerToken(user.id, user.app, parse(body, req.body).token);
    return reply.status(204).send();
  });
  app.delete('/push-token', async (req, reply) => {
    await notifications.removeToken(me(req), parse(body, req.body).token);
    return reply.status(204).send();
  });
};

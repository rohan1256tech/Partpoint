import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';
import { settingsPatch, type SettingsService } from '../settings/settings.service.js';
import type { CartService } from './cart.service.js';
import {
  cartQuery,
  idParams,
  listOrdersQuery,
  optionalReasonBody,
  placeOrderBody,
  reasonBody,
  setQtyBody,
  variantParams,
} from './orders.schemas.js';
import type { OrdersService } from './orders.service.js';

interface Deps {
  cart: CartService;
  orders: OrdersService;
  settings: SettingsService;
  authenticate: Authenticate;
}

const me = (req: FastifyRequest) => currentUser(req).id;
const id = (req: FastifyRequest) => parse(idParams, req.params).id;

/** Mounted at /v1/cart. */
export const cartRoutes: FastifyPluginAsync<Deps> = async (app, { cart, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['retailer'] }));

  app.get('/', async (req) => cart.get(me(req), parse(cartQuery, req.query).couponCode));
  app.put('/items/:variantId', async (req) =>
    cart.setQty(me(req), parse(variantParams, req.params).variantId, parse(setQtyBody, req.body).qty),
  );
  app.delete('/items/:variantId', async (req) => cart.remove(me(req), parse(variantParams, req.params).variantId));
  app.delete('/', async (req, reply) => {
    await cart.clear(me(req));
    return reply.status(204).send();
  });
};

/** Mounted at /v1/orders. The retailer's orders. */
export const retailerOrderRoutes: FastifyPluginAsync<Deps> = async (app, { orders, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['retailer'] }));

  app.post('/', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) =>
    reply.status(201).send(await orders.place(me(req), parse(placeOrderBody, req.body))),
  );
  app.get('/', async (req) => orders.list('retailer', me(req), parse(listOrdersQuery, req.query)));
  app.get('/:id', async (req) => orders.get('retailer', me(req), id(req)));
  app.post('/:id/cancel', async (req) => {
    const { reason } = parse(optionalReasonBody, req.body ?? {});
    return orders.transition('retailer', me(req), id(req), 'cancelByRetailer', reason ?? 'Cancelled by retailer', req.ip);
  });
};

/** Mounted at /v1/wholesaler/orders. Orders the wholesaler has to fulfil. */
export const wholesalerOrderRoutes: FastifyPluginAsync<Deps> = async (app, { orders, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['wholesaler'] }));

  app.get('/', async (req) => orders.list('wholesaler', me(req), parse(listOrdersQuery, req.query)));
  app.get('/:id', async (req) => orders.get('wholesaler', me(req), id(req)));
  app.post('/:id/accept', async (req) => orders.transition('wholesaler', me(req), id(req), 'accept', null, req.ip));
  app.post('/:id/pack', async (req) => orders.transition('wholesaler', me(req), id(req), 'pack', null, req.ip));
  app.post('/:id/reject', async (req) =>
    orders.transition('wholesaler', me(req), id(req), 'reject', parse(reasonBody, req.body).reason, req.ip),
  );
};

/** Mounted at /v1/admin. All orders, and platform settings. */
export const adminOrderRoutes: FastifyPluginAsync<Deps> = async (app, { orders, settings, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['admin'] }));

  app.get('/orders', async (req) => orders.list('admin', me(req), parse(listOrdersQuery, req.query)));
  app.get('/orders/:id', async (req) => orders.get('admin', me(req), id(req)));
  app.post('/orders/:id/cancel', async (req) =>
    orders.transition('admin', me(req), id(req), 'cancelByAdmin', parse(reasonBody, req.body).reason, req.ip),
  );

  app.get('/settings', async () => settings.get());
  app.patch('/settings', async (req) => settings.update(me(req), parse(settingsPatch, req.body), req.ip));
};

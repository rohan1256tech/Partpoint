import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';
import type { UsersService } from './users.service.js';

interface Deps {
  users: UsersService;
  authenticate: Authenticate;
}

/** Mounted at /v1. The signed-in user's own account. */
export const meRoutes: FastifyPluginAsync<Deps> = async (app, { users, authenticate }) => {
  // Pending users may see their own profile (to show "awaiting approval").
  app.get('/me', { preHandler: authenticate({ allowPending: true }) }, async (req) => {
    return users.getWithProfile(currentUser(req).id);
  });
};

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'blocked']).optional(),
  role: z.enum(['retailer', 'wholesaler', 'delivery']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
const reasonBody = z.object({ reason: z.string().trim().min(1).max(500) });
const optionalReasonBody = z.object({ reason: z.string().trim().min(1).max(500).optional() }).default({});

/** Mounted at /v1/admin/users. User approval and blocking. */
export const adminUserRoutes: FastifyPluginAsync<Deps> = async (app, { users, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['admin'] }));

  app.get('/', async (req) => users.list(parse(listQuery, req.query)));

  app.get('/:id', async (req) => users.getWithProfile(parse(idParams, req.params).id));

  app.post('/:id/approve', async (req) => {
    const { id } = parse(idParams, req.params);
    const { reason } = parse(optionalReasonBody, req.body ?? {});
    return users.setStatus(currentUser(req).id, id, 'approved', reason ?? null, req.ip);
  });

  app.post('/:id/block', async (req) => {
    const { id } = parse(idParams, req.params);
    const { reason } = parse(reasonBody, req.body);
    return users.setStatus(currentUser(req).id, id, 'blocked', reason, req.ip);
  });
};

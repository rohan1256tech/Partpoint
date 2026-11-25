import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../../lib/validate.js';
import type { Storage } from '../../lib/storage.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';
import {
  adminProductsQuery,
  brandCreate,
  brandUpdate,
  browseQuery,
  categoryCreate,
  categoryUpdate,
  idParams,
  imageParams,
  ownProductsQuery,
  productCreate,
  productImageAttach,
  productImageUpload,
  productUpdate,
  reasonBody,
  uploadRequest,
  variantInput,
  variantParams,
  variantUpdate,
} from './catalog.schemas.js';
import type { ProductsService } from './products.service.js';
import type { TaxonomyService } from './taxonomy.service.js';

interface Deps {
  products: ProductsService;
  taxonomy: TaxonomyService;
  storage: Storage;
  authenticate: Authenticate;
}

/** Mounted at /v1. Browsing for approved business users (and admins). */
export const catalogRoutes: FastifyPluginAsync<Deps> = async (app, { products, taxonomy, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['retailer', 'wholesaler', 'admin'] }));

  app.get('/categories', async (_req, reply) => {
    void reply.header('cache-control', 'private, max-age=300');
    return { items: await taxonomy.categoryTree() };
  });

  app.get('/brands', async (_req, reply) => {
    void reply.header('cache-control', 'private, max-age=300');
    return { items: await taxonomy.activeBrands() };
  });

  app.get('/products', async (req) => products.browse(parse(browseQuery, req.query)));

  app.get('/products/:id', async (req) => products.getPublic(parse(idParams, req.params).id));
};

/** Mounted at /v1/wholesaler/products. A wholesaler's own catalog. */
export const wholesalerProductRoutes: FastifyPluginAsync<Deps> = async (app, { products, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['wholesaler'] }));
  const me = (req: Parameters<typeof currentUser>[0]) => currentUser(req).id;

  app.get('/', async (req) => products.listOwn(me(req), parse(ownProductsQuery, req.query)));

  app.post('/', async (req, reply) => {
    const product = await products.create(me(req), parse(productCreate, req.body));
    return reply.status(201).send(product);
  });

  app.get('/:id', async (req) => products.getOwn(me(req), parse(idParams, req.params).id));

  app.patch('/:id', async (req) =>
    products.update(me(req), parse(idParams, req.params).id, parse(productUpdate, req.body)),
  );

  app.post('/:id/publish', async (req) => products.setVisibility(me(req), parse(idParams, req.params).id, 'active'));
  app.post('/:id/hide', async (req) => products.setVisibility(me(req), parse(idParams, req.params).id, 'hidden'));

  app.post('/:id/variants', async (req, reply) => {
    const product = await products.addVariant(me(req), parse(idParams, req.params).id, parse(variantInput, req.body));
    return reply.status(201).send(product);
  });

  app.patch('/variants/:variantId', async (req) =>
    products.updateVariant(me(req), parse(variantParams, req.params).variantId, parse(variantUpdate, req.body)),
  );

  app.post('/:id/images/upload-url', async (req) => {
    const { sizeBytes } = parse(productImageUpload, req.body);
    return products.imageUploadUrl(me(req), parse(idParams, req.params).id, sizeBytes);
  });

  app.post('/:id/images', async (req, reply) => {
    const { objectKey } = parse(productImageAttach, req.body);
    return reply.status(201).send(await products.attachImage(me(req), parse(idParams, req.params).id, objectKey));
  });

  app.delete('/:id/images/:imageId', async (req) => {
    const { id, imageId } = parse(imageParams, req.params);
    return products.removeImage(me(req), id, imageId);
  });
};

/** Mounted at /v1/admin. Taxonomy, product moderation and admin image uploads. */
export const adminCatalogRoutes: FastifyPluginAsync<Deps> = async (
  app,
  { products, taxonomy, storage, authenticate },
) => {
  app.addHook('preHandler', authenticate({ roles: ['admin'] }));
  const adminId = (req: Parameters<typeof currentUser>[0]) => currentUser(req).id;

  // ---- categories
  app.get('/categories', async () => ({ items: await taxonomy.listAllCategories() }));
  app.post('/categories', async (req, reply) =>
    reply.status(201).send(await taxonomy.createCategory(adminId(req), parse(categoryCreate, req.body), req.ip)),
  );
  app.patch('/categories/:id', async (req) =>
    taxonomy.updateCategory(adminId(req), parse(idParams, req.params).id, parse(categoryUpdate, req.body), req.ip),
  );

  // ---- brands
  app.get('/brands', async () => ({ items: await taxonomy.listAllBrands() }));
  app.post('/brands', async (req, reply) =>
    reply.status(201).send(await taxonomy.createBrand(adminId(req), parse(brandCreate, req.body), req.ip)),
  );
  app.patch('/brands/:id', async (req) =>
    taxonomy.updateBrand(adminId(req), parse(idParams, req.params).id, parse(brandUpdate, req.body), req.ip),
  );

  // ---- products
  app.get('/products', async (req) => products.listAll(parse(adminProductsQuery, req.query)));
  app.get('/products/:id', async (req) => products.getAny(parse(idParams, req.params).id));
  app.post('/products/:id/block', async (req) => {
    const { reason } = parse(reasonBody, req.body);
    return products.moderate(adminId(req), parse(idParams, req.params).id, 'block', reason, req.ip);
  });
  app.post('/products/:id/unblock', async (req) =>
    products.moderate(adminId(req), parse(idParams, req.params).id, 'unblock', null, req.ip),
  );

  // ---- uploads (category images, brand logos, banners)
  app.post('/uploads', async (req) => {
    const { kind, contentType, sizeBytes } = parse(uploadRequest, req.body);
    const objectKey = `${kind}/${crypto.randomUUID()}.webp`;
    return { objectKey, upload: storage.presignUpload(objectKey, contentType, sizeBytes) };
  });
};

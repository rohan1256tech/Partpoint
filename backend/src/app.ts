import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Env } from './config/env.js';
import type { Database } from './db/index.js';
import { AppError } from './lib/errors.js';
import { createMessaging, type Messaging } from './lib/messaging.js';
import { createPushSender, type PushSender } from './lib/push.js';
import { createStorage, type Storage } from './lib/storage.js';
import { adminDeliveryRoutes, deliveryRoutes, pushTokenRoutes } from './modules/delivery/delivery.routes.js';
import { DeliveryService } from './modules/delivery/delivery.service.js';
import { NotificationService } from './modules/notifications/notifications.service.js';
import {
  adminInvoiceRoutes,
  InvoicesService,
  retailerInvoiceRoutes,
  wholesalerInvoiceRoutes,
} from './modules/invoices/invoices.js';
import { AccountService, accountRoutes, adminAccountRoutes, publicAccountRoutes } from './modules/account/account.js';
import { adminFinanceRoutes, FinanceService, wholesalerFinanceRoutes } from './modules/finance/finance.js';
import { AnnouncementService, adminAnnouncementRoutes } from './modules/announcements/announcements.js';
import { adminMarketingRoutes, bannerRoutes, MarketingService } from './modules/marketing/marketing.js';
import { adminReportRoutes, ReportsService, wholesalerReportRoutes } from './modules/reports/reports.js';
import { adminReviewRoutes, reviewRoutes, ReviewsService } from './modules/reviews/reviews.js';
import { adminCatalogRoutes, catalogRoutes, wholesalerProductRoutes } from './modules/catalog/catalog.routes.js';
import { ProductsService } from './modules/catalog/products.service.js';
import { TaxonomyService } from './modules/catalog/taxonomy.service.js';
import { addressRoutes, AddressesService } from './modules/addresses/addresses.js';
import { CartService } from './modules/orders/cart.service.js';
import { CouponsService } from './modules/orders/coupons.service.js';
import {
  adminOrderRoutes,
  cartRoutes,
  retailerOrderRoutes,
  wholesalerOrderRoutes,
} from './modules/orders/orders.routes.js';
import { OrdersService } from './modules/orders/orders.service.js';
import { SettingsService } from './modules/settings/settings.service.js';
import { WishlistService, wishlistRoutes } from './modules/wishlist/wishlist.js';
import { SecretBox } from './lib/totp.js';
import { AdminMfaService, adminMfaRoutes } from './modules/auth/admin-mfa.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { OtpService } from './modules/auth/otp.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { TokenSigner } from './modules/auth/tokens.js';
import { healthRoutes, type HealthChecks } from './modules/health/health.routes.js';
import { adminUserRoutes, meRoutes } from './modules/users/users.routes.js';
import { UsersService } from './modules/users/users.service.js';
import { createAuthGuard } from './plugins/auth.js';

export interface AppDeps {
  env: Env;
  db: Database;
  checks: HealthChecks;
  /** Overrides the SMS/email senders (tests). */
  messaging?: Messaging;
  /** Overrides image storage (tests). */
  storage?: Storage;
  /** Overrides the push sender (tests). */
  push?: PushSender;
}

export async function buildApp({ env, db, checks, messaging, storage, push }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? (process.env.TEST_LOG ?? 'silent') : env.LOG_LEVEL,
      // Never log credentials or OTPs.
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.otp',
        '*.code',
        '*.password',
        '*.newPassword',
        '*.refreshToken',
        '*.registrationToken',
      ],
    },
    // Behind Cloudflare + Caddy: trust the proxy chain for the client IP.
    trustProxy: true,
    bodyLimit: 1024 * 1024, // 1 MB; images go directly to R2, never through the API
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: ctx.statusCode,
      code: 'RATE_LIMITED',
      message: `Too many requests. Try again in ${ctx.after}`,
    }),
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    // AppErrors are written for clients (including deliberate 503s). Anything else may carry
    // internal details, so unexpected server errors are reduced to a generic message.
    const expose = error instanceof AppError || status < 500;
    void reply.status(status).send({
      error: expose ? error.message : 'Internal Server Error',
      code: expose ? (error.code ?? 'ERROR') : 'INTERNAL',
      statusCode: status,
      ...(error instanceof AppError && error.details !== undefined ? { details: error.details } : {}),
    });
  });

  // ---- composition root
  const signer = new TokenSigner(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
  const sessions = new SessionService(db, signer, env.REFRESH_TOKEN_SECRET, env.REFRESH_TOKEN_TTL_DAYS);
  const otp = new OtpService(db, {
    secret: env.OTP_SECRET,
    demoTargets: new Set(env.DEMO_PHONES),
    ...(env.DEMO_OTP ? { demoCode: env.DEMO_OTP } : {}),
  });
  const secretBox = new SecretBox(env.OTP_SECRET);
  const auth = new AuthService(
    db,
    otp,
    sessions,
    signer,
    messaging ?? createMessaging(env, app.log),
    env.CONSENT_VERSION,
    app.log,
    secretBox,
  );
  const notifications = new NotificationService(db, push ?? createPushSender(env, app.log), app.log);
  app.decorate('notifications', notifications);
  app.addHook('onClose', () => notifications.idle()); // let queued pushes finish on shutdown
  const users = new UsersService(db, sessions, notifications);
  const authenticate = createAuthGuard(db, signer);
  const images = storage ?? createStorage(env);
  const catalog = {
    products: new ProductsService(db, images),
    taxonomy: new TaxonomyService(db, images),
    storage: images,
    authenticate,
  };

  await app.register(healthRoutes, { checks });
  await app.register(authRoutes, {
    prefix: '/v1/auth',
    auth,
    secureCookies: env.NODE_ENV === 'production',
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  });
  await app.register(meRoutes, { prefix: '/v1', users, authenticate });
  await app.register(adminUserRoutes, { prefix: '/v1/admin/users', users, authenticate });
  await app.register(adminMfaRoutes, {
    prefix: '/v1/admin/2fa',
    mfa: new AdminMfaService(db, secretBox, sessions),
    authenticate,
  });
  await app.register(catalogRoutes, { prefix: '/v1', ...catalog });
  await app.register(wholesalerProductRoutes, { prefix: '/v1/wholesaler/products', ...catalog });
  await app.register(adminCatalogRoutes, { prefix: '/v1/admin', ...catalog });

  const settings = new SettingsService(db);
  const addresses = new AddressesService(db);
  const coupons = new CouponsService();
  const cart = new CartService(db, images, settings, coupons);
  const shopping = {
    cart,
    orders: new OrdersService(db, cart, addresses, coupons, settings, env.OTP_SECRET, notifications),
    settings,
    authenticate,
  };
  await app.register(addressRoutes, { prefix: '/v1/me/addresses', addresses, authenticate });
  await app.register(wishlistRoutes, {
    prefix: '/v1/wishlist',
    wishlist: new WishlistService(db, catalog.products),
    authenticate,
  });
  await app.register(cartRoutes, { prefix: '/v1/cart', ...shopping });
  await app.register(retailerOrderRoutes, { prefix: '/v1/orders', ...shopping });
  await app.register(wholesalerOrderRoutes, { prefix: '/v1/wholesaler/orders', ...shopping });
  await app.register(adminOrderRoutes, { prefix: '/v1/admin', ...shopping });

  const fleet = {
    delivery: new DeliveryService(db, settings, env.OTP_SECRET, notifications),
    orders: shopping.orders,
    notifications,
    authenticate,
  };
  await app.register(deliveryRoutes, { prefix: '/v1/delivery', ...fleet });
  await app.register(adminDeliveryRoutes, { prefix: '/v1/admin', ...fleet });
  await app.register(pushTokenRoutes, { prefix: '/v1/me', ...fleet });

  const marketing = { marketing: new MarketingService(db, images), authenticate };
  await app.register(bannerRoutes, { prefix: '/v1', ...marketing });
  await app.register(adminMarketingRoutes, { prefix: '/v1/admin', ...marketing });
  await app.register(adminAnnouncementRoutes, {
    prefix: '/v1/admin/announcements',
    announcements: new AnnouncementService(db, notifications),
    authenticate,
  });

  const moderation = { reviews: new ReviewsService(db, catalog.products), authenticate };
  await app.register(reviewRoutes, { prefix: '/v1', ...moderation });
  await app.register(adminReviewRoutes, { prefix: '/v1/admin/reviews', ...moderation });

  const finance = new FinanceService(db);
  const money = { finance, authenticate };
  await app.register(adminFinanceRoutes, { prefix: '/v1/admin/finance', ...money });
  await app.register(wholesalerFinanceRoutes, { prefix: '/v1/wholesaler/finance', ...money });

  const closing = { account: new AccountService(db, finance), authenticate };
  await app.register(accountRoutes, { prefix: '/v1/me', ...closing });
  await app.register(publicAccountRoutes, closing);
  await app.register(adminAccountRoutes, { prefix: '/v1/admin/account-deletion-requests', ...closing });

  const billing = { invoices: new InvoicesService(db), authenticate };
  await app.register(retailerInvoiceRoutes, { prefix: '/v1/orders', ...billing });
  await app.register(wholesalerInvoiceRoutes, { prefix: '/v1/wholesaler/orders', ...billing });
  await app.register(adminInvoiceRoutes, { prefix: '/v1/admin/orders', ...billing });

  const reporting = { reports: new ReportsService(db), authenticate };
  await app.register(adminReportRoutes, { prefix: '/v1/admin', ...reporting });
  await app.register(wholesalerReportRoutes, { prefix: '/v1/wholesaler/reports', ...reporting });

  return app;
}

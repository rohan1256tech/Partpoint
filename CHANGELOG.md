# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Initial repository setup: README (two-app architecture, flows, security, Play compliance, costs), .gitignore, .gitattributes.
- Backend scaffold: Fastify 5 + TypeScript, Zod-validated config, Drizzle schema for all v1 tables, `/health`.
- Infrastructure: multi-stage Dockerfile (non-root), Docker Compose (`postgres`, `api`, `caddy`) with a dev-only
  override that publishes Postgres on loopback, Caddyfile that takes the client IP from Cloudflare.
- Migrations `0000_init` (full v1 schema) and `0001_user_consent` (DPDP consent timestamp and version).
- Auth (`/v1/auth`): phone OTP login/signup, email + password signup with email verification, forgot/reset password,
  rotating device-bound refresh tokens with reuse detection, logout. Roles are bound to their app.
- OTP rules: 6 digits, HMAC-hashed, 5-minute expiry, 5 attempts, single use, 30 s resend cooldown,
  5 per hour per phone/email, plus per-IP rate limits. Fixed-code demo phones for Play review.
- Shared auth guard that checks the session and user status on every request, so blocking is instant.
- `GET /v1/me`; admin user approval (`/v1/admin/users`: list with cursor pagination, view, approve, block, unblock),
  written to the audit log.
- `pnpm db:seed:admin` to create the first admin.
- Fast2SMS and Resend adapters; development logs codes instead of sending them.
- CI (`.github/workflows/backend.yml`): typecheck, lint, integration tests on Postgres, schema/migration drift check,
  Docker build; deploy to the VPS on `main` with migration and health gate.
- 37 tests (health, config, auth flows, sessions, admin approval).
- Catalog:
  - Admin (`/v1/admin`): categories (two levels) and brands with slugs; product list, block (with a reason
    shown to the wholesaler) and unblock; upload URLs for category, brand and banner images. All audited.
  - Wholesaler (`/v1/wholesaler/products`): create with variants and bulk price slabs, edit, publish/hide,
    add/edit variants and stock, images. Every query is scoped to the wholesaler's own products.
  - Buyers (`/v1/categories`, `/v1/brands`, `/v1/products`): cached category tree and brands; product
    browse with search on name/part number (pg_trgm), category (incl. subcategories), brand and wholesaler
    filters, cursor pagination; product detail. Only live products of approved wholesalers in active
    categories with an active variant are shown.
  - Pricing rules: price ≤ MRP, slabs above the minimum order quantity and cheaper at each step; GST rates
    limited to 0/5/12/18/28/40%; HSN codes of 4, 6 or 8 digits.
  - Images: WebP only, ≤ 1 MB, uploaded straight to R2 with a 5-minute pre-signed URL whose type and size
    are signed; the API checks the stored object before attaching it. Max 8 per product.
- Dependency-free SigV4 presigner for R2, verified against AWS's published test vector.
- Migrations `0002_pg_trgm`, `0003_catalog_search` (trigram and browse indexes, category parent FK),
  `0004_product_status_reason`.

- Shopping and orders (online payment deferred; orders are settled offline):
  - Retailer addresses (`/v1/me/addresses`): up to 10, always exactly one default, private to the owner.
  - Wishlist (`/v1/wishlist`): idempotent add/remove; products no longer for sale drop out of the list.
  - Cart (`/v1/cart`): bulk-slab pricing, lines grouped by wholesaler, per-line issues
    (unavailable, below minimum quantity, out of stock), coupon preview with a reason when it does not apply.
  - Place order (`POST /v1/orders`): one transaction locks the variants, re-prices, takes stock, creates one
    order per wholesaler (numbers like `PP-20261126-000042`) and empties the cart. Idempotency key makes retries
    safe; concurrent orders cannot oversell.
  - Coupons: percent (with cap) or flat, dates, minimum order, total and per-retailer limits; the discount is
    shared across wholesaler orders exactly to the paisa.
  - Order lifecycle: wholesaler accept → pack or reject (with reason); retailer cancels while placed; admin
    cancels until pickup (audited). Cancelling returns stock. Every change is on the order timeline.
  - Each party sees only its own orders. Wholesalers see the delivery area, not the full address; retailers
    do not see commission.
  - Admin settings (`/v1/admin/settings`): commission %, delivery fee per wholesaler order, minimum order value.
- Migrations `0005_checkout_placed`, `0006_order_number_seq`.
- Delivery (`/v1/delivery`, `/v1/admin`):
  - Admin lists delivery partners (availability, active jobs) and assigns or reassigns packed orders.
  - Partner toggles availability, accepts or declines a job (declined jobs return to the queue), picks up,
    goes out for delivery and delivers with the retailer's 4-digit code. The code is derived from a server
    secret and the order id (nothing stored); 5 wrong tries lock it until an admin resets it.
  - DPDP: the partner sees the retailer's address and phone, and the pickup point, only while the delivery is
    active; afterwards only the area.
  - Earnings per delivered order (admin setting), with today / 7 days / month / all-time / unpaid totals.
- Push notifications (FCM HTTP v1, no SDK): device token registration (`/v1/me/push-token`); pushes for
  account approval, new order, accepted, packed, assigned, reassigned, picked up, out for delivery, delivered
  and cancelled. Sent after the response; dead tokens are removed. Pushes carry only the order number.
- Migration `0007_delivery`.
- Marketing (`/v1/admin/coupons`, `/v1/admin/banners`, `/v1/banners`): coupon management (codes fixed once
  created, use counts, rule validation) and banners with date windows, ordering and links; live banners cached.
- Reviews (`PUT /v1/orders/:id/reviews/:productId`, `/v1/products/:id/reviews`, `/v1/reviews/:id/report`):
  retailers review products from their delivered orders (editable); reviewer shown by first name only;
  any business user can report a review once. Admin queue of reported reviews; hide, unhide or dismiss
  reports (audited). Product ratings count visible reviews only.
- Finance (`/v1/admin/finance`, `/v1/wholesaler/finance`): wholesaler balance = goods value of delivered
  orders − commission − payouts; admin records payouts with bank reference, never above the balance (even
  under concurrent requests); delivery partner earnings settled in one step. All audited.
- Reports: admin dashboard (approvals, orders, GMV, commission, 30-day series, top wholesalers and products,
  open reports, unpaid earnings; cached 60 s); orders CSV export by IST date range; wholesaler sales report
  (JSON or CSV). CSV files open correctly in Excel (UTF-8 BOM) and neutralise formula injection.
- Account deletion (Play policy, DPDP): in-app `POST /v1/me/delete-account` (any non-admin role, including
  pending) erases name, phone, email, password, addresses, cart, wishlist, devices, sessions and codes, and
  frees the phone/email for reuse; order records are kept for GST retention. Refused while orders are in
  progress or money is unsettled. Public page `GET /account/delete` with a request form
  (`POST /v1/account-deletion-requests`, no account enumeration) and an admin queue to complete or reject.
- Migration `0008_account_deletion`.
- Admin two-factor authentication (TOTP, RFC 6238, verified against the RFC test vectors): admins without
  2FA can only reach `/v1/admin/2fa` (setup with an `otpauth://` URI for a QR code, then enable with a first
  code). Later sign-ins return a 5-minute challenge exchanged with a code at `POST /v1/auth/login/totp`.
  Secrets are AES-256-GCM encrypted at rest; codes cannot be replayed; ±30 s clock drift allowed. No disable
  endpoint: `ADMIN_RESET_2FA=1 pnpm db:seed:admin` resets a lost authenticator and ends that admin's sessions.
- Migration `0009_admin_totp`.
- GST invoices (`GET .../orders/:id/invoice.pdf` for retailer, wholesaler and admin): issued when the order is
  packed, numbered `PP<FY>-<serial>` in a consecutive series per wholesaler and Indian financial year; seller
  and buyer details frozen at that moment. GST-inclusive prices are split into taxable value and CGST + SGST
  (same state) or IGST (different states); a seller without GSTIN gets a bill of supply. The coupon discount
  is spread over lines and every figure adds up to the paisa. Rendered on request with PDFKit; the delivery
  fee is noted as charged by Partpoint separately.
- Migration `0010_invoices`.
- CI builds the backend Docker image in GitHub Actions (layer cache in GitHub), boot-tests it (migrate an empty
  database, start, `/health`), and on `main` / `develop` publishes it to GHCR. Deploys pull the exact
  `sha-<commit>` image instead of building on the server; `API_IMAGE` pins it in the server's `.env`.
- Admin refresh token is now an httpOnly, SameSite=Strict cookie scoped to `/v1/auth` (Secure in production);
  mobile apps still receive it in the body.
- Admin panel (`admin/`, React + Vite + Mantine + TanStack Query), first slice: sign-in with the 2FA step,
  first-time 2FA setup with a locally drawn QR code, session restored from the cookie, dark/light theme,
  dashboard (KPIs, accessible 30-day orders chart with table view, status counts, top sellers), and user
  approvals (filter by status/role, details, approve/unblock, block with reason). CI: `admin.yml`.

### Fixed
- Blank values in `.env` (e.g. `DEMO_OTP=`) stopped the API from starting; they now mean "not set".
- Deliberate 503 errors (`DELIVERY_FAILED`, `STORAGE_NOT_CONFIGURED`) were reported to clients as a generic
  `INTERNAL` error; their code and message now come through. Unexpected errors are still hidden.

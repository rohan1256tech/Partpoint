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

### Fixed
- Blank values in `.env` (e.g. `DEMO_OTP=`) stopped the API from starting; they now mean "not set".
- Deliberate 503 errors (`DELIVERY_FAILED`, `STORAGE_NOT_CONFIGURED`) were reported to clients as a generic
  `INTERNAL` error; their code and message now come through. Unexpected errors are still hidden.

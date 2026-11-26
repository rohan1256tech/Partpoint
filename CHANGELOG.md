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
- Admin panel, catalog: categories (two-level tree, create/edit, slug, order, visibility, image), brands
  (search, create/edit, logo), product moderation (filter by status/wholesaler, search, details with variants,
  bulk prices and images, block with reason / unblock). Images converted to WebP in the browser and uploaded
  straight to R2. Pages load on demand (initial bundle 201 → 134 KB gzipped). Admin category/brand lists now
  include image URLs.
- Admin panel, orders and delivery: order list with work-based tabs (new, accepted, needs a rider, out with
  riders, delivered, cancelled) and wholesaler filter, refreshing every 30 s; order detail with both parties,
  items, totals and commission, timeline, GST invoice download, rider assignment/reassignment from available
  riders, unlocking a locked delivery code, and cancellation with a reason. Delivery partners page with
  availability and active deliveries. Admin order detail now reports wrong delivery-code attempts.
- Backend tests: per-test setup timeout raised to 30 s (setup could exceed 10 s on a busy machine).
- Admin panel, remaining sections (navigation now grouped: Operations, Catalog, Marketing, Money,
  Administration):
  - Coupons: create/edit (percent with cap, or flat; minimum order; total and per-retailer limits; validity
    window), live/scheduled/expired/used-up state, use counts.
  - Banners: image, link to a category, brand or product, display order, date window, delete.
  - Reviews: reported queue with reasons, hide / show again / dismiss reports.
  - Finance: wholesaler balances with payout recording (amount ≤ balance, bank reference, date) and history;
    rider earnings settlement with a transfer reference.
  - Reports: orders CSV for an IST date range (≤ 366 days).
  - Settings: commission, delivery fee, rider earning per delivery, minimum order; amounts entered in rupees
    and percent, stored as paise and basis points.
  - Account deletions: process web-form requests (complete or reject with note), history of in-app ones.
- Admin banner list now includes image URLs.
- Android project (`android/`): Partpoint and Partpoint Delivery apps sharing core modules. Phone OTP sign-in
  with SMS code autofill and resend timer, new-account signup (retailer, wholesaler with address and GSTIN
  check, or rider with vehicle), waiting-for-approval screen, sign out, in-app account deletion. Session
  restored at start; access token in memory, refresh token encrypted with an Android Keystore key, single
  shared refresh on 401. Backups off, HTTPS-only release builds, R8. Unit tests for phone numbers, refresh
  and retry. CI: `android.yml` (tests, debug APKs).
- Fixed: a new admin signing in to the panel saw "Set up two-factor authentication to continue" instead of
  the 2FA setup screen, because `/v1/me` was behind the 2FA gate. It is now readable before 2FA.
- Admin panel UI review (screenshots of every page, desktop/phone, light/dark): tables scroll inside
  themselves on phones instead of widening the page; explained empty states; sidebar counts for accounts
  awaiting approval and reported reviews; user list shows the shop/business name and has search (name, shop,
  phone, email); photo placeholders; labelled top-wholesaler and top-product lists; correct plurals; clickable
  rows reachable by keyboard; a rider accepting a job is titled as such in the order timeline.
- `pnpm db:seed:demo`: a realistic demo marketplace (categories, brands, 3 wholesalers with 15 products,
  retailers, riders, 10 orders in every status, reviews, a reported review, coupons) created through the
  real API; demo accounts sign in with fixed-OTP demo phone numbers (also the Play review accounts).
- Partpoint app, retailer side: bottom navigation (Home, Categories, Cart with count, Orders, Account). Home
  with search, banner carousel, category tiles, brand chips and an endless product grid; search with
  debounce; category/brand/seller lists; product page with photos, variant picker, bulk-price tiers that
  highlight the tier reached, stock line, seller link, reviews, wishlist and a sticky add/update bar. Cart
  grouped by seller with steppers, plain-language line problems, minimum-order hints, coupon, totals.
  Checkout with address choice or inline new address and duplicate-proof ordering (idempotency key).
  Orders: in-progress and past, status stepper, large delivery code, rider call, cancel while waiting for
  the seller, GST invoice in the PDF viewer, star ratings after delivery. Account: addresses (add, edit,
  default, delete), wishlist, sign out, delete account. Pull-to-refresh and retry everywhere.
- Android: Coil image loading, shared formatting (Indian digit grouping, IST), leaner Gradle memory use.
- Partpoint app, wholesaler side (Orders, Products, Earnings, Account tabs). Orders by next task (New,
  To pack, Ready for pickup, On the way, Done) with counts; order view with a plain next-step hint, items
  to pack, accept, reject with a reason, mark packed, rider pickup details and the GST invoice. Products:
  search, status filters (live, draft, hidden, blocked with reason), stock warnings; editor with category
  and brand pickers, part number, HSN, GST rate, description, options with MRP, price, stock, minimum
  order and up to 5 bulk prices, on/off per option, draft/publish/hide, and photos from the Photo Picker
  converted to WebP (1600 px, 1 MB, metadata stripped) and uploaded straight to storage. Pricing problems
  are shown in plain words before saving, matching the server rules. Earnings: balance owed, breakdown,
  this month's orders and earnings, top sellers, payouts received.
- Partpoint Delivery app (Jobs, Earnings, Account tabs): online/offline switch; job list with new offers
  first; guided job screen (accept or decline with reason, go to pickup with an item checklist, picked up,
  start delivery, enter the retailer's 4-digit code with screenshot protection); pickup and drop cards with
  Google Maps two-wheeler directions and call buttons; earnings (today, 7 days, month, all time, unpaid)
  and recent deliveries. No location permission: directions are handed to Maps (README Play checklist
  updated). Shared loading helper moved to core:ui.
- Push notifications in both apps (Firebase Cloud Messaging). Firebase is initialised from
  gradle.properties values (no google-services file; empty = push off). Channels "Orders and deliveries"
  and "Account and announcements"; the backend now sets the channel per message. The device token is
  registered after sign-in and removed at sign-out/account deletion. Tapping a notification opens that
  order or job; open lists and detail screens refresh when a push arrives. Notification permission
  (Android 13+) is asked in context on each app's main work screen, once, with a reason.
- Admin announcements: push a short title and message to approved retailers, wholesalers, delivery
  partners or everyone, with a phone-style preview and a confirmation (pushes can't be recalled). History
  with accounts and devices reached; kept in the audit log. Max 10 per hour.
- Partpoint app: email sign-in ("Sign in with email instead"), email signup (email and password with the
  same business details, verified by an emailed 6-digit code), and forgot password (code by email, new
  password, other sessions signed out). An unverified email at sign-in sends a fresh code and opens the
  code screen. The Delivery app stays phone-only, since riders must be reachable by phone.
- Public privacy policy at `/privacy` (DPDP Act 2023 notice, Play policy URL): what is collected and why, who
  sees it, retention (GST records ~8 years), protection, rights, grievance officer. Business name, address,
  grievance officer and privacy email come from new settings (LEGAL_NAME, LEGAL_ADDRESS, GRIEVANCE_OFFICER,
  PRIVACY_EMAIL), required in production; missing ones are visibly flagged in development. Linked from the
  signup consent (both apps) and every Account screen. Deletion page now says "Account → Delete account".
- Android release builds: optional upload-key signing from CI secrets (unsigned without a key); R8 builds
  verified (about 2.2–2.6 MB, all serializers kept). CI `release` job on main builds both signed AABs, keeps
  them with the R8 mapping files, and can publish to Play internal testing (switched off by variables until
  the Play account exists).
- Fixed (found testing on a real phone): placing an order showed a technical error although the order
  was created, because the app expected a full order summary in the reply; and the seller's order view
  failed to load because sellers (correctly) receive only the delivery area, not the retailer's contact
  and street. Both are covered by tests decoding the real replies. Privacy policy wording corrected to say
  sellers see the delivery area. Savings green is lighter in dark mode for contrast.

### Fixed
- Blank values in `.env` (e.g. `DEMO_OTP=`) stopped the API from starting; they now mean "not set".
- Deliberate 503 errors (`DELIVERY_FAILED`, `STORAGE_NOT_CONFIGURED`) were reported to clients as a generic
  `INTERNAL` error; their code and message now come through. Unexpected errors are still hidden.

# Partpoint Admin

Web panel for the Partpoint operator: approvals, catalog, orders, delivery, marketing, finance and reports.
React 19 + TypeScript + Vite, Mantine UI, TanStack Query, React Router.

## Run locally

```bash
# 1. Start the backend (from ../backend): docker compose up -d
# 2. Then:
pnpm install
pnpm dev          # http://localhost:5173 — /v1 is proxied to the API on http://localhost
```

Sign in with an admin account (create one with `pnpm db:seed:admin` in `backend/`). The first sign-in asks you
to set up two-factor authentication with an authenticator app; every admin needs it.

## Security model

- The access token (15 minutes) is kept in memory only.
- The refresh token is an **httpOnly, SameSite=Strict cookie** set by the API and scoped to `/v1/auth`; page
  scripts can never read it. Reloading the page restores the session from that cookie.
- Every admin endpoint requires a session that passed 2FA.
- In production the panel sits behind Cloudflare Access (approved emails only). It is served from
  `admin.<domain>` and calls the API at `VITE_API_URL` (`api.<domain>`), which must list the panel's origin in
  the API's `CORS_ORIGINS`.

## Image uploads

Category images, brand logos and banners are converted to WebP (≤ 1600 px, ≤ 1 MB) **in the browser**, which
also strips EXIF/GPS data, then uploaded straight to Cloudflare R2 with a 5-minute signed URL. The API never
handles the bytes. Locally, without R2 credentials, uploads show "Image storage is not configured".

The R2 bucket needs a CORS rule so the browser may upload to it:

```json
[{ "AllowedOrigins": ["https://admin.<domain>"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server with API proxy |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Checks (also run in CI: `.github/workflows/admin.yml`) |
| `pnpm build` | Production build in `dist/` (set `VITE_API_URL`) |

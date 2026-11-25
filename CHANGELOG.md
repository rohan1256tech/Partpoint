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

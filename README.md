# ForeignID v0.2 — PostgreSQL + authentication

This version upgrades the starter with a real PostgreSQL data layer, JWT authentication, role-based access control, migrations/schema, and protected API routes.

## Local start
1. Copy `.env.example` to `.env`.
2. Run `docker compose up -d`.
3. In `apps/backend` run `npm install`.
4. Run `npm run dev`.
5. In `apps/frontend` run `npm install`.
6. Run `npm run dev`.

Default demo administrator is created by the seed script only when explicitly run.

## Production warning
Do not use demo credentials or sample data in production. Before production, configure secrets, HTTPS, backups, 2FA, object storage, antivirus scanning, audit retention, and a legal/privacy review.

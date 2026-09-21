# ForeignID v0.2 — PostgreSQL + authentication

This version upgrades the starter with a real PostgreSQL data layer, JWT authentication, role-based access control, migrations/schema, and protected API routes.

## Local start

### Prerequisites

Make sure you have:

- Node.js and npm installed.
- Docker and Docker Compose installed and running.
- Git installed.

### 1. Configure environment variables

From the repository root, copy the example environment file:

```bash
cp .env.example .env
```

Review `.env` and set the required secrets/configuration for your local environment.

### 2. Start PostgreSQL and supporting services

From the repository root, run:

```bash
docker compose up -d
```

Check that the containers are running:

```bash
docker compose ps
```

### 3. Install and start the backend

Open a terminal in `apps/backend`:

```bash
cd apps/backend
npm install
npm run dev
```

Keep this terminal running.

### 4. Install and start the frontend

Open a second terminal:

```bash
cd apps/frontend
npm install
npm run dev
```

Open the local URL printed by the frontend development server.

### 5. Database migrations / seed

If the project provides migration or seed scripts, run the appropriate npm scripts from `apps/backend` before using authenticated features.

The default demo administrator is created by the seed script only when explicitly run.

### Troubleshooting

If the backend cannot connect to PostgreSQL:

1. Check that Docker is running.
2. Run `docker compose ps` from the repository root.
3. Check the database/service logs with `docker compose logs`.
4. Verify the database connection variables in `.env`.

If dependencies are missing, run `npm install` again in the affected application directory.

## Production warning

Do not use demo credentials or sample data in production. Before production, configure secrets, HTTPS, backups, 2FA, object storage, antivirus scanning, audit retention, and a legal/privacy review.

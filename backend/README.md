# Rakky Ride shared backend

TypeScript/Express modular monolith for the mobile app and the separate Next staff dashboard. PostgreSQL stores permanent records and the append-only ledger; Redis handles live presence, queues and the Socket.io adapter. There is no separate dashboard backend/database.

Use Node >=22.13.0 and install dependencies from the lockfile with `npm ci`. Configure `.env` from the example, PostgreSQL and Redis, run `npm run migrate`, then `npm run dev`. Local development normally uses port 4000. Secrets stay outside Git.

`npm run build` compiles `dist/`; `npm start` runs the compiled backend. Required DB, Redis and workers must initialize before serving traffic. `/api/health/live` is liveness; `/api/health/ready` is dependency/worker/queue readiness. The legacy `/api/health` reports uptime only.

Docker/Coolify: build with `docker build -t rakky-backend:release .`. The default
container command applies pending migrations and starts the API only after they
succeed. Migration history skips completed files, and a PostgreSQL advisory lock
serializes concurrent migration runs. Use Coolify's Dockerfile build pack with
base directory `/backend`, port `4000`, and a
persistent volume at `/app/.private-uploads`. Supply secrets as runtime environment
variables. See the [step-by-step Docker/Coolify guide](docs/coolify-deployment.md).
`MIGRATION_DATABASE_URL` can provide a separate schema-owner credential; otherwise
migrations use `DATABASE_URL`, which must have schema permissions. Set
`RUN_MIGRATIONS_ON_START=false` only when an external release job applies migrations
before the API is started. The local `npm start` command still starts only the API.
`npm run test:docker` checks the production image against disposable PostgreSQL and
Redis containers; it requires a running Docker engine and Compose v2.

`npm run verify` typechecks application and test-runner code, builds the backend, and runs isolated tests. The runner requires a local PostgreSQL test administrator and an existing `redis-server` executable. It creates a disposable test database and separate temporary Redis process; it refuses production/live/remote configurations. Backend session/socket tests also reuse the installed mobile compiler, Zustand and Socket.io client dependencies. Configure `TEST_DATABASE_ADMIN_URL` if the normal local DB credential cannot create a temporary database.

The owner-approved migration 014 introduces session families and a fixed 12-hour staff-session limit. Staff must sign in again after applying it. Production deployment still needs approved hosting, durable private documents, restricted runtime DB permissions, restore/monitoring evidence and external provider verification. Keep admin money actions disabled until their separate authority and provider gates pass.

- [Admin API reference](docs/admin-api-reference.md)
- [Transactional email setup and recovery](../docs/features/email-system.md)
- [Implementation source snapshot](docs/admin-api-implementation.md)
- [Release and recovery runbook](docs/production-release-runbook.md)
- [Dashboard remediation progress](/Users/mac/Desktop/rakkydashboard/docs/production-remediation-progress.md)

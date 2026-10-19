# Deploy the Rakky Ride backend with Docker on Coolify

This repository is prepared for the **Dockerfile** build pack. The API, Socket.io
server and existing background workers run together in one backend container.
PostgreSQL and Redis remain separate Coolify resources. No new application
dependency or database schema is introduced by containerization.

The files prepare deployment; they do not create a Coolify server, upload secrets,
run production migrations or publish the API.

Verified locally on October 18, 2026: Docker Desktop 4.95.0, Docker Engine 29.8.2
and Docker Compose 5.6.0 on Apple Silicon. `npm run verify` passed all 174 backend
tests. `npm run test:docker` built the Linux production image and passed every
container check described below, including all 18 existing migrations and a
second migration run. Its disposable containers, network and volumes were removed.
The production Coolify server and external providers have not been deployed or
verified by these local checks.

## 1. What was added

- `backend/Dockerfile`: builds with Node 24 and `npm ci`, compiles TypeScript, then
  copies compiled code and production dependencies into the runtime image.
- `backend/.dockerignore`: permits only package manifests, TypeScript configuration,
  runtime source and SQL migrations. Local `.env` files, private driver documents,
  Git data, local `node_modules` and tests are excluded from the build context.
- `npm run migrate:deploy`: runs the compiled migration runner without the
  development-only `tsx` package. It uses the existing SQL files and advisory lock.
- `.env.production.example`: a credential-free checklist for Coolify runtime values.
- `docker/compose.smoke.yaml` and `npm run test:docker`: a disposable, isolated
  container test using PostgreSQL 16, Redis 8 and generated test credentials.
- `.gitignore`: ignores future local environment copies and private uploads.
  This does not remove files already tracked in Git or erase any existing files.

The runtime listens on port **4000**, runs as the existing Node image's non-root
user (UID/GID **1000:1000**), and starts `node dist/index.js` directly so it receives
SIGTERM. It does not run database migrations automatically on every restart.

## 2. Install Docker locally and check the image

On a Mac, Docker Desktop supplies both the Docker CLI and its Linux engine.
Complete Docker Desktop's license/onboarding prompts and start its engine, then:

```bash
cd /Users/mac/Desktop/ride_app/backend
docker version
docker compose version
npm run typecheck
npm run typecheck:scripts
npm run build
npm run test:docker
```

The Docker test creates a unique Compose project and random credentials in memory.
It does not load your backend `.env`, use your operational database, send SMS/email,
or enable payments. Only a randomly selected loopback API port is published.
It checks readiness/liveness, non-root execution, absence of `.env`/development
dependencies in the image, migration re-runs, document-volume persistence through
container replacement, and clean SIGTERM shutdown. It removes its own temporary
containers, networks and volumes at the end. The built image remains available as
`rakky-backend:smoke` for inspection. Docker Compose v2 or later is supported.

Build the deployment image manually, if needed:

```bash
docker build --pull -t rakky-backend:release .
```

Run the command in `backend`, since that is the Docker build context. From the
repository root, the equivalent is `docker build -t rakky-backend:release ./backend`.

## 3. Add PostgreSQL and Redis in Coolify

1. In your Coolify project/environment, add a PostgreSQL database and a Redis
   resource. Keep their data on persistent storage and configure backups.
2. Connect the API and these resources to a shared private Docker network using
   Coolify's network settings. Use the actual network name for the migration job.
3. Copy their **internal** connection URLs for the backend environment. Do not use
   `localhost`, a Mac LAN address, or an emulator address inside a deployed container.
4. Configure Redis with persistence and `maxmemory-policy noeviction`; eviction
   can destroy queue or live-trip state. Keep PostgreSQL/Redis ports private.
5. Use a restricted PostgreSQL role for normal API operation. Use a separate
   migration/database-owner credential for schema changes, including permission
   to install the existing `pgcrypto` extension. Runtime roles must not be able to
   disable ledger/audit protections. Follow `production-release-runbook.md` for
   database privileges, backups and restore requirements.

Start with one backend replica because private documents currently use a local
volume. The existing Redis Socket.io adapter is retained; multiple API instances
also need shared private document storage, correct Socket.io routing/session
affinity and tested job coordination before claiming multi-instance support.

## 4. Create the backend application

In Coolify, create a Git-based application pointing to the repository and branch
containing these files. Set:

- Build pack / build strategy: **Dockerfile**.
- Base Directory: **`/backend`**.
- Dockerfile Location: **`/Dockerfile`** (relative to that base directory).
- Build stage: leave empty to use the final runtime stage.
- Ports Exposes: **`4000`**.
- Domain: your chosen public HTTPS API domain, for example `https://api.example.com`.
- Container stop/grace period: at least **30 seconds**, using Coolify's lifecycle
  setting (`stop_grace_period` in its API). The server drains for up to 25 seconds
  before forcing a failed exit. Do not put `--stop-timeout` in Custom Docker
  Options; Coolify does not apply that flag there.
- Run one replica initially. Do not configure an extra watch/dev command.

The Dockerfile supplies the install/build/start commands; do not set `npm run dev`
as the production command. No host mapping of port 4000 is needed for the public
domain; Coolify's proxy routes to the internal port and forwards WebSockets.

## 5. Add runtime environment values

Open the application's **Environment Variables** page. Use
`backend/.env.production.example` as the checklist. Supply at least:

- `NODE_ENV=production` and `PORT=4000`.
- `DATABASE_URL` and `REDIS_URL` from the private data resources.
- A unique `JWT_ACCESS_SECRET` of at least 32 characters. Generate one locally
  with `openssl rand -hex 32`; store it securely and keep it stable across replicas.
- The server Google Maps key, Google OAuth client IDs and SMS configuration needed
  by the features you intend to test. An Android release client/certificate still
  needs its own Google configuration.
- `TRUSTED_PROXY_CIDRS` containing the actual trusted proxy IP/CIDR values from the
  deployment network so authentication rate limits can identify clients correctly.
  Do not use a wildcard or blindly trust forwarded headers from every address.

These are **runtime** variables. They are not build arguments and are not Expo
frontend variables. Do not put server secrets in the Dockerfile, Git, mobile
`EXPO_PUBLIC_` values, or image layers. Do not upload your local development `.env`
unchanged: its database addresses and provider settings may be inappropriate.

In Coolify's Normal view, set **Build time** to **Not available during build**
and **Runtime** to **Available in the container** for these backend variables.
Older Coolify versions show equivalent build-time/runtime checkboxes. This backend
does not need application secrets to compile. If Docker reports
`SecretsUsedInArgOrEnv`, check for secrets still marked as build-time values.

If a deployment fails with `tsc: not found`, verify the build stage uses
`npm ci --include=dev`. TypeScript and its type definitions are development
dependencies needed to compile the server, even when `NODE_ENV=production` or
`NPM_CONFIG_OMIT=dev` is present during the build. The separate production-dependencies
stage still omits them from the running image. Push the updated Dockerfile before
deploying again.

Keep `ENABLE_ADMIN_MONEY_ACTIONS=false`, `ENABLE_LIVE_PAYMENTS=false`, and
`EMAIL_ENABLED=false` until the existing provider/rollout requirements are complete.
This Docker work does not enable those services or change the app's financial rules.

## 6. Mount private document storage

Add persistent storage with container destination:

```text
/app/.private-uploads
```

A named volume initialized from the image inherits the directory's ownership.
If Coolify uses a host bind mount, ensure that specific host directory is writable
by UID/GID 1000:1000. Do not recursively change permissions on unrelated directories.
Do not serve the directory as public static files. The API's authenticated driver
document routes remain responsible for access.

Back up this volume with the database. Existing driver-document records require
their corresponding files to be transferred separately into this storage; the
Docker image intentionally does not contain local uploads. An empty new volume
does not migrate those documents for you.

## 7. Run the existing migrations as a separate release task

The image contains `migrations/` and the compiled runner. Run **one reviewed
migration job** before putting a new schema-dependent API version into service.
Do not use a Coolify pre-deploy command as the only migration mechanism: Coolify
runs that in the previous container and skips it on the first deployment.

For a first deployment, build the image for the release commit on the deployment
server (or use the image built by Coolify), then run a one-off container on the
database's private network. A server-side environment file for this job should
contain `NODE_ENV=production`, `DATABASE_URL` with the migration credential and
the required strong `JWT_ACCESS_SECRET`. Keep that file outside the repository
and readable only by the deployment administrator.

```bash
docker run --rm \
  --network YOUR_SHARED_PRIVATE_NETWORK \
  --env-file /secure/path/rakky-migrations.env \
  YOUR_RELEASE_IMAGE \
  npm run migrate:deploy
```

Replace the network, environment-file path and image with actual server values.
`YOUR_RELEASE_IMAGE` is the image/tag or image ID for the exact commit being
deployed; it is not an image name to download from an unverified publisher.
The existing runner applies only unapplied migration filenames and serializes
concurrent migration attempts. On an existing database, back up and rehearse
the migrations first. Migration 014 intentionally revokes existing staff sessions.

Keep the migration credential out of the long-running API's environment. Deploy
the API with its normal restricted `DATABASE_URL` after the migration succeeds.
No migration or production data change is executed by adding these Docker files.

## 8. Deploy and verify

1. Click **Deploy** in Coolify and inspect the build and startup logs.
2. The image's `HEALTHCHECK` uses Node to GET `/api/health/ready` on the internal
   `PORT`, with a 60-second startup grace period. Coolify detects this image check;
   do not configure a conflicting curl-based check in the dashboard.
3. Confirm `https://YOUR_API_DOMAIN/api/health/live` returns `{"status":"alive"}`
   and `/api/health/ready` returns HTTP 200 with `{"status":"ready"}`.
   The legacy `/api/health` is uptime only and does not prove database/queue readiness.
4. Exercise login, a Socket.io connection, a private document upload/read and
   provider features using their approved test configurations.
5. Recreate the container and confirm the uploaded test document still exists.
6. Set the mobile app's production `EXPO_PUBLIC_API_BASE_URL` to this HTTPS origin.
   Set the separate staff dashboard's backend URL to the same deployed API.
7. Configure any intended provider webhooks using this permanent HTTPS origin:
   Paystack `/webhooks/paystack` and Resend `/webhooks/resend`.

Changes to backend code can be redeployed through Coolify's Git integration.
The mobile app still needs its own Expo build/update when its embedded API URL
changes. Uploading a Docker image does not configure Expo automatically.

## References

- [Coolify Dockerfile builds](https://coolify.io/docs/applications/builds/dockerfile)
- [Coolify health checks](https://coolify.io/docs/applications/configuration/health-checks)
- [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/)
- [Existing production release and recovery runbook](production-release-runbook.md)

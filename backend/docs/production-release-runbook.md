# Production release and recovery runbook

This runbook prepares the current code for deployment. Hosting, HTTPS domains, durable storage, backup targets, alert recipients and commercial authority still require owner decisions and deployed evidence. Do not read this document as production sign-off.

## Build and verification

Use a supported Node runtime satisfying both packages (minimum 22.13.0; current local checks use Node 24). Install from lockfiles. Backend tests reuse the existing mobile compiler, Zustand and Socket.io client; install the mobile package's locked dependencies for those regression checks.

Run `npm run verify` in `backend` and in the separate `rakkydashboard`; run `npm run typecheck` in `mobile`. Backend verification typechecks application and test-runner code, compiles `dist/`, and runs disposable PostgreSQL/Redis integration fixtures. It requires a local PostgreSQL test administrator with permission to create a temporary database and an existing `redis-server` executable. `TEST_DATABASE_ADMIN_URL` can select the local test administrator; it is not a production connection. Tests reject production mode, live Paystack keys and remote administrator hosts, and use a separate temporary Redis process. Provider/SMS/alert calls are disabled or redirected to fixture-only configuration. Cleanup terminates/drops only the generated temporary test database/process.

The portable verify commands can be used by an approved CI platform. No CI account, runner or deployment service is provisioned by this change. A reviewed release commit must include required sources, migrations and lockfiles while excluding secrets, `.private-uploads` and unrelated local work.

## Environment and access checklist

- Set explicit `NODE_ENV=production`, a strong unique `JWT_ACCESS_SECRET`, the correct private `DATABASE_URL` and `REDIS_URL`, and the actual API port/topology. Production rejects the known development JWT fallback and short secrets.
- Dashboard: disable preview; set exact HTTPS `DASHBOARD_ORIGIN`, trusted `RAKKY_API_URL`, accurate environment label and production Google client/Maps key/map-ID settings. Public browser keys must retain approved referrer/API restrictions; backend keys stay private.
- Backend: configure exact proxy IP/CIDR trust if deployed behind a proxy, and tune auth/body/connection limits for legitimate traffic/shared networks. Do not trust all forwarded headers. The Next start script currently binds loopback; use it behind a same-host proxy or deliberately configure the approved platform's expected interface/port.
- Configure and prove SMS delivery if phone login is advertised. Never use development OTP logs in production.
- Use a restricted runtime DB role, separate migration ownership, protected DB/Redis connectivity and an approved Redis persistence/capacity policy. Prove the runtime role cannot disable immutable ledger/audit/session protections.
- Provide durable private document storage available to every claimed instance, retention and backups. Local `.private-uploads` is not an object-storage integration or a multi-instance guarantee.
- Configure edge HTTPS/CSP/HSTS/cache behavior; verify compatibility with Google login/Maps and prevent public caching of staff responses/private documents.
- Set an approved alert destination/recipients. No raw contacts, secrets, document content or provider payload should be transmitted in alerts.
- Keep `ENABLE_ADMIN_MONEY_ACTIONS=false` until commercial/provider gates are independently approved. The independent `ENABLE_LIVE_PAYMENTS=false` flag additionally blocks new live provider POSTs and live mobile top-up/withdrawal initiation while accepted-payment verification continues. Stage/test/live data and credentials must still be isolated.

## Migration and deployment order

1. Record candidate versions for backend/dashboard/mobile compatibility, required migration set and a recoverable pre-change backup.
2. Rehearse on isolated staging with representative records, then run exactly one migration job with migration credentials. `npm run migrate` holds a database advisory lock; competing runners wait up to the configured ten-second lock timeout and fail visibly rather than executing the same migration concurrently.
3. Migration 014 adds family IDs/original sign-in timestamps, immutable session identity and a unique active-token constraint. It **revokes existing staff sessions**. Inform staff that fresh login is required. Customer refresh credentials remain app-only and can rotate into the new model; legacy app access expires within the bounded transition window.
4. Deploy compatible backend and dashboard builds together for the logout/session contract. Do not mix an old backend that requires access-authenticated logout with the new dashboard's refresh-only logout and claim confirmed revocation.
5. Use `/api/health/live` for liveness and `/api/health/ready` for readiness. The legacy `/api/health` is uptime only. Keep unready instances out of traffic; provider health is a separate staff observation.
6. Allow at least 30 seconds for backend termination. SIGTERM/SIGINT marks unready, waits for startup coordination, stops HTTP acceptance, drains workers and closes sockets/pools/Redis; a 25-second deadline forces a failed exit if cleanup cannot finish. Reconciliation/state-machine idempotency remains necessary for interrupted work.
7. Verify real HTTPS staff login/renewal/logout, role/scope denial, Maps, private documents, probes, queues, alerts and financial exceptions on the deployed candidate. Record the result for the exact build/configuration.

## Failure and recovery

If required workers or dependencies fail, readiness must be false. Do not restart the entire API repeatedly merely because Paystack is temporarily unavailable. Monitor queue age and recent failures separately from retained history; inspect redacted causes and prove a fresh successful observation. A successful balance GET does not prove webhook delivery, transfers or bank reconciliation.

If logout cannot reach revocation, the browser clears its own cookies and explains that server revocation was not confirmed. Use the approved emergency account/session revocation procedure; do not claim copied credentials were revoked by deleting cookies. New family-bound access is denied after recorded revocation. A refresh duplicate in the five-second grace window receives 409 and no credentials; preserve the winning token response. Lost winning responses can require sign-in again. Staff must reauthenticate after 12 hours.

Record backup RPO/RTO and retention before launch, then restore PostgreSQL and all referenced private files into an isolated environment and measure results. Protect backup access and validate ledger consistency and document ownership after restoration. This local implementation has not performed a production restore drill.

Use a compatible previous application artifact or a forward fix for rollback. Do not undo accepted financial activity by restoring a stale database or mutating/deleting ledger/audit rows. Rehearse code/schema compatibility before rollback; migration 014's staff revocation is intentional and old access-only staff behavior must not be restored as a security workaround.

## Financial and operational sign-off

Before live money: approve actual limits/fees and every monetary capability; capture controlled Paystack test charge-success webhooks, transfer success/failure/reversal/uncertainty, duplicate/missed-event recovery and statement reconciliation. Investigate legacy settlement exceptions using evidence, with justified append-only corrections only if required. Provider refunds and customer messaging/public safety intake remain outside the selected scope.

Name release, incident, care and finance owners, hours and escalation. Complete representative-data E2E, accessibility/200% zoom, agreed load/soak, dependency loss, rolling restart and backup/restore drills. Only then sign off the exact deployment and begin a watched staff pilot. Financial enablement is a separate approved rollout.

## Financial candidate verification

Read [financial integration evidence](financial-production-readiness.md) before enabling payments. Transfer events now require current provider identity/outcome and actual fee evidence; unknown/contradictory evidence must be investigated. Manual money remains off. The isolated external test runner uses an explicitly approved temporary Cloudflare endpoint and disposable DB/Redis; use an interactive terminal and capture receipt/ledger evidence before restoring Paystack test settings and stopping the runner. Temporary public delivery cannot replace permanent HTTPS hosting, commercial policy, statement reconciliation or owner sign-off.

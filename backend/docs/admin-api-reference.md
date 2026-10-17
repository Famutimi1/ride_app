# Rakky admin API reference

This is the staff API of the existing ride-app Express backend. The mobile app and the separate Next.js dashboard use the same PostgreSQL database, Redis service and backend at `http://127.0.0.1:4000`. There is no dashboard database.

All paths below are relative to `/api/admin` unless another prefix is shown. Implementation source is linked beside each group. The companion [implementation snapshot](admin-api-implementation.md) contains the actual TypeScript routing, controller, service, query and authorization code. Regenerate it after changes with `node --experimental-strip-types scripts/document-admin-api.ts` from the backend directory.

## Start and authenticate locally

```sh
cd /Users/mac/Desktop/ride_app/backend
npm run dev
# Uses the existing .env PostgreSQL / Redis configuration and port 4000.
curl http://127.0.0.1:4000/api/health

cd /Users/mac/Desktop/rakkydashboard
npm run dev
# Open http://127.0.0.1:3015/login
```

Dashboard `.env.local`: `RAKKY_API_URL=http://127.0.0.1:4000`, `DASHBOARD_ORIGIN=http://127.0.0.1:3015`, `DASHBOARD_PREVIEW=false`. Mobile uses `EXPO_PUBLIC_API_BASE_URL=http://localhost:4000`; native clients replace localhost with the Metro host or Android emulator host, preserving port 4000. A physical phone needs the reachable LAN address and services on the same network.

Use an **existing active staff account**. Admin routes require a signed `staff` session plus a current database role of `admin` or `super_admin`; ordinary rider/driver accounts do not gain access through the dashboard. Initial staff role provisioning requires the owner's account choice. No public role-grant endpoint exists. Staff roles are checked from PostgreSQL on every request.

The dashboard performs staff OTP login through its same-origin Next server:

- `POST /api/session/initiate` on port 3015: `{ "phone": "+234..." }` forwards to backend `POST /api/auth/login/initiate`.
- `POST /api/session/verify`: `{ "phone": "+234...", "code": "123456" }` forwards to backend `POST /api/auth/login/staff/verify`, which requires an active staff record and valid OTP. After `/api/auth/me` confirms staff, Next stores access/refresh tokens in HttpOnly cookies and returns a success indicator, never the tokens to browser JavaScript.
- `POST /api/session/refresh` rotates the refresh token and checks staff again.
- `POST /api/session/logout` authenticates backend revocation with the refresh credential, including when access is expired/missing, revokes its session family, and expires browser cookies. Unknown/already revoked credentials have an idempotent success response. If revocation is unavailable, Next clears local cookies but returns 503 with `locallySignedOut:true`; the login screen explains that server revocation was not confirmed.

Google is also supported: POST `/api/session/google-challenge` creates a ten-minute browser-bound nonce cookie; POST `/api/session/google` with `{ idToken }` consumes that cookie and forwards to **backend `/api/auth/google/staff`** with its expectedNonce. Google staff verification requires the configured web audience, valid signature/issuer/expiry, verified email and matching nonce. It accepts only existing active staff, using an existing Google subject or safe first linking by an authoritative Gmail/Workspace email. It creates no account or role. A successful staff Google login appends `staff_google_login` audit evidence. [Google setup and detailed flow](/Users/mac/Desktop/rakkydashboard/docs/google-sign-in.md).

The same staff Google identity can use mobile `/api/auth/google` for an **app-only** session. An unlinked staff record can be linked by an unambiguous authoritative Gmail/Workspace email; other providers require an existing subject link. Customer contact email still cannot authorize automatic Google linking. Mobile `/api/auth/login/verify` also always issues app-only access. App responses and `/api/auth/me` expose `platformRole: user` for app sessions; database staff roles remain unchanged. Driver mode still requires approval. Staff profile/login identity edits remain restricted to staff administration.

Migration `012_auth_session_scope.sql` adds the scope to existing refresh tokens. Rotation copies the stored scope; client fields cannot elevate it. Apply the migration before starting the updated backend and deploy the dashboard's staff OTP endpoint change alongside it. Older unscoped access tokens and refresh sessions have app access only, so existing dashboard users must sign in again. A demoted staff account cannot refresh a staff session or use admin routes.

Session POSTs and dashboard mutations require the exact `Origin` matching `DASHBOARD_ORIGIN`. Cookies are SameSite Strict, HttpOnly and Secure with `__Host-` names in production. The mobile app uses its existing token authentication rather than browser cookies. Express endpoints accept `Authorization: Bearer <accessToken>`. Do not copy tokens into browser storage.

Migration `014_auth_session_families.sql` adds stable session-family IDs and original sign-in timestamps to existing refresh records, protects identity fields against mutation and invalidates existing staff refresh credentials. Staff must sign in again. New HTTP and socket credentials are checked against the active family/account. Staff sessions have an absolute **12-hour** limit that refresh cannot extend. Existing app-only refresh credentials remain usable; older app access credentials are accepted for their remaining lifetime capped at 15 minutes, then must refresh.

Rotation retains the family and original timestamp. A duplicate request within five seconds of a successful rotation returns **409 `refresh_already_rotated`**, without another credential or revoking the winner. Clients preserve tokens on 409 and retry with the winning response's credential; mobile HTTP/socket refresh and supported dashboard browser tabs coordinate refresh. Later reuse revokes that family, without revoking unrelated sessions. If the winning response is lost and no client receives the replacement, fresh sign-in may be required.

Logout revokes a family; authenticated `POST /api/auth/logout-all` revokes all of the calling account's families. Session/account socket disconnection propagates through the existing Redis adapter; expiry timers and bounded periodic database checks protect receive-only clients when no packet or notification arrives. No staff management/provisioning permission is added. In-flight HTTP actions are not forcibly undone by revocation.

Database/session-store failures return **503 `authentication_service_unavailable`**, rather than 401. A refresh already completed before a later `/auth/me` outage retains its replacement HttpOnly credential in Next; transient failures do not intentionally erase renewable sessions. Nonstaff identity still clears/denies the browser session.

Public auth POSTs are limited atomically per actual trusted client IP using Redis (`AUTH_RATE_LIMIT_PER_MINUTE`, default 300); rejected responses include 429 and `Retry-After`. Forwarded IP headers are ignored unless exact `TRUSTED_PROXY_CIDRS` are configured. Tune shared-network limits against the approved deployment/load profile. OTP cooldown/window updates are atomic per phone. Next JSON request bodies are bounded to **16 KiB while streaming**, including chunked input; invalid/unsupported bodies return 400/415, oversized bodies 413. Express JSON bodies also have a 16 KiB limit.

`GET /api/health/live` returns process liveness. `GET /api/health/ready` returns 200 `{status:"ready"}` only after initialization and when DB, Redis, this process's required workers and their queues are usable; otherwise it returns 503 `{status:"not_ready"}` with no operational details. The older `/api/health` uptime endpoint remains compatible and must not be used as a readiness probe. Paystack availability is shown separately to staff; an external provider outage does not intentionally restart the whole backend.

Approved driver identity, vehicle and documents cannot be directly replaced; material edits during active trips are blocked. This rule covers onboarding, profile name/phone and staff name writes. Ordinary customer contact-email changes remain supported; customer-entered contact email cannot authorize Google linking. Approval validates owned, readable file references and allowed signatures for all required documents while holding the reviewed version's locks. Rejection can explain missing/unusable evidence. New upload filenames use detected content extensions; declared MIME alone is insufficient. Shared durable storage/retention remains a production prerequisite.

The older staff `GET /api/admin/payments/users/:userId` remains compatible and now records `financial_user_inspection` before returning financial data. Its user ID is validated and contacts/raw provider payloads remain excluded. Production HTTP logs contain generated request IDs, methods, matched route patterns and status/latency, rather than raw query strings or credentials.

In `NODE_ENV=development`, the existing OTP provider prints the temporary login code in the backend console without sending SMS. This is development behavior; use the normal OTP verification endpoint, not a fabricated JWT. Production uses the configured provider.

## Shared response and pagination conventions

Successful JSON reads and mutations described here currently return HTTP 200. Documents and report exports return bytes/CSV. Staff routers set `Cache-Control: no-store`.

Directory pages send **both** `page` and `limit`. `page` is a decimal integer from 1 through 999999; `limit` is 1–100, defaulting to 20 when page is supplied. UI row choices are 10/20/50/100; smaller valid API limits also work. Filters apply to both the rows and exact total. Out-of-range pages clamp to the last page. Empty results are page 1 of 1, showing 0–0.

```ts
interface AdminPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  from: number;
  to: number;
  hasPrevious: boolean;
  hasNext: boolean;
}
interface AdminPage<T> {
  items: T[];
  nextCursor: string | null;
  asOf: string; // ISO timestamp of the read
  scope: { dateBasis: string; [filter: string]: unknown };
  count: { value: number; exact: boolean };
  pagination?: AdminPagination;
}
```

```json
{
  "items": [],
  "nextCursor": null,
  "asOf": "2026-10-09T12:00:00.000Z",
  "scope": { "dateBasis": "created_at" },
  "count": { "value": 0, "exact": true },
  "pagination": {
    "page": 1, "pageSize": 20, "total": 0, "totalPages": 1,
    "from": 0, "to": 0, "hasPrevious": false, "hasNext": false
  }
}
```

Numbered counts and rows are read inside one read-only repeatable-read database transaction with a statement timeout. Ordering always includes a stable identifier. Changing filters or row size resets the dashboard to page 1.

Legacy timestamp/UUID lists also accept opaque `cursor` without `page`, default limit 50. Ledger entries and audit use positive bigint `before` instead. `page` and `cursor`/`before` are mutually exclusive. Never manufacture a total from a cursor slice when `count.exact` is false. UUID filters are exact canonical UUIDs, not partial name searches. Unknown filters and repeated query parameters are rejected by the list parsers. Use POST search for names and contacts.

Money returned from PostgreSQL bigint fields is generally a **decimal kobo string**. Keep it as a string/BigInt until display formatting; 100 kobo is NGN 1. Existing mutation amounts use positive safe-integer JSON numbers. Timestamps are ISO; dashboard display and report day boundaries use Africa/Lagos (WAT, UTC+1). Range `from` is inclusive and `to` exclusive.

Errors use `{ "error": "machine_readable_code" }` with optional additional detail fields at the top level. Typical statuses: 400 invalid input, 401 missing/expired token, 403 insufficient role, 404 unknown record, 409 stale version/state or reused request key, 429 search limit, 500 unexpected server error. Do not treat timeouts or failed responses as proof that a mutation did not commit.

Mutations require a meaningful `reason` of at least 5 characters and a UUID `requestKey`. Driver/care operations trim reasons and cap them at 1000 characters; legacy payment operations require a minimum length but do not share that maximum. Generate a key once per intended operation and retain it for retries. The server locks persistent rows, hashes the normalized input, writes append-only audit evidence and returns the earlier result for an exact retry. Reusing a key with different data returns 409. Versioned changes additionally require the version last read.

## People, staff search and system

Source: [auth admin routes](../src/modules/auth/admin.routes.ts), [controller](../src/modules/auth/admin.controller.ts), [service](../src/modules/auth/admin.service.ts).

### POST /search

Body: `{ query, scope?, cursor? }`. Query is trimmed, 3–80 characters, without control characters. Scope is `all` (default), `people`, `trips`, `finance`, `support`, or `safety`. Name/reference/subject searches use literal prefixes; phone/email/UUID lookups use exact matching. Contacts remain masked. Single-scope results use up to 20 per group and an opaque, query-bound next cursor; `all` returns up to five per group. Request limit is 30 per staff member per minute via Redis. Search text stays out of URLs and audit metadata.

Returns `{ groups: [{ scope, label, items: [{ id, type, title, subtitle, href }], hasMore, nextCursor }], asOf, limitPerGroup }`. `safety` requires super_admin; ordinary admins' `all` results omit safety. No search result grants access to its linked record.

### GET /users

All identities, including existing staff who can also ride or drive; `platformRole` distinguishes staff from ordinary customers. Common `page`, `limit`, `cursor`, `id`; optional `mode=active|inactive` and driver `status=pending|approved|rejected`. Returns `AdminPage<Person>` ordered by user creation descending, with `id`, name, masked phone/email, active flag, joined time, trip count and optional driver summary. `service` is unsupported.

### GET /drivers and GET /driver-applications

Same filters and response shape as users, restricted to profiles with pending/approved/rejected driver status. Dashboard Applications sends `status=pending` by default. These IDs are **user IDs**, not a separate driver ID.

### GET /users/:id and GET /drivers/:id

Returns the safe person projection plus linked `accounts` and `asOf`. Accounts include account ID, kind, exact balance and freeze state. Driver summaries include Redis availability, `locationAt`, `presenceReason`, current `activeTripId`, active role, and active payout accounts with bank name/last four digits only. No directory coordinate or recipient code is returned. Redis failure is unknown; stale location never counts as available. Reads are audited. The driver URL uses the same person lookup; do not infer driver approval just from the URL. Returns 404 for unknown users.

### GET /team — super_admin

Paged existing staff accounts only. Filters: common pagination/id and `status=admin|super_admin`; service/mode unsupported. Returns items with ID, name, role, active flag, created time, plus `readOnly` and coverage. There is no provisioning, role editing or scope grant API in this screen.

### GET /health

Protected point-in-time PostgreSQL and Redis checks with bounded timeouts; returns `checks`, explanatory coverage and `asOf`. BullMQ queues report current worker connections, paused state, running-worker heartbeats refreshed every 15 seconds with a 90-second expiry, waiting/active/delayed/failed counts, and successful/failed job timestamps retained for 24 hours even when completed jobs are removed. Observations time out after three seconds and become unknown. A connection does not guarantee job success; retained failures may be historical. Paystack reports the last actual request, retained in Redis for 24 hours; no recent observation stays unknown. Dashboard updates still use bounded REST polling, not staff sockets. This differs from public `GET /api/health`, which is the backend process health endpoint.

### GET /environment

Returns `{ nodeEnvironment, paymentEnvironment, basis }`. Provider mode is derived from the configured Paystack key prefix (`test`, `live`, or `unconfigured`); secret values are never returned. Configuration mode does not prove provider availability.

## Driver applications and private documents

Source: [driver admin routes](../src/modules/driver/admin.routes.ts), [controller](../src/modules/driver/admin.controller.ts), [service](../src/modules/driver/admin.service.ts).

### GET /driver-applications/:id

Returns application status, exact optimistic-concurrency `version`, identity/contact projection, vehicle information, document availability and `asOf`. Uses the driver user ID. Reading private context is audited; filesystem paths are not returned.

### GET /driver-applications/:id/documents/:kind

Kind: `license`, `registration`, `insurance`. Returns private PNG/JPEG/WebP/PDF bytes after owner/path/signature checks, bounded to 8 MB, with safe response headers and audited access. Missing documents return 404; invalid kind 400. Multi-server deployment requires shared durable private storage. The dashboard streams this through its authenticated same-origin route.

### POST /driver-applications/:id/review

Body: `{ decision: "approved" | "rejected", expectedVersion, reason, requestKey }`. `expectedVersion` is the exact string returned by the read, not a reformatted timestamp. Locks profile and user; requires pending, complete application. Returns `{ status, auditId, replayed }`. Stale version/nonpending/incomplete application gives 409. No unaudited direct status write.

## Trips, live operations and insights

Source: [trip admin routes](../src/modules/trips/admin.routes.ts), [controller](../src/modules/trips/admin.controller.ts), [service](../src/modules/trips/admin.service.ts); [location routes](../src/modules/location/admin.routes.ts), [controller](../src/modules/location/admin.controller.ts), [service](../src/modules/location/admin.service.ts).

### GET /overview

Optional `day=YYYY-MM-DD`, interpreted as a WAT day. Returns active trips, selected-day passenger completions, posted net commission, hourly ride/courier outcomes, ordered attention queue, available driver evidence and `asOf`. Request, completion and ledger-posting time bases are distinct. Unavailable/oversized Redis supply checks return unknown rather than zero. Safety attention is visible only to super_admin.

### GET /trips

Common pagination/id filters; `service=ride|courier`; status: `scheduled`, `searching`, `driver_assigned`, `driver_arrived`, `in_progress`, `completed`, `cancelled`, `no_drivers_found`, `returning`, `returned`. Modes: `live`, `scheduled`, `scheduled_history`, `courier_exceptions`. Additional filters: riderId/driverId UUID, paymentMethod `cash|wallet`, paymentStatus `unpaid|held|settled|released`, dateBasis `requested|scheduled|fulfilled`, ISO from/to. `order=asc|desc` controls timestamp ordering; default scheduled upcoming is pickup ascending, and history/ordinary trips are descending, with ID tie-breakers. Ordering and cursor direction use the same validated choice. Returns a paged safe trip projection and explicit scope. Admin reads do not change trip state.

### GET /trips/:id

Returns trip, participants, fare/payment evidence, event timeline, matching offers, linked care records, feedback, ledger references and bounded numbered historical position samples. Current Redis position is distinct from permanent history. Sensitive inspection is audited; raw provider secrets and full contact details are omitted. Unknown trip returns 404.

### GET /trips/:id/location

Returns the position projection for that trip. Fresh live positions come only from Redis for an active trip, with a 30-second freshness bound. Missing/stale/ineligible positions are labeled; historical samples never masquerade as live location. Requires staff and audited trip read.

### GET /live

Viewport filters: south/north/west/east decimal coordinates; defaults 6.2/6.8/3.1/3.8. `service=ride|courier`, default ride; `limit=1..100`, default 100. No numbered pagination. Returns bounded eligible driver snapshots, active-trip context, availability evidence, viewport, capped flag, location state, transport and asOf. Fresh viewport coordinates are Redis-only. Dashboard polls this REST endpoint every 15 seconds while visible; staff Socket.io subscriptions are not implemented.

### GET /reports

Filters `from`, `to` ISO timestamps, optional `service=ride|courier`. Default is the current WAT day; bounded to a positive range of at most 90 days. Returns request-cohort outcomes and operations (requests, completed, cancelled, noDriver, assigned, meanAssignmentSeconds, offers), ratings by rating creation time (count/average/lowRatings), payment intent outcomes by creation time across all services, completed/returned settlement totals, net ledger postings, range/timezone/currency and coverage. Rates use request totals and include requests not yet terminal; no observations are not represented as a measured average of zero. Export includes these indicators. Different sections state their own date basis; posting totals across services are not silently attributed to one service.

### GET /reports/export

Same filters as reports. Returns an audited aggregate CSV with WAT/NGN metadata and `Content-Disposition: attachment; filename=rakky-report.csv`. This is not an export of all underlying customer rows.

### GET /pricing

Returns current `fare_config` as `{ items, asOf }` with vehicleType, baseFareKobo, perKmKobo, perMinuteKobo, minimumFareKobo, commissionBps, active, updatedAt and a 64-hex optimistic `version`. Amounts are kobo strings. Super admins can use PATCH /pricing/:vehicleType below.

### GET /ratings

Paged `trip_ratings`, common pagination/id and optional service. Returns IDs, trip/rater/ratee references, score, comment and creation timestamp. No moderation endpoint. Status/mode filters are not supported by the UI; do not rely on those fields filtering ratings.

## Financial reads

Source: [finance routes](../src/modules/payments/dashboard.routes.ts), [controller](../src/modules/payments/dashboard.controller.ts), [service](../src/modules/payments/dashboard.service.ts).

### GET /payment-intents

Common pagination/id; status `pending|succeeded|failed|abandoned|mismatch`; target `wallet|earnings`; exact reference (max 80 characters), userId UUID, from/to by created time, minKobo/maxKobo nonnegative decimal strings up to PostgreSQL bigint maximum. Returns `AdminPage<PaymentIntent>` with exact amounts and safe references. Service/mode unsupported.

### GET /payment-intents/:id

Audited detail with status, target, amount, provider reference/channel/fees, failure reason, ledger transaction link and latest 50 processed webhook receipts. Raw webhook payload, checkout secret and sensitive provider data are omitted. `providerObservation` is null where no observation is instrumented.

### GET /withdrawals

Same financial amount/reference/user/date/pagination filters, by requested time; status `pending|processing|success|failed|reversed`. Target/service/mode unsupported. Returns exact amounts and masked bank evidence in paged rows.

### GET /withdrawals/:id

Audited detail with masked destination, request/final ledger transaction links, attempts/failure reason and status. This is read-only; completion comes from provider webhooks/reconciliation, not a manual paid button.

### GET /accounts

Common pagination/id; kind `wallet|earnings|system`, ownerUserId UUID. Returns paged ledger accounts, exact balances, normal side/type and freeze status. UI kinds map database `user_wallet` and `driver_earnings` to wallet/earnings. Status/service/mode unsupported.

### GET /accounts/:id

Audited account detail plus ledger entries. Query: page/limit, or legacy before/limit. Entries are ordered by entry ID descending. Returns account context, `entries`, `pagination` for numbered mode, `nextEntryId`, `asOf` and history coverage. Entries are immutable; debit/credit direction depends on the account's normal side, not only the raw sign.

### GET /transactions/:id

Audited transaction context and balanced ledger entries with account IDs, kind, normal side/type, debit/credit and exact kobo amounts. Corrections create new transactions; no update/delete endpoint exists.

### GET /refund-eligibility/:id

ID is the trip ID. Returns fare/refunded/remaining kobo strings, eligible flag and wallet destination. Eligibility requires a completed trip, settled payment status, matching immutable settlement transaction for the same trip/payment method, and remaining fare. `paymentStatus`, `settlementEvidence` and `ineligibleReason` explain the decision. The mutation rechecks under a lock. Cash commission posting is accounting evidence, not independent proof of cash collection. Cash with zero commission and no posting remains ineligible for automated wallet credits; investigate rather than invent evidence. Reading eligibility does not reserve a refund amount.

### GET /operations/:key

UUID key is the mutation requestKey. Returns the calling actor's committed audit evidence: confirmed state with audit/transaction identifiers, or unknown. Unknown is not proof of failure; retain the same key before retrying an uncertain operation.

### GET /audit

Query page/limit or before/limit; optional action (3–80 lowercase letters/digits/underscores, beginning with a letter), objectId UUID (matches object or target user), actorId UUID, ISO `from` inclusive and `to` exclusive by audit creation time. Rows include object/target/transaction identifiers, requestKey, versions, and `changes.before/after` containing whitelisted scalar configuration/state fields; arbitrary metadata, contacts, customer bodies and operation hashes are excluded. Returns append-only audit rows ordered by bigint ID descending, paging metadata and asOf. Safety actions/objects are omitted for ordinary admins from both rows and counts. Action syntax validation is in `auditQuery` in the implementation snapshot; the UI offers common actions. Audit records cannot be updated or deleted.

### GET /reconciliation

Returns derived counts for mismatched top-ups, pending/processing withdrawals, held funds on terminal trips, received/failed webhook events and fulfilled trips without settlement evidence, plus ledger/operational coverage and asOf. Provider balance and observed timestamp come from the scheduled Paystack balance check in Redis, retained for 24 hours and separated by test/live mode; missing observation stays null. Counts do not authorize a financial correction.

### GET /reconciliation/:kind

Kind `topups`, `withdrawals`, `escrow`, `unsettled` or `webhooks`. For topups/withdrawals/escrow/unsettled, common pagination and exact UUID id filter apply. Status/service/mode selection is unsupported. Returns paged exception records; topups selects mismatch, withdrawals pending/processing, escrow held terminal funds, and unsettled completed/returned trips with unpaid or missing ledger evidence. Zero-commission cash trips can legitimately lack a posting and need interpretation. Webhooks uses page/limit or positive bigint before/limit; returns safe ID/provider/eventType/status/createdAt/processedAt/hasError only, never raw payload or error text. Failed retained BullMQ webhook jobs can now be retried by the existing reconciliation scheduler. Unknown kind returns 400 `unsupported_exception_queue`. Read is audited.

## Support and safety

Source: [care routes](../src/modules/care/care.routes.ts), [controller](../src/modules/care/care.controller.ts), [service](../src/modules/care/care.service.ts).

All safety endpoints require **super_admin**. Support accepts admin or super_admin. PostgreSQL stores records and append-only `care_activity`; audit protection is enforced by migrations. These are internal staff workflows, with no customer message delivery or mobile intake endpoint yet.

### GET /support and GET /safety

Query page/limit/cursor/id and status. Support statuses: new, assigned, waiting_customer, waiting_internal, resolved, reopened. Safety statuses: open, acknowledged, responding, resolved, reviewed. Service/mode unsupported. Returns paged subject/status/severity/version/linked IDs/assignment/timestamps; support also has responseDueAt.

### POST /support

Body: subject (5–160 chars), body (5–4000), severity `low|medium|high|critical`, category `trip|payment|account|other`, reason and requestKey. Optional customerId, tripId, paymentId UUIDs. Payment links require the matching customer; a customer linked to a trip must be its rider or driver. Returns `{ id, auditId, version }`; exact retries return the same ID with replayed evidence. Invalid/missing links are rejected rather than silently discarded.

### POST /safety — super_admin

Same subject/body/severity/reason/requestKey and optional customerId/tripId, plus required nextAction (5–1000 chars). Does not accept a support payment/category workflow. Returns `{ id, auditId, version }` with replay behavior.

### GET /support/:id and GET /safety/:id

Returns `{ record, activity, nextActivityId, allowedStates, asOf }`. Record fields use database snake_case; activity projection uses deliveryStatus/createdAt. Activity is newest first, fixed at 50 per read; pass `before=<positive activity id>` to continue. `limit` is validated but does not change the fixed activity batch; numbered page is rejected. Sensitive reads are audited. Allowed states come from the server's current state machine.

### POST /support/:id/activity and POST /safety/:id/activity

Body always includes positive integer version, reason, requestKey and action:

- `action=note`: body 5–4000 chars.
- `action=transition`: status must be in the current allowedStates.
- `action=assign`: assignedStaffId UUID or null; assignee must be an active eligible staff member.

Safety can also supply nextAction (5–1000 chars). Locks the record and checks version, actor role and valid transition; stale version or illegal transition returns 409. Returns `{ id, auditId, version }`; exact retries return `{ auditId, replayed: true }`. Refresh the detail to read the resulting status. Activity is internal and append-only.

Support transitions: new → assigned/waiting_internal/resolved; assigned → waiting_customer/waiting_internal/resolved; waiting_customer → assigned/waiting_internal/resolved; waiting_internal → assigned/waiting_customer/resolved; resolved → reopened; reopened → assigned/waiting_internal/resolved.

Safety transitions: open → acknowledged; acknowledged → responding/resolved; responding → resolved; resolved → reviewed. Reviewed is terminal.

## Existing financial mutations and settings

Source: [payments admin routes](../src/modules/payments/admin.routes.ts), [service](../src/modules/payments/admin.service.ts).

Dashboard monetary mutations remain disabled by `ENABLE_ADMIN_MONEY_ACTIONS=false`. At the owner's request, settings and pricing editing are available to super_admin through reviewed, versioned, audited updates; the obsolete `ENABLE_ADMIN_SETTINGS_ACTIONS` flag is ignored. The backend uses the same default-off flag and rejects refund/adjustment/freeze/sweep routes with 403 `admin_money_actions_disabled`; configuration edits and mobile payment routes remain available. Enable both backend and dashboard flags only after commercial rollout approval. Do not run monetary examples against the real database just to test documentation.

### POST /payments/refunds

Body `{ tripId, amountKobo, reason, requestKey }`; amount positive safe integer. Rechecks completed/settled state, matching settlement ledger evidence and cumulative remaining fare under a trip row lock. Missing evidence gives 409 `trip_settlement_evidence_required`. Returns `{ transactionId }`. Creates balanced offsetting ledger rows into the rider wallet; it is not a Paystack card refund. No ledger row mutation.

### POST /payments/adjustments

Body `{ userId, account: "wallet"|"earnings", direction: "credit"|"debit", amountKobo, reason, requestKey }`. Positive safe-integer amount. Database lock and configured approval threshold; amounts above ordinary-admin authority require super_admin. Returns `{ transactionId }`. Balanced append-only posting, never an edited historical amount.

### POST /payments/accounts/:userId/freeze

Body `{ account: "wallet"|"earnings", frozen: boolean, reason, requestKey }`. ID is the owning **user ID**, distinct from GET /accounts/:id's ledger account ID. Locks account and audits before/after. Returns success/auditId and replay evidence where applicable.

### GET /payments/users/:userId

Legacy bounded inspection snapshot: ledger entries up to 100, intents up to 50, withdrawals up to 50 with wallet/earnings context. Not numbered-paginated. New detail screens use the dedicated account/intent/withdrawal endpoints above for full navigation.

### POST /payments/sweeps — super_admin

Body `{ amountKobo, reason, requestKey }`. Positive safe integer. Returns `{ transactionId }`. Internal ledger gateway-balance to bank-account posting; does not execute or prove a provider/bank transfer. No dashboard button is exposed.

### GET /payments/settings

Returns the current `payment_settings` snake_case fields and an optimistic-concurrency SHA-256 `version`. Readable to admin/super_admin. Never returns provider credentials.

### PATCH /payments/settings — super_admin

Body reason/requestKey, exact 64-hex expectedVersion and optional supported changes: minTopupKobo, maxTopupKobo, minWithdrawalKobo, maxDailyWithdrawalKobo, withdrawalFeeKobo, cashDebtLimitKobo, newPayoutAccountCooldownHours, paystackBalanceAlertKobo, adminAdjustmentApprovalKobo, payoutNameMatch (`strict|lenient|off`), transferFeeTiers (`[{maxKobo,feeKobo}]`). Numeric settings are nonnegative safe integers; cooldown also fits PostgreSQL int32. Fee tiers: 1–50, positive increasing maxKobo, nonnegative feeKobo, final maxKobo null for unbounded. Minimum/maximum relationships are validated. Locks settings, rejects stale version with 409, audits before/after and exact retries. Returns updated snake_case settings, new version and auditId.

## Client examples

Direct server/mobile read using an already issued access token:

```ts
const response = await fetch(
  "http://127.0.0.1:4000/api/admin/trips?page=1&limit=20&service=ride",
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
if (!response.ok) throw new Error(`Admin read failed: ${response.status}`);
const page = await response.json();
// Render page.items and use page.pagination for the exact range/buttons.
```

Dashboard server components use the existing protected helper:

```tsx
import { adminRead } from "@/lib/server";
const people = await adminRead("users?page=1&limit=20&mode=active");
// The helper reads HttpOnly access cookies server-side, adds Bearer auth,
// uses cache:no-store and handles expired/forbidden/invalid/not-found reads.
```

Dashboard browser search (same origin, after login):

```ts
const response = await fetch("/api/admin/search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "A customer name", scope: "people" }),
});
const result = await response.json();
```

Browser mutations use the allowlisted Next proxy; reads mostly happen in server components. The browser proxy deliberately does not expose a generic GET gateway for every directory. Its read allowlist covers live snapshots, trip locations/details, CSV, operation status and private application documents. Client POST/PATCH calls check Origin and forward the existing staff cookie as Bearer authentication server-side.

Example support body (illustrative only, not a record created in the database):

```json
{
  "subject": "Trip payment question",
  "body": "Customer requested staff review of the trip payment.",
  "category": "payment", "severity": "medium",
  "reason": "Record the customer support request",
  "requestKey": "00000000-0000-4000-8000-000000000001"
}
```

Generate a fresh real UUID per intended operation; never reuse this illustrative key in unrelated requests. Support/safety forms follow confirmed writes by refreshing the server-rendered record. Financial writes use GET /operations/:key to resolve uncertain outcomes before allowing a new operation.

## Validation and operational boundaries

Backend: `npm run typecheck`, `npm run build`, `npm test`. Integration tests use disposable PostgreSQL schemas and temporary Redis keys/documents, covering pagination, masking, role denial, idempotency, care versions, immutable audit/ledger and financial concurrency. Dashboard: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:session`. The session test uses a local mock, not the real OTP/provider.

Protected real-data page verification uses an existing authorized staff account. Empty support/safety/withdrawal tables are valid results. Google Maps requires browser-restricted keys; data remains real when maps are unavailable. Team role/provisioning controls remain read-only. Pricing, payment settings, customer name/status and pre-dispatch schedule controls are implemented. Staff subscriptions and customer delivery are not implemented, and commercial financial policies/step-up remain pending. The API documentation describes current code, not a claim of production rollout.

## Table controls and configuration updates — 10 October 2026

All controls below require an active super_admin, a meaningful reason and UUID requestKey. They use PostgreSQL row locks and append-only audit records. Exact retries reuse the audit record; changed data under the same key returns 409. Unknown fields and malformed bodies are rejected. Dashboard requests go through the existing HttpOnly session proxy, exact Origin check and method/path allowlist. Use GET /operations/:requestKey to resolve uncertain outcomes.

### PATCH /pricing/:vehicleType

Body `{ baseFareKobo, perKmKobo, perMinuteKobo, minimumFareKobo, commissionBps, active, expectedVersion, reason, requestKey }`. All four amounts are required nonnegative safe integers capped at 1,000,000,000 kobo each (NGN 10,000,000). commissionBps is an integer 0–10,000; active is boolean; expectedVersion is the exact 64-hex read version. Only existing vehicle configurations can be edited. Returns the updated pricing projection, new version and auditId. Stale versions return 409; audit action is `pricing_update` with before/after values.

New estimates use a configuration-specific Redis cache key so a saved revision cannot reuse an old cached tariff. Unexpired accepted quotes retain their quoted fare and saved trip fares are retained. Under the existing settlement policy, commission is read at completion for unsettled trips. Disabling a service stops new estimates; existing trips can still settle with the saved fare and current commission. Posted ledger history is never rewritten.

### PATCH /users/:id

Body `{ name, active, expectedVersion, reason, requestKey }`. Person directory/detail projections now include platformRole and the exact database-text version; do not convert this version to a Date. Name is trimmed, 2–100 characters, without control characters; active is boolean. Admin/super_admin targets, login identifiers, Google links and role changes are rejected. An account with a scheduled or active trip/return cannot be deactivated. Inactive accounts cannot reuse access tokens; trip creation/offer acceptance check activity under a user row lock.

Returns `{ id, name, active, version, auditId }`; exact retries may also include the current role. Stale versions return 409. Audit action `person_update` records before/after values. No customer message is sent.

### POST /trips/:id/schedule

Body `{ action, expectedVersion, reason, requestKey, scheduledAt? }`. action is `reschedule` or `cancel`. Trip directory/detail projections now include an exact database-text version; updatedAt is a display timestamp rather than the concurrency token. Only passenger rides still in `scheduled` may change; stale/dispatched/terminal records return 409.

Rescheduling requires an ISO timestamp with explicit timezone, 30 minutes to 7 days ahead. The dashboard picker uses WAT. Rider/trip rows are locked; overlaps use the existing estimated duration plus a 30-minute buffer, sharing the rider lock used during scheduled creation. Route, fare and payment method remain saved. Cancellation uses the trip state machine and releases any hold through the payments service. Existing trip history accepts rider/driver/system, so cancellation records the staff ID as actor_type system with staffAction metadata. It does not impersonate the rider.

Audit action `schedule_update` stores action, reason and before/after pickup/state. Named trip-room status delivery follows commit; refresh REST data for pickup time. Returns `{ id, status, scheduledAt, auditId }`. Exact retries produce one audit/transition. Active trip reassignment, force completion and courier handoff overrides are unavailable.

Tests exercise permissions, competing versions, exact retries, overlap/dispatch guards, staff target protection, disabled-service settlement, exact wallet-hold release on scheduled cancellation and unchanged existing ledger entries in disposable PostgreSQL schemas. Browser verification reviews drafts without changing local commercial settings.

## Booking commission policy and migration 013

The owner selected booking-time commission. New immediate and scheduled bookings save `trips.commission_bps_snapshot` from the active configuration during creation. Completion/return settlement uses that saved rate even after pricing edits; a database trigger prevents changing a non-null snapshot. Admin trip detail exposes `commissionBps`. Migration 013 does not fabricate historical rates: older trips retain null, and completion of such legacy active trips uses the pre-existing current-rate fallback. Historical ledger amounts are untouched. Apply migration 013 before deploying the new booking code.

## Support contact settings

`GET /api/admin/support-settings` allows admin/super_admin and returns phone/email, staffedHours, availabilityMessage, integer version and updatedAt. `PATCH /api/admin/support-settings` is super_admin-only and accepts any changed contact/availability fields with expectedVersion, reason and requestKey. Phone is E.164 or null; email is valid lowercase contact email or null; hours are 1–160 characters and message 1–300. Row locking, version checks and exact-payload retry protection apply; action is `support_settings_updated`. These contact settings are also readable by authenticated mobile customers through `GET /api/care/settings`. Contact links open call/email; they do not create cases or send tracked messages.

## Financial verification changes — 12 October 2026

Manual money remains disabled by owner decision. The independent `ENABLE_LIVE_PAYMENTS=false` flag blocks new live-key provider POSTs and live mobile top-up/withdrawal initiation (`503 live_payments_disabled`); incoming verification/outcomes continue for accepted obligations. Production/live keys require `https://api.paystack.co` as the provider origin. This flag is not approval of commercial settings or staff money powers.

`POST /webhooks/paystack` remains public only for raw-body Paystack signature authentication. Recognized charge/transfer/dispute events require validated reference/mode and durable receipt before 200. Invalid signature returns 401; malformed recognized envelopes/mode return 400; oversized raw bodies return 413. Unsupported events are acknowledged without processing. New stored receipts omit customer/card/bank payloads. Duplicates can recover failed queue processing. Transfer events independently verify provider reference/mode/amount/currency/recipient/code and actual fee before terminal postings; an event label cannot manually mark a withdrawal paid. Unknown or contradictory evidence stays an exception. Redis loss can be recovered from persisted events.

Withdrawal detail failure reasons include `transfer_initiation_uncertain`, `provider_transfer_otp`, `provider_transfer_blocked`, `transfer_verification_mismatch`, `transfer_terminal_conflict`, `transfer_status_unrecognized` and `transfer_fee_evidence_missing`. They are operator investigation states, not permission to retry a new reference or alter a ledger. Requests save a gateway fee capacity estimate in immutable request metadata; terminal gateway expenses use actual provider fee evidence. Failure/reversal returns reserved funds once, including after driver suspension. Provider fee refunds need separate evidence.

`GET /api/admin/reconciliation/unsettled` additionally returns `paymentMethod`, `paymentStatus`, `commissionKobo` and `evidenceClass` (`legacy_cash_commission_entries`, `zero_commission_cash_no_posting`, `settlement_evidence_missing`). Classification explains evidence without rewriting status/history or granting wallet-credit eligibility. The dashboard displays it beside each exception. Existing pagination/permissions remain unchanged.

See [financial release evidence](financial-production-readiness.md) for the investigated legacy exceptions, external test workflow and remaining production gates. A successful provider balance or charge verify call is not webhook/bank reconciliation proof.

Withdrawals additionally require current available provider float as well as ledger capacity before reserving earnings. `409 provider_payout_funds_unavailable` leaves earnings/OTP consumption unchanged. Access restrictions (`401`/`403` or provider `transfer_unavailable`) become `503 paystack_access_denied`, are not retried as transient transport GET failures, and surface `provider_transfer_access_denied` on an affected reserved withdrawal. The actual test account is currently a starter business and rejected third-party payouts; external transfer success and production sign-off remain blocked. See the dated financial evidence for the authentic charge webhook, provider resend observations and a simulated missed-webhook recovery using actual test verification.

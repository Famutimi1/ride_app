# Rakky Ride admin dashboard — implementation specification

**Prepared:** 9 October 2026 · **Market:** Lagos, Nigeria · **Display timezone:** Africa/Lagos (WAT) · **Currency:** NGN

**Status:** researched product and design specification, ready for implementation planning. Features described as proposed are requirements, not claims that their APIs already exist. Architecture, schema, dependency and commercial-policy decisions in section 14 require owner approval before the affected implementation starts.

**Evidence baseline:** working checkout at `62ec86b`, including pre-existing uncommitted scheduled-ride, courier, payment and location changes. This is a source-code investigation, not an inspection of a deployed production database. Migration files establish intended schema, not deployment status.

## 1. Product direction

Build a desktop-first **Rakky Ride Admin** workspace for running the service: watch trips, review drivers, investigate customer problems, reconcile money and understand service performance. Keep the rider and driver experience in the existing single mobile app. Staff administration should have a separate entry point and server-enforced authorization.

The visual direction is a calm, white-forward operations workspace with the existing Rakky Ride logo, Inter typography, silver surfaces and green primary actions. Its strongest screen is a real Lagos operations map beside an actionable queue. Financial screens emphasize precise amounts, status and provenance. Driver review screens emphasize documents and decisions. Each screen should feel designed for its task rather than repeating the same grid of cards.

The dashboard should answer five questions quickly:

1. What needs attention now?
2. Where are our active trips and available drivers?
3. Which drivers and customers need help?
4. Where is the money, and what has actually settled?
5. Which operational decisions changed the system, and who made them?

### Reading guide

- Sections 2–4: implementation reality, scope and navigation.
- Sections 5–7: visual design, page layouts and component behavior.
- Sections 8–10: metrics, API requirements and live data.
- Sections 11–14: permissions, rollout, acceptance tests and decisions.
- Section 15: code and research sources.

### Specification labels

- **Existing:** found in the current implementation; still needs integration and verification.
- **Extension:** source data or business logic exists, but the admin endpoint/UI is missing.
- **New capability:** requires a new workflow and potentially an approved schema change.
- **Deferred:** do not expose as working functionality in the first release.

Priorities: **P0** is required for an internal operations pilot; **P1** completes safe, staffed operations before wider rollout; **P2** supports later growth. Missing P1 support/safety tooling requires a documented, staffed alternative during a limited pilot.

## 2. What the repository actually supports

### 2.1 Trips and dispatch

**Existing:** immediate passenger trips, matching, driver offers, trip history, ratings, sampled trip locations, scheduled rides, courier delivery, courier returns, cash and wallet settlement. Staff-wide search, operational map subscriptions and trip intervention endpoints are **extensions**.

The current state machine is:

```text
scheduled → searching → driver_assigned → driver_arrived → in_progress → completed
                 │              │                │              │
                 │              │                │              └→ returning → returned
                 │              │                └→ cancelled
                 │              └→ cancelled
                 ├→ cancelled
                 └→ no_drivers_found
scheduled → cancelled
```

`returning` and `returned` apply to courier deliveries. Terminal states have no outgoing transitions. An ordinary cancellation is unavailable after pickup/start. The UI may use friendly labels, but requests, filters and reporting must preserve these exact API values. Do not implement an editable status dropdown.

Scheduled passenger trips are booked 30 minutes to seven days ahead. The worker attempts activation within five minutes before pickup; wallet funds are held at activation, not at booking. Search normally ends five minutes after pickup, with already-issued offers allowed to reach their own expiry. The worker checks every 30 seconds. A booking is not a guaranteed driver reservation. Scheduled courier is not supported.

Courier deliveries are wallet-only, up to 5 kg, and offered only to approved drivers who opted in. Handoff uses a six-digit code; five failed attempts lock verification and the sender can rotate it twice. A return settles the original fare without a return surcharge. The current refund service accepts `completed` trips only, so `returned` deliveries need an explicit refund-policy and backend decision.

Direct card payment for a trip is rejected by the trip service. Paystack card checkout can fund a wallet. Do not describe those as the same payment method.

### 2.2 People and onboarding

**Existing:** one `users` table, OTP/Google authentication, refresh tokens, rider/driver active-mode switching, driver applications, three document uploads and one set of vehicle details per driver profile.

Platform roles are `user`, `admin`, `super_admin`. Rider/driver mode is `active_role`; it is not a staff permission. Driver application statuses are `none`, `pending`, `approved`, `rejected`.

**Missing admin capabilities:** people directories, application review/approval/rejection routes, secure staff document viewing, account suspension workflows, staff provisioning and fine-grained permissions. Uploaded driver documents currently reside on private local disk and use `private://` references; these are not browser image URLs. Document expiry dates, separate vehicles, inspections and suspension history are not modeled by the current onboarding schema.

### 2.3 Money

**Existing:** double-entry ledger, user wallet, driver earnings, escrow, top-ups, bank payout accounts, withdrawals, signed Paystack webhook processing, scheduled reconciliation, balance freezes, wallet refunds, adjustments, accounting sweeps and payment settings.

The active ledger is `ledger_accounts`, `ledger_transactions`, `ledger_entries`. Migration 003 retires the legacy `wallet_transactions` write path. Ledger transactions and entries are append-only; cached account balances change only through the locked posting service. An admin must never directly edit a balance or a ledger row.

The existing admin endpoints are narrowly focused on payments; they do not constitute a complete admin backend. Account inspection returns at most 100 entries, 50 intents and 50 withdrawals, without full directory search or complete-history pagination.

**Two labels that must be accurate:**

- “Refund to rider wallet” credits internal wallet value; it does not call Paystack to return funds to the original card/bank.
- “Record gateway-to-bank accounting movement” creates ledger entries; the current sweep endpoint does not initiate an external bank transfer.

### 2.4 Support, safety and commercial features

Help/support actions currently include alerts and a placeholder support phone number. Safety includes local controls and device actions, not a persisted incident queue. Trip chat is relayed through Socket.io without durable message storage. Do not promise a searchable historical transcript, emergency monitoring or successful support submission from these screens.

Ride Plus, promotions, family/work profiles, rewards and parts of vehicle/documents presentation contain prototype interactions or illustrative content. Their appearance in the app is not evidence of a working administration service. Airport rides do not establish a separate airport tariff or operations module.

### 2.5 Important differences from older project instructions

Document these before building, rather than silently replacing either the instructions or the code:

- The older trip vocabulary (`requested`, `accepted`, `driver_arriving`) differs from the current machine above.
- The older `users.role = rider/driver/both` model differs from platform staff roles plus `active_role`.
- The current schema already exceeds the older seven-table description and uses a double-entry ledger.
- Vehicles are fields on `driver_profiles`; ratings are in `trip_ratings`; OTPs are in `otp_codes`.
- Redis is the source of current driver position; `trip_locations` contains sampled historical breadcrumbs, not another live-location store.
- Socket.io rooms exist, but no Redis adapter is installed/configured in the inspected backend. Multi-instance event delivery is a prerequisite, not an existing guarantee.
- `AGENTS.md` says new backend logic goes in `matching` while also requiring clean domain boundaries. Resolve that placement rule before adding admin routes/services outside matching. The ownership suggestions below are proposals, not an override.

## 3. Scope and operator responsibilities

### P0 — internal operations pilot

- Staff entry, session handling, protected routes and a clear test/live environment label.
- Overview with real summary counts and a prioritized attention queue.
- Live operations map and active-trip list.
- Trip directory and detail, including scheduled and courier views.
- Rider/customer and driver directories with linked history.
- Driver application review and secure document access.
- Payment, withdrawal and ledger investigation; existing wallet-refund/adjustment/freeze flows with safeguards.
- Reconciliation visibility, audit visibility and readable service-health signals.
- Payment settings inspection; tightly controlled edits for super admins.

### P1 — complete staffed operations

- Durable support tickets, assignment, notes and response history.
- Restricted safety incidents, escalation and case ownership.
- Approved account/driver restriction policies and controlled trip interventions.
- Staff permission scopes, step-up verification and sensitive-read auditing.
- Complete paginated exports and reports, ratings investigation and approved fare management.
- Document expiry tracking if the business requires it; end-to-end mobile support/safety integration.

### P2 — growth

- Promotions, driver incentives, Ride Plus, referrals and campaign delivery.
- Corporate/family accounts, multi-vehicle fleets and multi-city operations.
- Advanced demand forecasting, surge pricing and geographic zone management.
- Provider refunds/chargeback tooling, if approved and implemented beyond the current wallet-credit flow.

These are backlog items, not permission to add tables, providers or dependencies now.

### Operator jobs

- **Operations:** investigate unassigned/delayed trips, monitor scheduled activation, handle courier exceptions, review drivers.
- **Customer support:** find a person/trip, understand its history, open a case and request financial assistance.
- **Finance:** reconcile top-ups/payouts, investigate ledger entries, perform permitted corrections, review cash debt.
- **Safety:** handle restricted incidents and preserve relevant evidence.
- **Owner/super admin:** settings, staff access and higher-risk financial actions.
- **Analyst:** aggregate reports and permitted exports.

Only `admin` and `super_admin` currently exist as staff roles. The job divisions above need approved server-side permissions before teams can be granted separate access. Do not give a support operator broad money privileges merely by hiding finance buttons.

## 4. Information architecture and routes

Use a persistent sidebar with seven groups. Badge counts indicate work requiring attention, not decorative totals. Hide deferred sections in the pilot.

```text
Overview                          /admin

Operations
  Live operations                 /admin/live
  All trips                       /admin/trips
  Scheduled rides                 /admin/scheduled
  Courier deliveries              /admin/courier

People
  Riders & customers              /admin/riders
  Drivers                         /admin/drivers
  Applications                    /admin/applications

Money
  Payments                        /admin/payments
  Wallets & ledger                /admin/ledger
  Withdrawals                     /admin/withdrawals
  Reconciliation                  /admin/reconciliation

Care                              [P1]
  Support cases                   /admin/support
  Safety incidents                /admin/safety
  Ratings                         /admin/ratings

Insights
  Reports                         /admin/reports

System
  Pricing & service rules         /admin/settings/pricing
  Payment settings                /admin/settings/payments
  Team & access                   /admin/team
  Audit log                       /admin/audit
  Service health                  /admin/health
```

`/admin` names describe intended URLs, not files already present. Detail routes use stable identifiers, for example `/admin/trips/:id` and `/admin/drivers/:userId`. A direct link opens a full detail page; selecting a row can open the same data in a drawer while preserving filters and scroll position.

Global search covers trip IDs, user IDs, authorized name/phone/email searches, plate numbers and provider references. Search is server-side, permission-filtered and paginated. Do not download every customer to the browser. Preserve navigation state in URLs; keep sensitive free-text queries out of shareable URLs, analytics and logs by default.

## 5. Visual specification

### 5.1 Brand and theme source

Use [the brand theme](brand/theme-spec.md), [design system](design-system.md) and [`colors.ts`](../../mobile/src/constants/colors.ts) as the authority. Keep every runtime color in the existing `palette`; components consume semantic tokens. Do not make an admin-only hex palette.

- **Canvas:** `background`; primary content surfaces: `surface`; recessed strips, table headers and filters: `surfaceMuted`.
- **Body and headings:** `text`; secondary metadata: `textMuted`; decorative icons: `icon`.
- **Actions and links:** `primary`; selected navigation/selected rows: `primarySoft` with `primary` text and an additional active indicator.
- **Dividers:** `border`; inputs and essential boundaries: `borderStrong`.
- **Successful/online/paid/completed:** `success` with `successSoft`.
- **Pending/review/delayed/rating:** `warning` with `warningSoft`.
- **Failed/cancelled/declined/outgoing personal funds:** `danger` with `dangerSoft`.
- **Filled control text:** `textInverse`. This resolves to a light foreground in light mode and charcoal in dark mode. Never force white text on the brighter dark-theme fills.
- **Map:** `mapPickup`, `mapDropoff`, `mapDriver`, `mapNearbyDriver`; green routes. Preserve marker shapes and accessible titles.
- **Overlays/skeletons:** `overlay` and `skeleton`.

The palette maps these to forest/leaf green, emerald/mint success, amber/gold warning, red/rose danger, white/silver and charcoal surfaces. Exact values remain in code. A future web adapter must read those exports or use an approved shared-token extraction; copying the values into an unrelated stylesheet creates drift.

Light is the initial default. Offer Light, Dark and System with persisted preference. Use the same component tree and semantic-token swap in all themes. On the existing Expo stack use `useTheme()` and `useColorScheme`; a separate web shell must provide equivalent behavior without changing the mobile contract.

Use the canonical [transparent logo](../../mobile/assets/images/brand/rakky-ride-logo.png), unchanged. The [existing BrandLogo](../../mobile/src/components/common/BrandLogo.tsx) already handles source margins. No replacement shield, generated lettering, recolored logo or decorative gradient header.

### 5.2 Layout proportions

Design the primary reference at **1440 × 1024**, verify at 1280 × 800 and 1920 × 1080.

- Sidebar: 240 px expanded, 72 px collapsed. White `surface`, right divider; logo/brand at top, navigation in the middle, staff identity and theme control at bottom.
- Top bar: 72 px, with breadcrumb/title context, search, environment, data freshness and user controls. Keep it compact rather than using a large hero banner.
- Page padding: 32 px desktop; gaps: 24 px between sections and 16 px inside compact sections. Use the existing spacing scale.
- Content: 12-column layout. Overview/map screens can use available width; forms should stay readable within roughly 720 px.
- Main overview split: eight columns for operations, four for attention items. Four compact metric groups sit above, with thin dividers rather than four heavily shadowed cards.
- List pages: full-width table below one filter toolbar; optional 440 px detail drawer. Detailed trip/finance pages use a main area plus a 320–360 px context rail.
- Navigation rows and standard form controls: 44–48 px high. Table rows: 56 px comfortable or 44 px compact; choose density once per user, not independently on every page.

These dimensions are admin layout specifications; centralize them as named layout tokens during implementation. Do not scatter arbitrary per-screen spacing values.

### 5.3 Typography, edges and motion

- Inter throughout, using existing loaded weight families.
- Page title: `h3` (28/36, semibold). Important KPI: `h2` (32/40, bold).
- Section label: `bodyMedium` (16/24). Standard content: `body` (16/24).
- Table metadata: `caption` (14/20). Controls: `button` (15/22).
- Prefer tabular numerals for currency, durations and counts. Keep monetary columns right-aligned. Preserve full values in financial detail; abbreviations belong only in overview summaries with an accessible exact value.
- Controls use `radius.md` (8); cards/drawers use `radius.xl` (12); chips use `radius.full`. Keep structural borders subtle. Reserve elevation for overlays and floating map controls.
- Use restrained 120–180 ms transitions. Respect reduced-motion settings. No animated number counters, pulsing emergencies or continuous map recentering while an operator is inspecting an item.
- Use consistent outline icons from already-supported assets/components. Selection of a new icon or chart library is a dependency decision, not part of this document's authorization.

### 5.4 Responsive behavior

- **1280 px and above:** expanded sidebar; operations split and drawer layouts.
- **1024–1279 px:** collapsed sidebar; narrow the attention rail; prioritize table columns, keeping full detail one click away.
- **768–1023 px:** temporary navigation panel; list/map tabs; full-height detail sheet.
- **Below 768 px:** single-column urgent review, lookup and read views; full-screen forms/detail. Complex accounting tables can use an explicitly labeled horizontal-scroll region. Financial confirmations must remain fully readable before submission.

No breakpoint may hide authorization, amount, currency, destination, reason or the final confirmation. Keyboard focus and selected records survive layout changes.

### 5.5 Status treatment

Every status combines text with a symbol; color alone is insufficient.

- Scheduled: neutral clock; Searching: warning clock; Assigned/Arrived/In progress: primary with distinct labels.
- Completed/Delivered: success check; Returning: warning return arrow; Returned: neutral return label plus a separate “Fare settled” financial badge.
- Cancelled/No drivers found/Failed: danger with explicit reason where available.
- Online available: success; Busy/on trip: primary; Offline: neutral; Stale location: warning with last-update age.
- Paid/settled: success; Held/pending/processing: warning; Released: neutral with explanatory text.

On wallet/earnings views, credit that increases that person's funds uses success and outgoing funds use danger. In accounting views, debit does not universally mean loss and credit does not universally mean gain; show account type, normal side and balance effect. A successful withdrawal can have a success **status** while its earnings debit is an outgoing **amount**.

## 6. Screen-by-screen requirements

### ADM-01 — Staff entry and session [P0 · Extension]

**Purpose:** establish staff identity and permissions before fetching administrative data.

Use a quiet split layout: canonical logo and a short product statement on one side; a compact authentication form on the other. No fake operational statistics on the login page. Reuse the existing OTP/Google authentication foundation where appropriate, then check platform role server-side. Public registration must never assign staff roles. Document an owner-controlled initial staff provisioning process before pilot.

States: submitting, invalid/expired code, rate-limited, signed-in nonstaff, expired session and unavailable backend. A nonstaff user receives a clear access-denied screen. Expired sessions clear sensitive caches; preserve only safe return navigation. Step-up verification for privileged actions is a proposed extension, not something existing payment routes enforce.

### ADM-02 — Overview [P0 · Extension]

**Purpose:** choose the next operational action, with a clear distinction between current state and period totals.

Header: “Operations overview”, Lagos/WAT, date range, last updated and environment. First band: active trips, available drivers, completed passenger rides in the selected period, and recognized commission in that period. Mark the first two “Live now”; the date filter does not change their meaning.

Main area: live map and active-trip preview. Attention rail, ordered by severity and age: safety cases when implemented, courier handoff locks/returns, overdue scheduled activation, payment mismatches/stuck payouts, and pending applications. Each item links to a filtered queue or detail page. Show “Observed” rather than “New” where read/unread state is not persisted.

Below the main area: fulfilled trips by hour and an operational outcome breakdown; finance preview links to reconciliation. Charts require labels, units, period, exact-value tooltips and an accessible data view. Omit percentage change when the comparison denominator is zero; use “No comparison available.”

```text
┌ Sidebar ────────┬ Breadcrumb / Search / Test or Live / Staff ────────────────┐
│ Logo           │ Operations overview       Lagos · WAT       Date range    │
│ Overview       │ Active now | Available now | Completed rides | Commission  │
│ Operations     ├─────────────────────────────────┬─────────────────────────┤
│ People         │                                 │ Requires attention      │
│ Money          │ Real Google Maps                │ Severity · reason · age │
│ Care           │ Live trip / driver markers      │ Open matching queue     │
│ Insights       │                                 │                         │
│ System         ├─────────────────────────────────┴─────────────────────────┤
│                │ Active-trip preview / hourly service outcomes             │
│ Staff / Theme  │ Data timestamp and scope                                  │
└────────────────┴───────────────────────────────────────────────────────────┘
```

This is a layout wireframe, not an illustrated map or a working UI. The implementation must mount actual Google Maps in the map region.

### ADM-03 — Live operations [P0 · Extension]

**Layout:** about 65% map, 35% scrollable queue. Filters: passenger/courier, status, live availability, location freshness and viewport. Start at Lagos; Lekki/Amuwo can be navigation shortcuts, not invented database service zones.

Queue fields: short trip ID, service, status, pickup → destination, waiting/elapsed time, assigned driver and location age. Clicking a row highlights the map; clicking a marker highlights the row. Preserve the current map view unless “Follow selected trip” is enabled. A visible “Search this area” control prevents hidden global-query changes during panning.

Driver detail: name, current availability, approved status, courier opt-in, vehicle/plate, active trip and location timestamp. Nearby-driver endpoints intentionally exclude busy drivers; do not reuse them as an all-fleet feed. The admin live endpoint needs both approved idle drivers and active assigned drivers, including those allowed to finish a trip after approval changes.

Use Redis freshness and explicit “Location unavailable/stale” states. A map fetch failure must retain a timestamped last-known view and a usable textual queue, never a fabricated map or a false zero-driver count. Large fleets need viewport bounding, server-side caps and marker aggregation; choose an approved implementation before adding a clustering dependency.

Initial actions: inspect trip, inspect driver and open the relevant case when supported. Manual assign/reassign, force-complete and force-offline are unavailable until their business rules and endpoints exist.

### ADM-04 — Trips and trip detail [P0 · Extension]

Directory filters: date basis/range, service, status, payment method/status, rider, driver and ID. Columns: ID, requested time WAT, service, route summary, rider, driver, trip status, payment status, fare. Default sort: most recent request, with ID as a stable tiebreaker. Keep the trip and payment statuses separate.

Detail header: full ID with copy control, service, state, fare and last updated. Tabs:

- **Journey:** real route map, pickup/destination, estimated distance/duration, timestamps and current location where available.
- **Timeline:** `trip_status_history` with actors and reasons; separate trip offers with sent/accepted/declined/expired/rescinded outcomes.
- **People:** rider, driver and vehicle links; permission-scoped contact reveal.
- **Money:** method, hold/settlement/release links, fare/commission/driver earning, refund credits and refundable remainder.
- **Feedback:** participant ratings/comments, with sample count; associated support cases when implemented.

Historical breadcrumbs are sampled evidence, not continuous GPS or proof of exact road traveled. The estimated route is not the actual route. Label both clearly. Do not show a transcript tab as functional until messages are durably stored.

Any future cancellation action must recheck state and authorization in a transaction, append history, release applicable held funds and invalidate/notify relevant views. Staff actor attribution is currently absent from `TripActor` and the history constraint; do not impersonate a rider or label a human intervention “system” to bypass it.

### ADM-05 — Scheduled rides [P0 · Extension]

Default to an agenda grouped by WAT pickup date; optionally add a calendar after list behavior is complete. Filters: upcoming, within activation window, searching, assigned, missed/cancelled and history.

Fields: scheduled pickup, time until/after pickup, rider, route, payment method, saved fare, state, activation/requested time, assigned driver and failure reason. Call out “Funds checked at dispatch” for wallet bookings. Do not mark a scheduled trip “Paid” or a driver “Reserved.”

Show reasons such as insufficient wallet funds, rider already on another trip, pickup window missed or no driver accepted, based on server values. Highlight an overdue unactivated booking as a derived exception; do not silently modify it from the browser. Staff reschedule/cancel requires dedicated capability and state checks. There is no current staff reschedule route.

### ADM-06 — Courier operations [P0 · Extension]

Use list tabs: Active, Returning, Delivered, Returned, Exceptions, History. `completed` displays “Delivered” when `service_type=courier`; preserve the raw status for integrations.

Columns: delivery ID, sender, masked recipient, pickup/dropoff, weight, driver, state, handoff attempts, age, payment status. Detail adds description/instructions, verification timestamp, return reason, reset count and financial history. Never display the handoff code or authentication secrets in admin grids, exports or ordinary case notes.

An exception view highlights locked attempts, exhausted resets, missing live location and returning trips. Show the current limits (five attempts/two sender resets) without offering an unsupported override. Resolution policy for exhausted resets or lost packages must be approved and implemented before advertising automated recovery.

Returned deliveries remain distinct from delivered trips and from cancellation. Show “Original fare settled” only when the saved payment state supports it. No implied surcharge, insurance, recipient SMS or photographic proof of delivery exists today.

### ADM-07 — Riders and customer profile [P0 · Extension]

Directory: ID, name, masked phone/email, account active state, join date, trip count and last trip. Filters: account state, signup date, trip activity and exact authorized lookup. A driver can also be a rider; these are views of the same user identity.

Profile tabs: Overview, Trips, Wallet, Cases, Audit. Overview shows verified-contact indicators, driver-profile link when present and known account state. Wallet data follows finance permissions; a support operator should not receive all ledger fields simply by opening the profile.

Account suspension/reactivation, phone changes and deletion requests are separate proposed workflows. Define active-trip handling, refresh-token revocation and socket disconnection before exposing suspension. Do not add a one-click permanent delete; financial/history retention and deletion policy require explicit decisions.

### ADM-08 — Driver directory and profile [P0 · Extension]

Fields: driver, approval state, vehicle/plate, courier opt-in, live availability, active trip, rating/count and last location timestamp. Finance-authorized views may show earnings balance, cash debt and restrictions. Distinguish application approval, account activity, online availability and payout/account freeze: these are different states.

Profile tabs: Overview, Application & documents, Vehicle, Trips, Earnings, Ratings, Audit. Current vehicle details belong to the driver profile; do not build a multi-vehicle selector on fictional records. “Online hours” and utilization require historical presence data and cannot be derived accurately from a current Redis key.

Suspending future work must not leave an existing passenger or parcel without a finish/return path. The current driver middleware allows some active-trip actions even after approval changes, but disabling `users.is_active` denies authentication. Resolve that difference as part of restriction policy.

### ADM-09 — Driver application review [P0 · Extension]

Three-panel layout: 280 px review queue, flexible document viewer, 320 px applicant/decision rail. Below 1280 px use queue → review navigation.

Queue filters: pending, approved, rejected, submission age. Include approved profiles with a pending second-service application in the pending filter. Fields: applicant, contact, vehicle/plate, confirmed/requested vehicle category, passenger-service status, courier-service status, independent availability preferences, submitted time and age. Review checks personal details, licence, registration and insurance. Support image/PDF loading, zoom and readable file failure states through an authenticated document service. Show independent service decisions and reasons; approving courier must not approve passenger rides, and rejecting a second service must not revoke the first. The implemented contracts are in `docs/features/driver-service-consent.md`.

Actions: approve or reject with reason. Rejection explains what needs correction; it must be visible to the driver's application-status screen. “Request changes” must map deliberately to the existing rejected/resubmit process or receive an approved new status; do not invent a backend status in the UI.

Require server validation of all required application fields/documents, audit actor and time, and optimistic concurrency using the application version/updated time. If another reviewer has decided or the applicant has resubmitted, return a conflict and refresh. Do not silently approve a stale document set. Per-document verification and expiry fields need an approved data-model extension.

### ADM-10 — Payments [P0 · Extension]

Top-up directory: reference, customer, target (wallet/earnings), amount, provider/channel, status, created/paid time, failure reason. Filters: status, target, amount range, reference and date. Current intent states: pending, succeeded, failed, abandoned, mismatch.

Detail traces checkout intent → provider verification/webhook → ledger transaction. Hide access codes, checkout tokens and unredacted provider payloads. Display internal state and observed provider state separately, with verification time. A browser return URL or operator checkbox must not mark a payment successful.

“Verify with provider” is a proposed rate-limited backend action that runs the existing idempotent verification logic; it is not a direct browser-to-Paystack call. A mismatch stays an exception until the backend resolves it. Successful wallet funding is not trip revenue.

### ADM-11 — Wallets and ledger [P0 · Existing actions + extensions]

Account directory: account kind, owner, currency, available balance, frozen state and last posting. Separate rider wallets, driver earnings and system accounts. Show positive earnings and negative cash debt distinctly.

Ledger detail: transaction ID, type, reference, actor, description, timestamp and balanced debit/credit entries. Each entry shows account, side, amount, signed balance effect and resulting balance. Link all entries for a transaction together; do not sum both sides as money moved.

Supported dialogs:

1. **Refund to rider wallet:** completed trip, original fare, prior refunds, remaining refundable amount, amount, reason, recipient and final confirmation. Validate cumulative refunds server-side under lock. Explain that driver's earnings are not automatically clawed back by the present refund service.
2. **Adjust wallet/earnings:** owner, account kind, increase/decrease, amount and reason. Show current and proposed balance where safely known, with “Final balance checked on submission.” Above the configured threshold the backend requires `super_admin`; there is no existing two-person approval queue.
3. **Freeze/unfreeze account:** account kind, current state, reason and explanation of the service-enforced effect. Verify hold-release, settlement and withdrawal behavior before choosing copy; do not promise that freeze blocks only payouts.
4. **Record accounting sweep:** super-admin-only, amount, reason and explicit statement that this records accounting movement. Keep disabled for pilot until reconciliation against an actual external movement and duplicate-evidence policy are approved.

Every successful dialog links to the resulting transaction/audit record. No “Edit balance,” “Delete entry,” bulk refunds or generic “Mark paid.”

### ADM-12 — Withdrawals [P0 · Extension]

Queue: driver, amount, fee, bank name/last four digits, status, request time, age, provider reference and attempt count. States: pending, processing, success, failed, reversed. Show debit, finalization and reversal ledger links in a chronological detail view.

Pending means unresolved, not unpaid money that can safely be resent. Initial actions are inspect and proposed provider verification. Any retry endpoint must verify the original reference, prevent duplicate external transfers and apply outcomes through the existing withdrawal service. A timeout stays uncertain until resolved.

Do not add an “Approve withdrawal” button: the current workflow is automatic and does not contain a human-approval state. Do not let staff rewrite a user's bank account here. Account-name matching, cooldown and OTP belong to the existing payout-account workflow.

### ADM-13 — Reconciliation [P0 · Extension]

Use a compact summary strip and an exception table, not a wall of money cards. Summary: observed Paystack balance/time, ledger gateway balance, difference, payout-in-transit, trip escrow, suspense and cash debt. These values mean different things and must not be merged into “Available platform money.”

Exception groups: top-up mismatches/pending, unprocessed or failed webhooks, pending/processing withdrawals, ledger integrity failures, held funds on terminal trips, escrow variance and provider balance drift.

Current schedules/thresholds are evidence for initial display labels:

- Top-up reconciler: every 10 minutes; considers pending top-ups older than 10 minutes and webhook records older than two minutes.
- Withdrawal reconciler: every five minutes; considers pending requests older than two minutes and processing records older than 15 minutes.
- Escrow check: every 15 minutes. Gateway balance check: hourly.
- Ledger integrity: 01:00 WAT. Finance report: 00:30 WAT.

These are reconciliation eligibility times, not customer SLAs. Show last attempt, last success and data freshness separately. Existing checks largely log/send alerts; a durable admin exception lifecycle is missing. Derived queues can be P0; assignment, acknowledgement and resolution history require persistence decisions.

Known coverage gaps to resolve: `checkStuckEscrow` does not explicitly include `returned` in its terminal-trip query; current daily finance reporting and driver earnings summaries select `completed` and exclude returned courier settlements. Admin totals must use the definitions in section 8 rather than copying those aggregates unchanged.

### ADM-14 — Support cases [P1 · New capability]

Queue fields: case ID, category, severity, customer, linked trip/payment, assignee, state, created time and next response due. Initial categories: trip issue, payment/refund, account access, driver application, lost item and courier handoff/return.

Proposed lifecycle: new → assigned → waiting for customer/internal team → resolved → reopened. Persist internal notes separately from customer-visible messages. Require a resolution reason. Link financial actions to their own audited transaction rather than treating a case comment as a refund.

Detail uses a conversation/activity column and customer/trip context rail. Replies need a real approved delivery channel and recorded delivery state. Do not show “Sent” for a local note. Integrate the mobile help actions with real case creation and replace the placeholder support number before promising availability.

Case storage, message storage/retention, attachments, operating hours and response targets require owner decisions. A support provider or messaging dependency must not be selected silently.

### ADM-15 — Safety incidents [P1 · New capability]

Use a separate restricted queue with severity, current owner, linked trip, last contact, escalation state and next action. Detail may include current trip state/location freshness, participant contact access, factual incident notes and a timeline of response actions.

Proposed lifecycle: open → acknowledged → responding → resolved → reviewed. Record handover and outcome. Access to sensitive notes/evidence and contact reveals must be audited. Never auto-close an incident because the associated trip ended.

The current app does not send persisted SOS/incident events to staff. Do not display a working “SOS live feed” before end-to-end intake and a staffed response policy exist. Emergency calling remains a distinct device action; dashboard tooling must not imply guaranteed emergency response.

### ADM-16 — Ratings and quality [P1 · Extension]

Directory: trip, rater/ratee, service, score, comment and timestamp. Filters: low rating, service, date and participant. Link each item to trip context and a case if one exists. Display count alongside averages; “Not yet rated” is different from a perfect score.

No arbitrary score editing or deletion. Moderation, abuse handling and appeal rules require a separate approved workflow. Returned courier orders currently cannot use the completed-trip rating action. Do not interpret absent ratings as positive outcomes.

### ADM-17 — Reports [P1 · Extension]

Provide operational outcomes, scheduled pickup performance, courier outcomes, driver performance, top-ups, payout aging, cash debt, ledger reconciliation and platform earnings. Use shared date/service filters, explicit date basis and downloadable underlying rows.

Reports run on PostgreSQL historical data. Live availability is a current Redis snapshot; historical supply hours/heatmaps need additional approved collection. Do not calculate a historical utilization chart from today's online count.

Exports must apply the same filters and permission rules as the UI, state WAT/NGN and generation time, escape spreadsheet formulas in user-supplied text and record the requesting operator. Never silently export just the visible 50 rows as a complete report. Start with bounded exports; approval is needed before introducing a large-report job/storage system.

### ADM-18 — Settings, team, audit and health [P0/P1 · Mixed]

**Payment settings [P0]:** show min/max top-up, min/daily-max withdrawal, withdrawal fee, cash debt limit, payout-account cooldown, Paystack balance alert, adjustment threshold, payout-name match policy and transfer-fee tiers. Super admin changes require reason, before/after comparison and validation. Migration values are development placeholders, not approved commercial defaults. Settings GET currently returns snake_case; PATCH accepts camelCase—provide a typed mapping.

**Pricing [P1]:** read fare configuration and show base/per-km/per-minute/minimum fare, commission and active state. Passenger creation currently uses economy; courier uses its own tariff. Do not treat every vehicle card in the app as a supported backend category. Future updates need effective-date/snapshot policy: commission is currently read from live configuration at completion, and estimate caching needs invalidation. Expose pricing read-only until these behaviors are resolved.

**Team [P1]:** staff directory, controlled provisioning/revocation, approved role scopes and session revocation. Prevent self-escalation and removing the last authorized owner. No public role editor; the current app has no staff administration endpoints.

**Audit [P0]:** actor, action, target, reason, timestamp, request key and transaction link. Existing `admin_audit_log` is payment-focused and lacks database-enforced append-only protection and broad object references. Expand/protect it deliberately; do not claim full-system audit coverage today. Sensitive reads, exports, approval decisions and configuration changes need records.

**Health [P0]:** API reachability, PostgreSQL/Redis checks, socket connectivity, trip/payment worker heartbeat, last successful reconciliation and provider observations. `/api/health` currently reports process uptime only. A green response does not prove workers, Redis, database or Paystack are healthy. Dependency/worker telemetry needs implementation; missing instrumentation displays “Unknown,” never “Healthy.” Do not expose credentials or unrestricted infrastructure controls.

## 7. Shared components and interaction contracts

Build these once using the brand system: `AdminShell`, `Sidebar`, `PageHeader`, `EnvironmentBadge`, `Search`, `FilterBar`, `DateRangePicker`, `DataTable`, `StatusBadge`, `MetricSummary`, `MoneyValue`, `Timestamp`, `FreshnessBadge`, `DetailDrawer`, `Timeline`, `DocumentViewer`, `AuditReasonField`, `ConfirmActionDialog` and `QueryState`.

These are proposed component names, not installed packages. Reuse existing Text/Button/Input/Card/StatusPill/Avatar primitives where they fit. Any complex grid/chart dependency requires approval.

### Tables and filters

- Server-side pagination and sorting, stable ID tiebreakers, default 50 and maximum 100 rows for proposed list APIs.
- Search debounced about 300 ms with cancellation of outdated requests. Exact ID/reference lookup remains explicit.
- Sticky headings, clear sort direction, fixed currency alignment and a visible count/scope.
- Selecting a row opens detail; links/buttons inside rows do not also trigger row selection.
- Preserve filters on back-navigation. “Clear filters” is visible when the result set is constrained.
- Read-only exports may be bulk actions; approval/rejection, money actions and suspension are individual actions in the pilot.
- A live update must not move a keyboard-focused row unexpectedly; show “Updates available” where reordering would interrupt work.

### Every data view has explicit states

- **Loading:** meaningful skeleton geometry; do not show zero balances before data arrives.
- **Empty:** explain that the loaded query has no records, with a filter-reset action where relevant.
- **Partial:** identify the failed subsection and allow retry without discarding other data.
- **Error:** plain message, retry and safe correlation ID; preserve valid filters.
- **Stale/offline:** keep a timestamped last-known result, pause freshness indicators and disable actions requiring a current state.
- **Forbidden:** no sensitive payload in the response or cache, even if the screen hides it.
- **Conflict:** “This record changed. Review the latest details before trying again.”
- **Pending mutation/uncertain outcome:** no success toast until confirmed; offer a safe status lookup rather than a second transaction.

### High-impact forms

Use a detail drawer for investigation and a focused modal for final financial confirmation. Show target name/ID, account, direction, amount/currency, reason and expected effect. A confirmation button names the action and amount, for example “Refund ₦2,500 to wallet.” That amount is illustrative, not an actual transaction.

Validate amounts as integer kobo with explicit decimal-input conversion; never rely on floating-point naira arithmetic. Require a nonempty meaningful reason meeting backend validation (at least five characters for current admin money actions). Keep one UUID request key for one confirmed operation and its exact retries. Do not create a fresh key merely because a response timed out.

Existing financial endpoints have differing replay behavior: ledger postings use idempotency keys, while some audit inserts and freeze/settings operations lack complete request deduplication. Verify and normalize this before promising that every admin action is replay-safe. Proposed status lookup must not suggest a mutation-status endpoint already exists.

### Accessibility and map behavior

Target WCAG 2.2 AA: keyboard operation, visible focus, semantic headings/tables, labeled controls, dialog focus trapping/restoration, useful validation announcements and text alternatives for maps/charts. Maintain the project contrast thresholds of 4.5:1 for normal text and 3:1 for large text/essential boundaries. Use a practical 44 px touch/control target where possible; do not rely on tiny icon-only actions. Reference: [W3C quick reference](https://www.w3.org/WAI/WCAG22/quickref/).

Every map selection must also be operable from a list. Preserve Google attribution and accessible map controls; panels must not cover required attribution. Reference: [Google Maps JavaScript policies](https://developers.google.com/maps/documentation/javascript/policies).

## 8. Metric definitions and data ownership

All monetary aggregation uses integer kobo and returns an explicit currency. Use safe integer validation or decimal-string transport for values beyond JavaScript's exact integer range. Format for `en-NG` without losing two-decimal accuracy in detailed financial views. Database UTC timestamps are displayed as WAT; date-range boundaries are converted from Africa/Lagos to UTC.

Every aggregate response includes its time basis, range, filters and `asOf`. Compare matching periods, not a partial day against a full previous day. Live snapshots must be labeled separately from period reports.

- **Active trips now:** current states searching, driver_assigned, driver_arrived, in_progress, returning. Scheduled bookings excluded. Source: `trips`.
- **Available drivers now:** approved and active users with fresh Redis availability/location, no active trip/lock, and current ledger eligibility. Courier availability additionally requires opt-in. Must use matching/business eligibility logic, not count GEO members. Source: Redis plus persisted eligibility.
- **Completed passenger rides:** `service_type=ride`, status completed, `completed_at` in range.
- **Delivered courier:** courier completed, `completed_at` in range. **Returned courier:** returned, `returned_at` in range. Keep separate operational counts.
- **Settled service value:** sum fare for settled completed trips and settled returned couriers, using completion/return time. Label this booked service value, not bank cash received or platform profit.
- **Recognized commission:** net ledger postings to `revenue_commission` in the posting period; reconcile to trip commission links. Do not sum customer top-ups as revenue.
- **Platform earnings view:** show commission, fees and identified ledger expenses separately. Avoid a “Net profit” label until finance approves the treatment of taxes, payroll, incentives and other off-ledger costs.
- **Completion rate:** among passenger trips whose `requested_at` is in the selected cohort, completed / terminal passenger outcomes (completed + cancelled + no_drivers_found); show still-active count separately and label the cohort. Exclude pre-activation scheduled cancellations or report them separately; do not mix time bases.
- **Offer acceptance rate:** accepted / (accepted + declined + expired), measured on offer creation cohort. Exclude rescinded and show outstanding sent offers separately. This differs from the fraction of requests that found a driver.
- **Pickup wait:** arrival minus request/activation for immediate trips with both timestamps; display median and p90. Scheduled punctuality compares arrival to `scheduled_at`, not original booking creation.
- **Successful top-ups:** succeeded intent amounts by `paid_at`, reconciled to ledger credits. Separate wallet and earnings targets.
- **Payout success volume:** successful withdrawal amounts by completion time, with reversed/failed outcomes shown separately. Reconcile historical reversals to ledger postings rather than treating today's mutable status as a complete historical cash report.
- **Pending payout exposure:** pending + processing amounts and fees as of now, with age bands; do not imply approved future payouts are bank cash already sent.
- **Cash commission debt:** magnitude of negative driver-earnings balances as of now. It is driver debt, not total cash fares held by the platform.
- **Escrow outstanding:** ledger `escrow_trips` balance, compared with held-trip obligations. Terminal held trips, including returned, are exceptions.
- **Gateway drift:** observed provider balance minus ledger gateway balance, with both observation timestamps; a nonzero difference prompts investigation rather than automatic adjustment.
- **Driver approval backlog:** pending profiles, aged from submission. **Approval turnaround:** reviewed minus submitted, with resubmission limitations disclosed until application versions exist.
- **Ratings:** count plus average, segmented by service and role; report unreviewed/unrated separately.

Source ownership: PostgreSQL owns persistent people/trips/ledger/audit; Redis owns live position and ephemeral dispatch state; Paystack owns external payment/transfer outcome, verified by the server. Browser/Zustand state is a cache, never the authority for balances or trip state.

## 9. Backend and API implementation contract

### 9.1 Existing staff endpoints — verified routes

All are under `/api/admin/payments` and require `requireAuth` plus `admin`/`super_admin` unless restricted further:

- `GET /users/:userId` — balances, recent entries, intents, withdrawals; limited history, not a people-profile endpoint.
- `POST /refunds` — `tripId`, `amountKobo`, `reason`, UUID `requestKey`; completed-trip wallet refund.
- `POST /adjustments` — `userId`, `account` (wallet/earnings), `direction` (credit/debit), `amountKobo`, `reason`, `requestKey`; threshold can require super admin.
- `POST /accounts/:userId/freeze` — `account`, boolean `frozen`, `reason`, `requestKey`.
- `POST /sweeps` — `amountKobo`, `reason`, `requestKey`; super admin only; accounting movement.
- `GET /settings` — existing settings row.
- `PATCH /settings` — supplied camelCase settings, `reason`, `requestKey`; super admin only.

Validate legacy response shapes with TypeScript adapters. Do not assume all existing routes return a common envelope, camelCase fields or string amounts. Do not call customer endpoints with a substituted customer token to obtain admin access.

### 9.2 Proposed APIs — none implied to exist

Prefer `/api/admin` as the public namespace, with business logic delegated to approved domain services within the existing modular monolith. Domain ownership below is conditional on resolving the placement rule in section 2.5.

- **Auth/access owner:** staff permissions/session capabilities, staff directory and approved provisioning/revocation.
- **Trips/matching/location owners:** `GET /overview`, `GET /live`, `GET /trips`, `GET /trips/:id`; authorized location feed, timeline/offers/history, and specifically approved trip actions. Scheduled/courier views filter the same trip resource.
- **User/driver owners:** `GET /users`, `GET /users/:id`, `GET /drivers`, `GET /drivers/:id`, `GET /driver-applications`, `GET /driver-applications/:id`, authenticated document fetch and `POST /driver-applications/:id/review` with expected version and reason.
- **Payments owner:** global intent/withdrawal/account/transaction search and detail; user-history pagination; refund eligibility/remainder; reconciliation summaries; targeted provider verification/retry actions; settings and money actions above.
- **Audit/settings owners:** paginated audit query, service-health aggregation and approved fare-config reads/updates.
- **Support/safety owners [new, approval required]:** case/incident create/read/update, assignment, messages, attachments, timeline and permissioned mobile intake.
- **Reporting owner:** metric aggregates and filtered export endpoints; query domain-owned data without moving business logic into `server.ts`.

A route inventory and typed request/response definitions must be committed before page implementation. New module/table/service/dependency proposals need approval first; this specification creates none.

### 9.3 Shared API rules

- New lists return `items`, `nextCursor`, `asOf` and applied scope; counts must state whether exact. Sort/filter allowlists and all values use parameterized queries. Cursor includes timestamp plus ID to handle ties.
- Detail responses include version/updated time, source timestamps, permitted fields and `allowedActions` for UI guidance. Server enforcement is still mandatory on every action.
- Explicit boolean/value parsing; reject invalid dates, unsafe money, unknown statuses and unsupported filters. Do not silently coerce an invalid amount to zero.
- New mutations record actor from authentication, reason, request key, target and outcome; never accept an actor ID supplied by the browser.
- Use row locks and explicit transactions for ledger/trip changes. Reuse the state machine and Redis `SET NX EX` driver lock. Do not implement concurrency control in browser state or process-local flags.
- Return stable errors: 401 expired/invalid session; 403 denied; 404 unavailable/unauthorized object as appropriate; 409 changed state/conflict; 400 invalid input; 429 rate limit; 5xx unavailable. Provide safe retry guidance.
- Revalidate account/application/trip state after acquiring locks. No mutation based only on an old drawer snapshot.
- Staff data routes never expose OTPs, token hashes, delivery secrets, Paystack keys, raw authorization fields or unfiltered webhook payloads.

## 10. Real-time, resilience and performance

Initial page load fetches an authorized snapshot. Socket events update/invalidate relevant records; reconnect always refetches because events may have been missed. Never claim financial success solely from a socket event.

Existing constants include `TRIP_STATUS`, `DRIVER_LOCATION`, `WALLET_UPDATED` and trip messaging/offer events in [`events.ts`](../../backend/src/websocket/events.ts). Existing trip-room joining checks rider/driver participation; staff do not automatically have access. Add separately authorized staff subscriptions with explicit permission checks, field filtering, bounded scope and revocation behavior. Store new event names in the same constants file. No global broadcast of every rider/driver followed by browser filtering.

Current position records expire after 30 seconds. Show event age and derive stale/missing states from server time and source timestamps. Do not show an expired coordinate as live or reconstruct live location from Postgres breadcrumbs. Preserve an explicitly labeled last-known point only while it remains in the client snapshot and allowed retention window.

A Socket.io Redis adapter is required for multiple server instances. Its package/configuration is an approval-required dependency gap. Until resolved, the dashboard must not claim reliable cross-instance live updates; authorized REST snapshots can support degraded operation.

Proposed performance budgets, to be measured on representative data:

- List/overview reads: p95 below one second excluding map tiles/provider latency.
- Initial useful desktop content: under 2.5 seconds on the agreed test environment.
- Selected-trip movement: render within two seconds after receipt of an authorized location event; this does not promise the driver emits every two seconds.
- Coalesce location redraws, pause background-page polling and cancel obsolete requests.
- Fallback list polling: around 15 seconds while visible; slower finance summaries around 30–60 seconds. Provider verification is backend-controlled and rate-limited.
- Lazy-load large maps/documents; fetch only visible data. Add indexes from measured query needs through reviewed migrations, not speculative tables.

Do not auto-repeat refunds, adjustments or transfers on reconnect. Re-read state and preserve the operation key. Provider webhook authenticity and delayed outcomes must remain server responsibilities; [Paystack recommends webhook-driven updates and origin verification](https://paystack.com/docs/payments/webhooks/).

## 11. Authorization, audit and financial safeguards

### Current roles and proposed access scopes

- Ordinary `user`: no admin endpoint, document or socket subscription access.
- Current `admin`: existing payment inspection/refund/freeze/adjustment access, with adjustment threshold enforced by backend.
- Current `super_admin`: above plus sweeps and payment settings writes.
- Proposed operations scope: operational reads and approved driver review; no money mutation.
- Proposed support scope: masked people/trip lookup and case management; financial corrections require authorized finance action.
- Proposed finance scope: payment/ledger/payout reads and bounded actions; no automatic access to sensitive safety notes.
- Proposed safety scope: restricted case/contact/location access required for assigned work.
- Proposed analyst scope: approved aggregate/report/export access; no operational writes.

Define these scopes in the server before team rollout. Separate staff credentials/session handling from mobile role switching. For a browser admin shell, settle refresh-token storage and anti-CSRF/XSS controls as part of deployment design; do not copy mobile AsyncStorage token persistence into a privileged web session by default.

### Required operational safeguards

- Backend authorization and object/field scope on every request, download, export and subscription.
- Staff session revocation and role changes take effect for live sockets as well as future HTTP requests.
- Sensitive reads, document viewing, contact reveal and exports are auditable.
- All money corrections append balanced ledger transactions; the UI offers no direct SQL or arbitrary balance editor.
- Financial permission limits are backend-enforced. A real two-person approval workflow needs persisted requests, independent reviewers and immutable decisions; the current super-admin threshold is not that workflow.
- Wallet refunds and provider refunds remain separate features. [Paystack provider refunds have their own processing lifecycle](https://paystack.com/docs/payments/refunds/); that lifecycle is not implemented by the existing wallet-credit endpoint.
- Withdrawals remain webhook-driven with reconciliation. Provider balance includes transfer fee needs; keep funding visibility current. Reference: [Paystack transfer management](https://paystack.com/docs/transfers/managing-transfers/).
- Audit writes for successful mutations commit atomically with the business change where possible. Protect audit records from modification/deletion; store safe before/after values and correlation IDs without secrets.
- Account deletion, contact retention, uploaded documents, messages, locations and incident evidence need a business-approved retention/access policy. Do not invent a legal retention duration in the UI specification.

## 12. Implementation sequence and deliverables

### Phase 0 — Resolve contracts and readiness

Confirm admin client location/stack, module placement, schema reality, staff provisioning, role scopes and required schema changes. Produce the route/type inventory, approved metric definitions and a list of commercial settings. Check which migrations are actually deployed. Keep existing working-tree changes intact.

Deliverables: decision record, API contract, permission specification, test/live configuration and first staff login path. No new framework, ORM, service or table is assumed approved.

### Phase 1 — Shell and read-only operational vertical slice

Build semantic-token shell, tables, filters, drawers and query states. Connect overview, trip lookup/detail, live map, scheduled rides, courier views and people directories to authorized real data. Add audit/health reads and protected document access. Implement staff-wide queries before wiring screens that depend on them.

Deliverables: keyboard-usable light/dark UI at target widths, real Google Maps, linked entities, correct statuses and freshness. Use explicit test fixtures only in development; never mix illustrative values into operational APIs.

### Phase 2 — Driver review and finance operations

Add application decisions and concurrency checks. Connect money investigation, complete account history, refund eligibility, existing controlled mutations and reconciliation. Resolve mutation retry semantics and audit completeness. Keep accounting sweep and tariff edits disabled until policy gaps are closed.

Deliverables: end-to-end test-mode application review, wallet refund/adjustment, freeze impact verification and provider-outcome investigation. Run meaningful integration tests for concurrency and duplicate delivery.

### Phase 3 — Support, safety, scoped staff and reports

After data-model approval, add durable cases/incidents and mobile intake, staff access management, masked sensitive reads, export controls and operational reports. Replace prototype support interactions with real confirmed submissions.

Deliverables: named case owner, delivered reply state, restricted safety timeline, audited staff changes and correctly scoped exports. Confirm staffing and escalation outside the UI.

### Phase 4 — Approved growth features

Only introduce campaigns, memberships, additional vehicle classes, zones, fleet management and advanced analytics when their product rules, data and services are ready. Do not populate deferred navigation with fake functional pages.

## 13. Acceptance criteria and test plan

### Design and usability

- [ ] Uses the supplied logo and current semantic tokens in light/dark/system modes; no second runtime palette.
- [ ] Full overview/live/trip/driver-review/finance layouts reviewed at 1440, 1280 and tablet widths; critical forms also reviewed at narrow width and 200% zoom.
- [ ] Real Google Maps renders with attribution; list remains usable on map/key/network failure.
- [ ] All states in section 7 are designed and verified; unavailable metrics never become invented zeros.
- [ ] Keyboard navigation, focus restoration, screen-reader labels, chart alternatives and contrast pass.
- [ ] Currency, timezone, amount direction, date basis and last-update timestamps are unambiguous.

### Business correctness

- [ ] Ordinary users cannot read admin routes/documents or join admin sockets, even by calling APIs directly.
- [ ] Staff-wide trip lookup is distinct from participant-only mobile endpoints.
- [ ] Driver review rejects stale decisions and incomplete submissions; rejected reasons reach the driver.
- [ ] Live availability excludes stale/locked/ineligible drivers, while active trips remain visible.
- [ ] Scheduled rows show activation timing and funds-check behavior; no implied preassignment.
- [ ] Delivered and returned couriers are distinct; returned settlement is included in finance totals where specified.
- [ ] Courier codes and private contact/document fields do not leak into general payloads or exports.
- [ ] A refund displays the wallet destination, honors cumulative limits and does not imply a provider refund.
- [ ] Parallel refunds/adjustments and duplicate/reordered webhook outcomes do not double-post or exceed limits.
- [ ] Timeouts preserve the operation key; retry deduplication and transaction/audit linkage are tested.
- [ ] Payout pending/processing/success/failed/reversed states reflect backend/provider evidence; no UI-only mark-paid path.
- [ ] Refund/adjustment/sweep/hold/settlement totals never double-count both ledger sides.
- [ ] Freeze, account restriction and session revocation behavior is verified through active-trip and payout scenarios.
- [ ] Finance totals include returned courier outcomes; reconciliation exposes rather than conceals unmatched amounts.
- [ ] Multiple API instances deliver correct authorized socket updates after the approved Redis adapter is configured.
- [ ] Support/safety success messages correspond to persisted cases and real delivery, not local state.

### Engineering/release checks

Run `npm run typecheck` in both `backend` and `mobile`, plus the future admin package if approved. Run focused existing tests and add meaningful integration tests for new authorization, concurrency, query filtering and money operations. Do not seed production with demo statistics or exercise real-money mutations as UI tests.

Before live-money release, repeat the external prerequisites in [payments rollout](../features/payments-ledger-rollout.md): real webhook delivery, test transfer outcomes, approved commercial limits and stable callback/webhook hosting. Source-code checks do not establish provider or production readiness.

## 14. Decisions to settle before the affected build

1. **Admin client:** recommended separate staff browser entry with TypeScript and the same backend/theme. Decide whether it lives in existing Expo web routes or a separately approved client. Trade-off: reuse versus desktop-specific ergonomics and release isolation. No new framework is selected here.
2. **Backend placement:** reconcile the literal matching-folder instruction with domain-owned admin services before writing backend code.
3. **Authoritative schema/status vocabulary:** approve documenting current migrations and roles/state machine as the implementation baseline; do not silently revert the working app to the older conceptual schema.
4. **Staff permissions and authentication:** choose initial staff provisioning, scope granularity, browser session storage and privileged step-up. Fine-grained access may require approved schema/dependency work.
5. **Audit expansion:** approve immutable protection, general target/version fields and sensitive-read/export coverage in the existing audit table, or an explicitly justified replacement design.
6. **Support and safety storage:** approve persisted cases/incidents/messages/attachments and retention. These do not fit honestly inside trip status history or ledger tables; new records/tables require approval.
7. **Driver review/documents:** approve private-document serving, durable storage across instances and document-version/expiry requirements. Current local private uploads are not a shared document platform.
8. **Interventions:** decide staff cancellation/reassignment powers, actor attribution and active-trip account restriction behavior. Existing user actions are not admin intervention APIs.
9. **Courier recovery/refunds:** decide exhausted-code resolution, lost package escalation and refunds for returned deliveries. No free-form state override should be introduced.
10. **Pricing/commercial rules:** approve fare/commission values and effective-date policy, especially for scheduled bookings and in-flight trips; remove development placeholders from live configuration.
11. **Money authority:** approve wallet-credit refund policy, adjustment limits, any independent approval workflow and reconciliation evidence for accounting sweeps. Provider refunds remain separate scope.
12. **Multi-instance real time:** approve/configure the Socket.io Redis adapter and verify authorization/revocation across instances.
13. **Historical analytics and zones:** define retained data before promising online-hours, geographic performance, retention funnels or configurable service boundaries.
14. **Operating model:** name staff owners, support hours, safety escalation and notification channels. The document does not assume a 24/7 team.

This document makes those choices concrete for review. It does not add dependencies, tables, services, live payment actions or deployments.

## 15. Evidence and references

### Repository sources

- [Project rules](../../AGENTS.md), [design system](design-system.md), [brand theme](brand/theme-spec.md), [theme contrast evidence](brand/theme-contrast.json).
- [Colors](../../mobile/src/constants/colors.ts), [theme hook](../../mobile/src/constants/theme.ts), [typography](../../mobile/src/constants/typography.ts), [spacing](../../mobile/src/constants/spacing.ts), [logo component](../../mobile/src/components/common/BrandLogo.tsx).
- Existing visual references: [rider home](brand/evidence/after-home-light.png), [driver dashboard](brand/evidence/after-driver-dashboard-light.png), [wallet](brand/evidence/after-account-driver-wallet-light.png). These establish visual direction only; their historic/demo balances and feature copy are not operational data.
- [Express mounts](../../backend/src/app.ts), [authentication middleware](../../backend/src/modules/auth/auth.middleware.ts), [auth types](../../backend/src/modules/auth/auth.types.ts).
- [Trip routes](../../backend/src/modules/trips/trips.routes.ts), [trip service](../../backend/src/modules/trips/trips.service.ts), [state machine](../../backend/src/modules/trips/tripStateMachine.ts), [types](../../backend/src/modules/trips/trip.types.ts), [fare service](../../backend/src/modules/trips/fare.service.ts), [trip queue](../../backend/src/modules/trips/tripQueue.ts).
- [Driver routes](../../backend/src/modules/driver/driver.routes.ts), [driver service](../../backend/src/modules/driver/driver.service.ts), [location service](../../backend/src/modules/location/location.service.ts), [matching locks](../../backend/src/modules/matching/matching.service.ts).
- [Admin payment routes](../../backend/src/modules/payments/admin.routes.ts), [admin payment service](../../backend/src/modules/payments/admin.service.ts), [payment routes](../../backend/src/modules/payments/payments.routes.ts), [ledger](../../backend/src/modules/payments/ledger.service.ts), [reconciliation](../../backend/src/modules/payments/reconciliation.service.ts), [payment workers](../../backend/src/modules/payments/paymentQueue.ts).
- [WebSocket setup](../../backend/src/websocket/index.ts), [events](../../backend/src/websocket/events.ts), [handlers](../../backend/src/websocket/handlers.ts), [process health](../../backend/src/routes/health.ts).
- [Auth migration](../../backend/migrations/001_auth.sql), [trip migration](../../backend/migrations/002_trip_system.sql), [ledger migration](../../backend/migrations/003_payments_ledger.sql), migrations 004–009 in [backend migrations](../../backend/migrations).
- [Scheduled rides](../features/scheduled-rides.md), [courier delivery](../features/courier-delivery.md), [payment rollout](../features/payments-ledger-rollout.md), [current account sections](../../mobile/src/screens/shared/AccountSectionScreen.tsx).

### External research, checked 9 October 2026

- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/) — required project version reference; the app currently declares Expo 57. No SDK migration is proposed.
- [Uber Fleet Hub overview](https://www.uber.com/us/en/earn/fleet-management/) — supports the relevance of driver/vehicle management, earnings reports and a live map. These public fleet-management patterns informed navigation; they are not evidence about Uber's private internal admin system.
- [Paystack webhooks](https://paystack.com/docs/payments/webhooks/), [transfer management](https://paystack.com/docs/transfers/managing-transfers/), [refund lifecycle](https://paystack.com/docs/payments/refunds/) — external outcome and reconciliation semantics.
- [Google Maps policies](https://developers.google.com/maps/documentation/javascript/policies) — map attribution/display constraints.
- [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/) — accessibility target.

The screen composition, priorities, thresholds proposed for UX/performance and implementation sequence are Rakky Ride design recommendations derived from the code investigation. They are not copied competitor requirements or verified production measurements.

### Document verification

On 9 October 2026, all 50 local document links resolved, and `npm run typecheck` passed in both `backend` and `mobile`. This task added documentation only. No application code, schema, dependency, account, payment or deployment was changed. Typechecking is baseline validation of the current working tree; it does not validate the proposed admin screens, provider integration or production behavior.

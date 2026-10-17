# Rakky Ride — gap implementation plan

Prepared 10 October 2026 from [the implementation audit](./ride-hailing-implementation-audit.md). This plan covers all 29 audit items. The audit remains the evidence inventory; this file tracks implementation order, decisions, and verification.

## Working agreement

Implement one bounded change at a time, verify it, and record the result before moving on. Preserve the existing uncommitted work. Keep the current Expo 57 / TypeScript / Zustand / Express / PostgreSQL / Redis / Socket.io / Paystack stack. Do not mark an entire audit item complete after fixing only one symptom.

Start with reliability and truthful core behavior, then customer operations, then optional growth. No production deployment or real-money/provider transaction is part of an ordinary code check. Physical-device checks and staffed operational processes require recorded evidence.

New tables, dependencies, providers, commercial policies, and architecture changes need specific decisions under AGENTS.md. Prepare a concrete proposal at the relevant step; do not invent those decisions to clear a checkbox. The owner approved extending each existing backend domain module, keeping matching for driver matching.

## Sequence and completion checks

### Phase 1 — booking, session, and dispatch correctness

1. **G01 / P0 — authoritative fares.** First remove client rounding/sample fares and stale route estimates. Next bind booking to an accepted server quote, reject expired/changed quotes before any trip/hold, and require explicit reconfirmation. Cover passenger, courier, scheduled, idempotent retry, and receipt paths. Verify displayed/held/settled amounts match, including a price change between estimate and booking. Approved policy: a 15-minute quote lifetime with quiet renewal and reconfirmation when the fare changes.
2. **G12 / P1 — truthful arrival information.** Remove the invented prebooking pickup ETA. Until a driver-to-pickup route exists, show arrival information only after matching, with stale/unavailable location explained. Verify journey duration is never presented as pickup time. A real prebooking availability forecast is a later enhancement.
3. **G02 / P0 — session and socket recovery.** Preserve credentials on transient hydration failure; distinguish expired/revoked sessions from offline state. Refresh/reconnect authenticated sockets with a bounded retry and recover trip/offer state. Verify token expiry mid-trip, offline relaunch, reconnect, refresh rejection, and logout during refresh.
4. **G03 / P0 — active-trip lifecycle.** Check active trips before role switching; clean account-owned stores on logout/account switch; coordinate background tracking with acknowledged server online/offline state. Verify rejected offline action preserves tracking, logout stops this device's tracking, and one user's state never appears for another.
5. **G04 / P0 — dispatch recovery.** Add recovery of committed immediate searches and current driver offers. Make enqueue/recovery idempotent and preserve driver locks/state-machine rules. Define stale-trip escalation rather than cancelling an in-progress journey automatically. Verify crash after commit, queue outage/restart, disconnect during offer, deadline, and escrow release.
6. **G20 / P1 — targeted journey/failure tests.** Add meaningful regression coverage alongside steps 1–5 and the later schedule/courier/payment changes. Build a rider/driver device journey checklist or harness within the approved stack. Done requires execution evidence, not test files alone.

### Phase 2 — real accounts, contact, and communication

7. **G05 / P0 — account persistence/deletion.** Persist editable profile fields; phone changes use verified ownership; avatar uploads use validated private/public asset policy. Replace the logout-only deletion action with a truthful pending/unavailable state until server deactivation, access revocation, active-trip handling, and financial-history retention are approved and implemented. Verify another device/relaunch and revoked credentials.
8. **G06 / P0 — contact, support, safety.** Wire participant phone calling, remove fake call state, connect customer case/incident submission and replies to existing care operations, and replace the sample support contact with configured staffed details. Label text sharing accurately until a protected, expiring live-tracking link exists. Verify authorization, case traceability, external link access/expiry, and a usable stranded-trip path. Decisions: support contact/coverage and sharing/contact privacy.
9. **G11 / P1 — reliable chat.** Remove fabricated messages and premature Sent labels. Add server acknowledgement, retry/idempotency, reconnect replay, bounded payload/rate controls, and an explicit post-trip access rule. Decision: message retention/storage; propose schema only after approval. Verify loss/duplicate/reorder/reconnect and nonparticipant rejection.
10. **G07 / P0 — push and preferences.** Propose the compatible Expo notification dependency/provider and token/preferences model first. Register/rotate/remove device tokens, save permission/consent, send targeted deep-linked events, and provide a permission-denied fallback. Cover offers, arrival, scheduling, payouts, and care replies. Verify foreground/background/locked-device delivery and multi-device/logout behavior.
11. **G19 / P1 — saved preferences.** Implement saved places and trusted contacts with ownership, validation, removal, and communication consent. Decisions: persistent model, contact consent, emergency behavior. Verify relaunch, another device, deleted contact, and unauthorized access.

### Phase 3 — driver operations, money, and trip records

12. **G13 / P1 — document lifecycle.** Restore actual onboarding/vehicle data, display real documents, support approved renewal/expiry/inspection rules, and validate file contents. Decide durable private document storage and backups before claiming multi-instance readiness. Verify access controls, invalid uploads, rejected/resubmitted documents, and expiry behavior.
13. **G14 / P1 — staff intervention.** Review the separate dashboard before duplicating its frontend. Add approved suspension/reactivation, staff provisioning, fare management, and stale-trip intervention. All trip transitions use the state machine; money corrections are append-only. Verify roles, reasons/audits, version races, and incident-to-trip handling. Decisions: operational authority and reassignment policy.
14. **G15 / P1 — money UX.** Surface server limits/fees/cooldowns and pending/error details, recover interrupted checkout, expose payout-account removal, explain wallet-credit refunds, and distinguish driving income from wallet movements. Verify pending/success/failure/reversal and cash/earnings labels against actual ledger entries.
15. **G16 / P1 — history and receipts.** Add cursor pagination, payment/refund status, available actual distance/time, fare breakdown, receipt sharing, and real rating statistics. Verify cancelled/unpaid/held/settled/refunded trips and pagination without duplicates.
16. **G17 / P1 — scheduled reliability.** Add reminders/outcomes via step 10 and test timing/overlap/funding/restarts/deadlines. Preserve the advance-dispatch explanation. Verify activation does not reserve a driver prematurely or create duplicate holds/offers.
17. **G18 / P1 — courier exceptions.** Implement approved return/refund/lost-package escalation and exhausted-code recovery; decouple delivery-code rotation from access-token secrets with a migration strategy. Decide recipient messaging and handoff evidence needs before adding photo/insurance scope. Verify failed attempts, reset exhaustion, return settlement, secret rotation, and staff recovery.

### Phase 4 — launch evidence and operations

18. **G09 / P0 — operating policy/configuration.** Obtain approved passenger/courier tariffs, commission, fees, debt/withdrawal limits, service area, goods/returns/refunds, cancellation/no-show policy, and staffed support coverage. Build one source of truth for configuration and customer explanations. Done requires the owner's approved values, not guessed development defaults.
19. **G10 / P0 — deployment/recovery/readiness.** Fail or report unready when required workers/dependencies fail. Add release/migration procedures, stable HTTPS/callback configuration, backups/restore instructions, graceful shutdown, and actionable failure monitoring. Choose deployment/CI/storage targets before adding infrastructure. Verify dependency loss, worker restart, migration failure, and an actual restore drill.
20. **G08 / P0 — provider/device evidence.** Execute approved test-mode SMS, Google login/maps, Paystack charge webhooks/transfers/reversals, deep links, duplicate callbacks, and reconciliation checks on Android/iOS builds. Record configuration/environment, results, and remaining production steps without recording secrets. Requires provider access and devices; no fabricated passes.
21. **G21 / P1 — release QA/customer policies.** Verify accessibility, font scaling, small screens, denied permissions, weak/offline networks, battery/background behavior, and payment returns. Publish approved terms/privacy/support and data-management behavior. Local operating/legal requirements need appropriate owner/adviser input.

### Phase 5 — optional growth, after core reliability

These remain in the plan; they do not block the first usable MVP. Each requires a product decision and a separately reviewable schema/provider proposal when needed.

22. **G22 / P2 — vehicle categories.** Model approved categories, eligible supply and tariffs; match/request/settle the selected category. Verify no cross-category offers and honest unavailable states.
23. **G23 / P2 — extra stops/destination changes/other passengers.** Define consent, price reconfirmation, routing and contact ownership; validate each state transition and revised amount. Verify driver/rider agreement and ledger adjustments.
24. **G24 / P2 — direct card/tips/tolls.** Use Paystack provider authorizations; never handle card data. Define capture/failure/refund policy and itemized immutable postings. Verify duplicates, interrupted collection, and insufficient funds.
25. **G25 / P2 — waiting/cancellation/no-show/surge.** Implement only approved rules with disclosed price, clocks, limits and audit evidence. Verify boundaries, disputed outcomes, and no undisclosed charge.
26. **G26 / P2 — promotions/referrals/rewards.** Define eligibility, budget, abuse controls, expiry and ledger funding. Replace sample offers/goals with real data. Verify duplicate redemption, exhausted budget, and concurrent use.
27. **G27 / P2 — Plus.** Approve benefits, recurring billing, cancellation/refunds and matching fairness; implement lifecycle and provider-event recovery. Verify renewal/failure/cancellation and accurate entitlements.
28. **G28 / P2 — family/work.** Define invitations, roles, spending consent/limits, billing and statements. Verify membership changes, unauthorized spend, and account separation.
29. **G29 / P2 — fleet/analytics/guaranteed reservations.** Scope these separately against an operating need. Define reporting correctness, fleet permissions and reservation obligations before promising guaranteed supply. Verify data access and fulfillment/failure handling.

## Checks for every implementation step

- Run mobile/backend `npm run typecheck` for the changed layer; run mobile lint when mobile code changes.
- Run focused, meaningful backend tests for changed business/security/money/dispatch behavior. Run the full suite at phase boundaries or when shared behavior changes.
- Review the exact diff against the pre-existing working tree, including failure paths and compatibility.
- Record source checks separately from device/provider/operational verification. Keep any incomplete item open in the audit.

## Progress

- Planning: complete. Implementation order and all 29 audit items are recorded above.
- Scope approved: complete the core first, then plan optional growth. Notification/calling dependencies and providers must be proposed for approval before adding them.
- Pricing approved: server quotes last 15 minutes by default. `TRIP_QUOTE_TTL_SECONDS` in backend `.env` changes the lifetime after restart; each quote reports its own expiry. Review screens renew quotes before expiry and require another confirmation only when the fare changes.
- Deletion behavior approved: deactivate, revoke sessions, refuse active-trip deletion, remove the public profile, retain trip/financial records; retention policy must be decided before launch. **Pending:** handling of nonzero balances/debt and pending payment/withdrawal operations. Recommended: require settlement first. No deletion endpoint has been shipped while that decision is pending.
- Support configuration approved: database defaults, editable through the admin dashboard, with real contacts supplied later. Migration `011_support_settings.sql` has been applied to the configured development database. It contains no invented working phone/email.

### Implemented code and recorded checks — 10 October 2026

1. **G01/G12:** exact server fares replace client rounding/sample fares; account/route/service-bound quotes protect booking prices, expire before booking, and require a fresh confirmation. Rider, scheduled and courier flows use quote IDs. Invented pickup ETA removed. Real Postgres/Redis tests cover tariff changes, ownership, expiry, idempotency and a single exact hold. Backend/mobile must deploy together: old clients without `quoteId` receive `trip_quote_required`.
2. **G02:** transient hydration/refresh failures retain credentials; confirmed rejection clears them. HTTP/socket share token refresh; sockets reconnect/rejoin and recover current offers/trips. Serialized token writes and account generations prevent logout/late-response races and prevent replaying an old account's HTTP request as another account. Native/provider network behavior still needs physical-device execution.
3. **G03:** database-locked mode switches refuse active trips; creation/acceptance check current mode under the same user lock. Logout clears owned stores and tracking. Offline acknowledgement precedes stopping tracking. Persistent active-trip tracking survives navigation, and background start/stop operations are serialized across logout. Native background/permission/offline behavior still needs device evidence.
4. **G04:** dispatch serializes concurrent workers on the trip row; periodic recovery restores missing search/offer jobs, honors original deadlines, recovers driver offers after reconnect, and releases expired-search holds once. Tests use isolated real Redis queues. Worker readiness, bounded recovery scans and stale active-trip intervention remain open.
5. **G05 (partial):** profile name/contact email persist through authenticated server updates. Phone changes use a user/phone/code-specific signed challenge, resend cooldown and atomic OTP consumption. Editable email cannot authorize Google account linking; inactive Google accounts are rejected, and scoped phone verification tokens cannot serve as access tokens. The photo control now explains that uploads are unavailable. The previous logout-only deletion action is now disabled with an honest unavailable message. Deletion awaits the financial decision above; avatar storage/privacy policy and real-device checks remain open.
6. **G06 (partial):** authenticated support settings API, one database row, super-admin audited/versioned update API, dashboard **System → Support settings**, and mobile display/call/email buttons for configured values. App reads on opening, foreground and manual refresh; empty contacts hide buttons. Tests prove customer reads see admin changes, permissions, validation, retry replay, concurrent version conflict and clearing contacts. Customer care submissions/replies, participant calling and protected live-sharing links remain open.

Validation: **62 backend tests passed, zero skipped**; backend/mobile typechecks and mobile lint passed. The sibling dashboard `/Users/mac/Desktop/rakkydashboard` passed typecheck, six existing tests and production build. Settings were tested with disposable schemas/test-only contacts, then only truthful defaults were migrated into the development database. Browser visual verification could not reach the admin page because its staff session was expired; no staff credentials or roles were created for this check. No physical-device/provider/production checks are claimed.

### Authorized follow-up — one Google account across app and dashboard

Staff can sign in to the ride app with the same linked Google identity and receive app-only access. Safe first linking for an unlinked, unambiguous provisioned staff email requires verified Gmail/Workspace identity; other email providers require an existing subject link. Ordinary customer contact emails still cannot authorize Google linking. App responses expose customer permissions while the underlying staff role remains unchanged. Driver mode still requires approval, and staff authentication-profile edits remain protected.

Signed access tokens and stored refresh tokens carry `app` or `staff` scope. Admin routes require staff scope and a current staff database role. Refresh preserves the stored scope and denies staff renewal after demotion. Dashboard phone login now uses the separate staff verification endpoint; customer phone login remains app-only. Legacy sessions have app access only and require a fresh dashboard login. Migration `012_auth_session_scope.sql` was applied to the configured development database; apply it before starting the updated backend elsewhere and deploy the dashboard endpoint update alongside it.

Validation on 11 October 2026: **66 backend tests passed, zero skipped**, covering both Google session types, refresh attempts to change scope, legacy sessions, phone verification, driver approval and app-token denial across admin reads. Backend/mobile/dashboard typechecks, backend/dashboard builds, seven dashboard unit tests and the production dashboard session smoke check passed. The existing background-location test fixture was updated for the device import. Google verification was mocked in disposable database schemas; real-account Google sign-in and physical-device verification remain unclaimed. Other core and growth gaps above remain open.

Continue in phase order after the pending deletion decision. Keep the remaining G06/G11 communication work and its schema/privacy decisions explicit, then obtain approval for notification dependencies/providers. All other core and growth items remain open until their stated completion checks are satisfied.

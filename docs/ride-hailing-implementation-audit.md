# Rakky Ride — implementation inventory and remaining work

Reviewed **10 October 2026**, Lagos time. Repository: `/Users/mac/Desktop/ride_app`. Baseline commit: `62ec86b`, including the existing modified and untracked files in the working checkout.

**Implementation follow-up:** this inventory preserves the original audit findings. Subsequent fixes and verification are tracked in the [gap implementation plan](./ride-hailing-gap-implementation-plan.md). Quote protection, session/lifecycle/dispatch recovery, persistent profile/verified phone changes, and database-backed support configuration now have code and regression coverage; their remaining device/operational checks and other gaps stay open.

## Overall assessment

You have built a substantial ride-hailing MVP foundation: a combined rider/driver app, real maps, phone and Google authentication, driver applications, immediate rides, dispatch, trip tracking, cash/wallet settlement, Paystack wallet funding, driver payouts, ratings, scheduled rides, courier delivery/returns, and staff APIs.

The next stage is to finish the connections between screens and services, resolve lifecycle and pricing gaps, and prove the full flows on real devices. Several account, safety, support, and growth screens currently present sample information or report success without saving anything. The existence of a screen does not make its feature complete.

This document describes the current code, rather than attributing individual changes to a particular author. It is an implementation audit, not a claim that the app is deployed or ready for live money.

## How to read the status

- **Implemented:** meaningful application/service code exists and the inspected path is connected. Still requires the relevant device, provider, and deployment checks.
- **Partial:** some useful implementation exists, but a key connection, behavior, or operational step is missing.
- **UI only:** a screen or interaction exists without its promised service behavior.
- **Not found:** no implementation was found in this repository. This does not establish absence in another project or external service.

**Scope and evidence:** reviewed mobile routes/screens, shared components, services/stores, backend routers/services/workers/WebSockets, SQL migrations, tests, app/build configuration, and existing documentation. Existing uncommitted work was included and preserved. No application behavior, dependency, schema, or provider configuration was changed. No real SMS, charge, refund, or transfer was initiated. No complete mobile journey or deployed environment was inspected.

The backend documentation references a separate dashboard at `/Users/mac/Desktop/rakkydashboard`. Its frontend was outside this audit; the staff APIs in this repository were inspected. Do not interpret this report as saying that no dashboard exists.

## 1. What you have implemented

### App foundation and branding — implemented

- One Expo/React Native TypeScript application with rider and approved-driver experiences.
- Expo Router routes with signed-in and signed-out guards.
- Zustand state for authentication, trips, map data, wallet balances, courier drafts, and UI preferences.
- Rakky Ride logo integration, Inter typography, reusable buttons/inputs/cards, semantic colors, green actions, and financial success/warning/danger meanings.
- Light, dark, and system appearance. The selected preference persists in AsyncStorage; native and NativeWind styles use the same semantic theme.
- A developer component gallery and EAS development, preview, and production build profiles.

Sources: [root layout](/Users/mac/Desktop/ride_app/mobile/src/app/_layout.tsx), [theme](/Users/mac/Desktop/ride_app/mobile/src/constants/theme.ts), [palette](/Users/mac/Desktop/ride_app/mobile/src/constants/colors.ts), [UI store](/Users/mac/Desktop/ride_app/mobile/src/store/uiStore.ts), [EAS configuration](/Users/mac/Desktop/ride_app/mobile/eas.json).

### Authentication and account roles — implemented core, partial account management

- Nigerian phone normalization, registration/login OTP requests and verification, resend cooldown, rate limits, expiry, failed-attempt limits, and one-time consumption.
- Development OTP logging and a Termii SMS provider path for non-development environments.
- Google sign-in integrations for native and web; backend identity-token verification and phone verification for new Google accounts.
- JWT access tokens, hashed refresh tokens, rotation/reuse detection, session hydration, logout, and a backend logout-all endpoint.
- Native tokens in SecureStore; web tokens in sessionStorage. Authenticated HTTP requests and refresh/retry handling.
- Server-controlled active rider/driver mode; driver mode requires an approved application.
- Staff authorization uses platform roles separately from rider/driver mode. Dedicated Google staff login verifies existing staff identity and a browser challenge.

Profile editing, avatar changes, phone changes, deletion, and offline session recovery still need work; see section 2. This is passwordless authentication. Do not add a password/bcrypt flow simply because a generic ride-hailing checklist mentions passwords.

Sources: [authentication service](/Users/mac/Desktop/ride_app/backend/src/modules/auth/auth.service.ts), [OTP service](/Users/mac/Desktop/ride_app/backend/src/modules/auth/otp.service.ts), [Google verification](/Users/mac/Desktop/ride_app/backend/src/modules/auth/google.service.ts), [mobile auth store](/Users/mac/Desktop/ride_app/mobile/src/store/authStore.ts), [token storage](/Users/mac/Desktop/ride_app/mobile/src/lib/secureTokenStore.ts).

### Maps, address selection, and location — implemented core

- Native map integration with `react-native-maps`, Google Maps in native development/release builds, and the Google Maps JavaScript API for web.
- Pickup/drop-off address search, place details, reverse geocoding, map-pin selection, route polylines, and route estimates through backend Google API calls.
- Location permission explanation, current/recent GPS handling, recentering, manual pickup selection, and settings links when permissions are blocked.
- Nearby drivers from Redis geo queries, refreshed in the app, with stale/busy drivers filtered out.
- Driver foreground/background location tasks, online/offline controls, server acknowledgement for foreground updates, and recovery of a previously running background task.
- Redis is the shared live-position store. Postgres stores sampled trip breadcrumbs for history; these are different from the live-position source.
- Animated driver markers and periodically refreshed trip routes. Driver navigation opens Google Maps.

**Provider qualification:** the native component deliberately falls back to the default provider in iOS Expo Go. That is not proof of Google Maps behavior in an iOS development/release build. Validate the configured builds.

Sources: [native map](/Users/mac/Desktop/ride_app/mobile/src/components/map/AppMap.tsx), [web map](/Users/mac/Desktop/ride_app/mobile/src/components/map/AppMap.web.tsx), [maps service](/Users/mac/Desktop/ride_app/backend/src/modules/maps/maps.service.ts), [location service](/Users/mac/Desktop/ride_app/mobile/src/services/locationService.ts), [Redis location service](/Users/mac/Desktop/ride_app/backend/src/modules/location/location.service.ts), [route hook](/Users/mac/Desktop/ride_app/mobile/src/hooks/useTripMapRoute.ts).

### Immediate rider bookings — implemented

- Home destination entry, pickup/drop-off selection, route display, economy ride selection/details, payment selection, and confirmation.
- Backend fare calculation from active fare configuration, with NGN/kobo values, distance/time pricing, minimum fare, and commission split.
- Cash and wallet booking; wallet balance checks and top-up navigation.
- Idempotent creation requests and database protection against multiple active rider trips.
- Searching, assigned driver/vehicle details, arrival, in-progress tracking, cancellation reasons, and no-driver retry/change-pickup paths.
- Ride-again shortcuts based on actual history, rather than fixed sample routes.

**Current scope:** one passenger category, `economy`. Direct card trip payment is explicitly unavailable; Paystack checkout funds the wallet instead. Extra stops, premium categories, tips, surge, and cancellation/waiting fees are not implemented.

Sources: [ride selection](/Users/mac/Desktop/ride_app/mobile/src/screens/rider/RideSelectionScreen.tsx), [ongoing trip](/Users/mac/Desktop/ride_app/mobile/src/screens/rider/OngoingTripScreen.tsx), [trip service](/Users/mac/Desktop/ride_app/backend/src/modules/trips/trips.service.ts), [fare service](/Users/mac/Desktop/ride_app/backend/src/modules/trips/fare.service.ts), [ride-again logic](/Users/mac/Desktop/ride_app/mobile/src/utils/rideAgain.ts).

### Driver onboarding and trip handling — implemented core

- Four application steps: personal details, vehicle details, three required uploads, and review/submission.
- Licence, vehicle-registration, and insurance uploads with allowed MIME types and size limits, stored on private local disk.
- Pending/approved/rejected application status, rejection reasons, and manual status refresh.
- Driver approval gates, go-online/offline, incoming offer countdown, fare and route details, accept/decline, arrival, start, completion, and pre-start cancellation.
- Database constraints plus Redis offer/trip locks prevent competing assignments. The trip lock expires after 60 seconds and refreshes with location updates.
- Earnings and cash commission debt connected to backend balances; driver courier opt-in persists on the server.

The vehicle/document management account page is still sample content. One vehicle's details live in `driver_profiles`; multi-vehicle management, document expiry, and inspection workflows are not modeled here.

Sources: [onboarding screen](/Users/mac/Desktop/ride_app/mobile/src/screens/driver/DriverOnboardingScreen.tsx), [driver service](/Users/mac/Desktop/ride_app/backend/src/modules/driver/driver.service.ts), [dashboard](/Users/mac/Desktop/ride_app/mobile/src/screens/driver/DriverDashboardScreen.tsx), [driver trip](/Users/mac/Desktop/ride_app/mobile/src/screens/driver/DriverTripScreen.tsx), [matching](/Users/mac/Desktop/ride_app/backend/src/modules/matching/matching.service.ts).

### Dispatch, trip state, and recovery — implemented core, partial failure recovery

- Expanding search radii, one-driver-at-a-time offers, offer expiry, decline progression, search deadlines, and maximum offers.
- BullMQ queues/workers for dispatch, offer timeouts, search expiry, scheduled activation, and maintenance.
- Explicit transition validation, transaction-backed status changes, and append-only status history.
- Current ride sequence: `searching → driver_assigned → driver_arrived → in_progress → completed`, with permitted cancellation/no-driver outcomes.
- Authenticated Socket.io, participant-authorized trip rooms, targeted driver/user/trip events, and a Redis adapter for multiple backend instances.
- Mobile recovery on launch/foreground/reconnect and polling while searching. Active trip data comes from the backend.
- Stale assigned/in-progress trips are detected and logged.

Stale-trip intervention, immediate-booking queue recovery, offer recovery after reconnect, and token-expiry recovery need stronger handling; see launch priorities below.

Sources: [state machine](/Users/mac/Desktop/ride_app/backend/src/modules/trips/tripStateMachine.ts), [dispatch](/Users/mac/Desktop/ride_app/backend/src/modules/trips/dispatch.service.ts), [queues](/Users/mac/Desktop/ride_app/backend/src/modules/trips/tripQueue.ts), [WebSocket setup](/Users/mac/Desktop/ride_app/backend/src/websocket/index.ts), [trip recovery](/Users/mac/Desktop/ride_app/mobile/src/components/trip/TripRecovery.tsx).

### Money, wallet, top-ups, and payouts — implemented core; external verification remains

- Double-entry accounting with balanced postings, integer kobo amounts, immutable ledger transactions/entries, idempotency checks, and database row locks.
- Rider wallet and separate driver earnings accounts, paginated statements, real balances, and wallet-update events.
- Wallet fare held in escrow at booking, released for cancellation/no drivers, and settled into driver earnings/commission at completion.
- Cash fare paid directly to the driver; the platform records commission debt. Excess cash debt prevents availability and matching.
- Paystack hosted checkout, server verification of charge amount/currency/reference, provider-fee accounting, and wallet/earnings top-ups.
- Signature-verified raw-body webhooks, durable event records, deduplication, queue retries, and reconciliation of missed/failed processing.
- Bank list/account-name resolution, OTP-protected payout-account creation, masked bank details, account cooldowns, and backend account deactivation.
- OTP-protected withdrawals, minimum/daily limits, available-earnings checks, payout-capacity checks, reserved funds, transfer initiation, outcome processing, and offsetting reversals.
- Scheduled checks for stuck top-ups/withdrawals, ledger integrity, provider balance drift, stuck escrow, and daily finance reporting.
- Staff wallet refunds, balance adjustments, account freezes, payment settings, and accounting sweeps, with reasons and audit evidence.

**Limits:** refund credits currently go to the rider wallet; they are not Paystack card refunds. The refund service accepts `completed` trips, not `returned` deliveries. `gateway_sweep` records accounting entries; it does not initiate a bank transfer. Transfer fees use configured tiers. Removing a payout account has an API/client helper, but the mobile payout page has no removal control.

The existing rollout document records a test-mode wallet top-up, but says an actual `charge.success` webhook and test transfer still need verification. This audit did not repeat those provider checks.

Sources: [ledger](/Users/mac/Desktop/ride_app/backend/src/modules/payments/ledger.service.ts), [SQL ledger protections](/Users/mac/Desktop/ride_app/backend/migrations/003_payments_ledger.sql), [settlement](/Users/mac/Desktop/ride_app/backend/src/modules/payments/tripPayments.service.ts), [top-ups](/Users/mac/Desktop/ride_app/backend/src/modules/payments/topups.service.ts), [withdrawals](/Users/mac/Desktop/ride_app/backend/src/modules/payments/withdrawals.service.ts), [reconciliation](/Users/mac/Desktop/ride_app/backend/src/modules/payments/reconciliation.service.ts), [mobile money screens](/Users/mac/Desktop/ride_app/mobile/src/screens/shared/WalletSections.tsx), [existing rollout evidence](/Users/mac/Desktop/ride_app/docs/features/payments-ledger-rollout.md).

### History, receipts, and ratings — implemented core

- Participant-scoped history and trip-detail endpoints; backend cursor pagination and status/service filtering.
- Rider and driver history views, receipt/detail screens, real fares/vehicle details, and completed-trip rating/comment submission.
- Both participants can rate; the backend blocks duplicate ratings and updates the recipient's rating average/count.

**Limits:** the account history screen loads only the first page. Receipts have no PDF/email export or itemized fare/payment breakdown. Account/dashboard rating badges still display fixed `5.0` values. Rating submission after an earlier rating needs a friendlier UI state.

Sources: [history/rating service](/Users/mac/Desktop/ride_app/backend/src/modules/trips/trips.service.ts), [history page](/Users/mac/Desktop/ride_app/mobile/src/screens/shared/AccountSectionScreen.tsx), [receipt](/Users/mac/Desktop/ride_app/mobile/src/screens/shared/TripReceiptScreen.tsx), [rating screen](/Users/mac/Desktop/ride_app/mobile/src/screens/shared/TripCompletedScreen.tsx).

### Scheduled rides — implemented MVP

- Lagos-time pickup selection from 30 minutes to seven days ahead.
- Advance booking, upcoming list, cancellation, overlap prevention, and normal cash/wallet selection.
- No driver reserved and no wallet hold at booking. Worker activation starts search within five minutes before pickup, checks every 30 seconds, and holds wallet funds at activation.
- Activation cancellation reasons for insufficient funds, unavailable wallet, conflicting active trip, or missed time.
- Recovery of scheduled searches that were activated but not queued; retries while no drivers are available, with a pickup-plus-five-minute search deadline.

**Limits:** this is advance dispatch, not a guaranteed reservation. No reminder push/SMS, driver preassignment, scheduled courier, or demonstrated end-to-end device verification.

Sources: [schedule screen](/Users/mac/Desktop/ride_app/mobile/src/screens/rider/ScheduleRideScreen.tsx), [scheduled service logic](/Users/mac/Desktop/ride_app/backend/src/modules/trips/trips.service.ts), [activation worker](/Users/mac/Desktop/ride_app/backend/src/modules/trips/tripQueue.ts), [feature notes](/Users/mac/Desktop/ride_app/docs/features/scheduled-rides.md).

### Courier delivery and returns — implemented MVP

- Separate package flow with description, weight up to 5 kg, recipient name/phone, optional instructions, and restricted-item acknowledgement.
- Pickup/drop-off selection, courier tariff, wallet-only payment, and dispatch only to approved drivers who opted in.
- Pickup arrival/collection, live tracking, recipient phone dialling, sender delivery-code retrieval/sharing, and six-digit handoff verification.
- Five failed code attempts lock verification; sender code rotation resets attempts up to twice.
- Recipient-unavailable return flow: `in_progress → returning → returned`. Driver remains busy and the original fare settles at verified return, without a surcharge.
- Delivery/return receipt and status handling.

**Limits:** no recipient SMS, package photos, pickup handoff code, insurance integration, scheduled courier, returned-delivery refund policy, or staff recovery for exhausted resets. Delivery codes derive from the JWT access secret; coordinated secret rotation is necessary until this dependency is redesigned.

Sources: [courier form](/Users/mac/Desktop/ride_app/mobile/src/screens/rider/CourierScreen.tsx), [courier review](/Users/mac/Desktop/ride_app/mobile/src/screens/rider/CourierReviewScreen.tsx), [delivery verification/return service](/Users/mac/Desktop/ride_app/backend/src/modules/trips/trips.service.ts), [courier notes](/Users/mac/Desktop/ride_app/docs/features/courier-delivery.md).

### Staff operations APIs — implemented backend; separate UI not reviewed

- Staff-only overview, users/drivers/application directories, search, details, reports/export, pricing reads, ratings reads, health/environment, and restricted team reads.
- Live driver/trip map snapshots and trip-position reads.
- Private application-document reads and approve/reject decisions, with version checks and audit records.
- Finance directories/details for intents, withdrawals, ledger accounts/transactions, reconciliation exceptions, refund eligibility, and operation status.
- Payment actions described above, with staff role restrictions and request/replay protection.
- Support-case and safety-incident creation, assignment, notes, valid state changes, and immutable activity/audit history. Safety access is more restricted than support access.
- Pagination/filter validation, masking on relevant staff responses, and `Cache-Control: no-store` on staff routers.

**Limits in this backend:** customer support/safety submission and customer replies are not connected to mobile. Staff trip cancellation/reassignment, user suspension actions, staff provisioning actions, document expiry, and fare editing are not implemented in the inspected routers. Staff communication delivery is not implemented merely because care activity has a delivery-status field.

Sources: [registered routers](/Users/mac/Desktop/ride_app/backend/src/app.ts), [staff API reference](/Users/mac/Desktop/ride_app/backend/docs/admin-api-reference.md), [driver review](/Users/mac/Desktop/ride_app/backend/src/modules/driver/admin.service.ts), [care service](/Users/mac/Desktop/ride_app/backend/src/modules/care/care.service.ts), [finance API](/Users/mac/Desktop/ride_app/backend/src/modules/payments/dashboard.routes.ts).

## 2. Features that still only have an interface

The following are **not complete features**, even if their screens look finished:

- **Profile saving:** `updateProfile` and `completeProfile` modify mobile memory only. No general profile-update endpoint was found. Changes can disappear after hydration. Driver onboarding does save personal information through a different service.
- **Change photo:** the profile control has no action.
- **Delete account:** confirmation calls logout and navigation only. It does not remove/deactivate the account or its data, despite the wording.
- **Support chat and issue reporting:** account actions display alerts. The support telephone is a sample `+2340000000000`. Existing staff care APIs are not wired to these actions.
- **Trusted contact:** an in-memory toggle with no contact entry, persistence, consent, or notification behavior.
- **Share live trip:** the current action shares route/driver text, without a tracking URL or access to live location for the recipient.
- **In-app audio/video calls:** timer and local mute/speaker/camera switches exist, but no media provider/session. Audio can only open a supplied telephone number; current rider/chat navigation does not supply one. Video is disabled.
- **Notification preferences:** local switches; no device push registration, notifications service, or saved communication preferences found.
- **Saved places:** fixed Home/Work addresses; editing opens destination selection rather than saving a place.
- **Privacy/data controls:** an alert, without data export or account-data management.
- **Rakky Ride Plus:** local activated state only; no subscription, billing, benefits, or priority matching.
- **Promo codes/launch discount:** success alert and sample offer; no validation, discount calculation, eligibility, or redemption.
- **Family/Work profiles:** success alerts; no persisted membership/invitations/business billing.
- **Vehicle/document management after approval:** sample car, expiry dates, and alert actions; no actual document renewal/inspection/multi-vehicle management.
- **Driver rewards/goals:** fixed challenges and progress. Dashboard online time/rating/weekly goal also contain sample values.

Sources: [account section](/Users/mac/Desktop/ride_app/mobile/src/screens/shared/AccountSectionScreen.tsx:85), [auth store](/Users/mac/Desktop/ride_app/mobile/src/store/authStore.ts:29), [call screen](/Users/mac/Desktop/ride_app/mobile/src/screens/shared/TripCallScreen.tsx), [notification setup](/Users/mac/Desktop/ride_app/mobile/src/screens/auth/NotificationsScreen.tsx), [driver dashboard](/Users/mac/Desktop/ride_app/mobile/src/screens/driver/DriverDashboardScreen.tsx).

**Trip chat is partial, not UI only:** messages are actually broadcast through participant-authorized trip sockets. However, history is only held in screen state, an initial message is fabricated, and messages are marked Sent before server confirmation. Persistence, replay, delivery acknowledgements, failed-send handling, reconnect recovery, and an active-trip messaging policy remain.

Sources: [chat screen](/Users/mac/Desktop/ride_app/mobile/src/screens/shared/TripChatScreen.tsx:43), [message handlers](/Users/mac/Desktop/ride_app/backend/src/websocket/handlers.ts:64), [socket client](/Users/mac/Desktop/ride_app/mobile/src/services/socket.ts).

## 3. Priority backlog with completion checks

These priorities are audit recommendations based on the inspected code, not approved implementation changes. New schema, major dependencies, infrastructure, or commercial policies need the decisions required by `AGENTS.md` before implementation.

### P0 — finish before accepting real customer trips or live money

- [ ] **Make displayed and charged fares agree.** Mobile ride selection rounds to ₦50 while backend fare calculation rounds to ₦1; creation obtains a fresh estimate without an accepted quote identifier. Example: a backend ₦3,221 estimate becomes ₦3,250 on this screen. Display the authoritative amount and define quote expiry/reconfirmation. **Done when:** selection, confirmation, held amount, trip, settlement, and receipt agree, including estimates changing between requests. Sources: [selection calculation](/Users/mac/Desktop/ride_app/mobile/src/screens/rider/RideSelectionScreen.tsx:59), [fare calculation](/Users/mac/Desktop/ride_app/backend/src/modules/trips/fare.service.ts:5), [creation service](/Users/mac/Desktop/ride_app/backend/src/modules/trips/trips.service.ts:87).
- [ ] **Harden session and Socket.io expiry recovery.** The server disconnects invalid/expired incoming packets. The mobile socket has no explicit refresh/reconnect path for that rejection. Auth hydration clears credentials on any `/me` failure, including temporary connectivity failure. **Done when:** a trip longer than the access-token lifetime, airplane-mode recovery, restart while offline, and refresh failure produce correct state without silently abandoning tracking. Sources: [socket authentication](/Users/mac/Desktop/ride_app/backend/src/websocket/index.ts:28), [mobile socket](/Users/mac/Desktop/ride_app/mobile/src/services/socket.ts:31), [hydration](/Users/mac/Desktop/ride_app/mobile/src/store/authStore.ts:24).
- [ ] **Protect active trips and location across mode changes/logout.** Active-role changes do not check for an active trip. Logout clears map/wallet/socket but does not stop the background location task or clear trip state. The dashboard offline action stops tracking before checking the server acknowledgement; the server rejects offline during an active trip. **Done when:** logout, account switch, role switch, leaving the dashboard, and an offline rejection cannot leak another user's trip or stop required trip tracking. Sources: [role switching](/Users/mac/Desktop/ride_app/backend/src/modules/auth/auth.service.ts:112), [logout](/Users/mac/Desktop/ride_app/mobile/src/store/authStore.ts:35), [online control](/Users/mac/Desktop/ride_app/mobile/src/components/map/DriverOnlineControl.tsx), [offline guard](/Users/mac/Desktop/ride_app/backend/src/websocket/handlers.ts:62).
- [ ] **Recover dispatch when the app/server/queue fails.** Immediate trip creation commits before controller enqueue; no general immediate-search recovery scan was found. Driver offer recovery after reconnect is also absent. Stale trips are logged but not resolved. **Done when:** a crash between commit and enqueue, offer disconnect, missing worker, and stale trip have deterministic retry/escalation without duplicate drivers or trapped wallet holds. Sources: [trip controller](/Users/mac/Desktop/ride_app/backend/src/modules/trips/trips.controller.ts), [queue maintenance](/Users/mac/Desktop/ride_app/backend/src/modules/trips/tripQueue.ts), [stale-trip detection](/Users/mac/Desktop/ride_app/backend/src/modules/trips/dispatch.service.ts:100).
- [ ] **Finish account persistence and truthful deletion.** Implement saved profile/phone/avatar changes and a server-side account removal/deactivation workflow consistent with financial-history retention. **Done when:** changes survive relaunch/another device; deletion revokes access and follows the documented retention policy. Remove misleading success text until implemented. Sources: [account screen](/Users/mac/Desktop/ride_app/mobile/src/screens/shared/AccountSectionScreen.tsx:85), [local profile writes](/Users/mac/Desktop/ride_app/mobile/src/store/authStore.ts:34).
- [ ] **Provide usable contact, support, and safety paths.** Connect customer issue submission to care operations, replace the sample support number, and provide an actual rider/driver contact method. Implement a live-sharing link or label the current action as text sharing. **Done when:** a stranded rider/driver can reach the other participant and staffed support; submitted incidents are traceable; external sharing behaves as described. Sources: [account actions](/Users/mac/Desktop/ride_app/mobile/src/screens/shared/AccountSectionScreen.tsx), [call screen](/Users/mac/Desktop/ride_app/mobile/src/screens/shared/TripCallScreen.tsx), [sharing](/Users/mac/Desktop/ride_app/mobile/src/screens/rider/OngoingTripScreen.tsx:47).
- [ ] **Implement push notifications and persisted preferences.** Register tokens and permission state; deliver offers, arrival, scheduled-ride outcomes/reminders, payout updates, and relevant support messages with deep links. **Done when:** background/locked devices receive appropriate events, denied permission has a usable fallback, and preferences persist. A notification dependency/provider must be selected before adding it. Source: [current notification UI](/Users/mac/Desktop/ride_app/mobile/src/screens/auth/NotificationsScreen.tsx).
- [ ] **Complete provider and physical-device validation.** Verify Termii SMS, Google login/maps on Android/iOS release-like builds, Paystack charge-success webhooks and transfers, callback/deep links, duplicate events, failed/reversed payouts, and missed-webhook reconciliation. **Done when:** captured test-mode evidence covers the complete flows and approved production configuration is ready. Source: [payments rollout](/Users/mac/Desktop/ride_app/docs/features/payments-ledger-rollout.md).
- [ ] **Approve real operating limits and tariffs.** Review passenger/courier fares, commission, fees, payout cooldowns/limits, cash debt, service area, allowed goods, returns, refunds, cancellation/no-show rules, and support coverage. **Done when:** backend configuration and user-facing policy agree; development values are replaced with approved ones. Sources: [fare seed](/Users/mac/Desktop/ride_app/backend/migrations/002_trip_system.sql), [payment settings](/Users/mac/Desktop/ride_app/backend/migrations/003_payments_ledger.sql), [courier seed](/Users/mac/Desktop/ride_app/backend/migrations/005_courier_trips.sql).
- [ ] **Establish deployment, recovery, and operational monitoring.** No CI workflow, backend container/deployment definition, or backup/restore runbook was found here. Public `/api/health` reports process uptime, not dependency readiness. Workers can fail startup while HTTP remains available. **Done when:** migrations/release steps, stable HTTPS/callback hosts, DB/document backups and restore drills, worker/Redis/Postgres readiness, failure alerts, logs, and shutdown behavior are verified. Existing staff health/payment checks are useful foundations. Sources: [startup](/Users/mac/Desktop/ride_app/backend/src/index.ts), [public health](/Users/mac/Desktop/ride_app/backend/src/routes/health.ts), [migration runner](/Users/mac/Desktop/ride_app/backend/src/shared/config/migrate.ts), [reconciliation](/Users/mac/Desktop/ride_app/backend/src/modules/payments/reconciliation.service.ts).

### P1 — complete the reliable MVP and staffed operations

- [ ] **Improve chat reliability.** Remove the invented message; add server-confirmed delivery/failure, replay after reconnect, persistence/retention, and bounded message abuse controls. Define messaging access after a trip ends.
- [ ] **Use real availability/arrival estimates.** The prebooking pickup ETA currently uses a fraction of journey duration, not a nearby driver's route to pickup. Replace it with evidence-based availability/ETA or avoid presenting it as a driver estimate. Keep stale-location state explicit. Source: [current ETA](/Users/mac/Desktop/ride_app/mobile/src/screens/rider/RideSelectionScreen.tsx:60).
- [ ] **Finish driver document lifecycle.** Show actual vehicle/documents, restore saved onboarding details, handle renewal/expiry/inspection and application notifications, validate file contents, and define durable private storage/backup. Local files currently need shared access if multiple backend instances serve document reads.
- [ ] **Complete operational intervention.** Use the existing staff APIs/dashboard for daily work and verify the separate UI. Add approved suspension/reactivation, stale-trip intervention/reassignment, staff provisioning, and fare-management workflows as needed. All trip changes must use the state machine and append-only money corrections.
- [ ] **Finish money UX.** Display payout minimums, fees, bank cooldowns and status/error details before submission; handle pending checkout after restart; add account removal; clarify wallet-credit versus original-provider refunds. Driver `netKobo` treats cash fares as commission debits, so label gross driving earnings versus wallet balance movement clearly. Sources: [mobile money UI](/Users/mac/Desktop/ride_app/mobile/src/screens/shared/WalletSections.tsx), [summary calculation](/Users/mac/Desktop/ride_app/backend/src/modules/payments/payments.routes.ts:36).
- [ ] **Finish history and receipts.** Add mobile pagination, clear refunded/settled/held/unpaid state, actual time/distance where available, fare breakdown, receipt sharing/export, and real rating statistics. Avoid showing a cancelled trip's quoted fare as an unexplained paid total.
- [ ] **Complete scheduled-ride reliability.** Add reminder/outcome notifications and verify activation at timing boundaries, insufficient funds, overlaps, queue/server restart, and already-issued offers at the deadline. Keep the no-guaranteed-driver explanation.
- [ ] **Complete courier exception handling.** Define returns/refunds/lost-package escalation, exhausted code-reset recovery, secret rotation behavior, recipient communication, and evidence of handoff. Add photo/insurance features only if approved for the product.
- [ ] **Persist useful preferences.** Saved places, trusted contacts, and communication consent need real models/endpoints rather than fixed addresses and temporary switches.
- [ ] **Add meaningful journey and failure tests.** Current backend tests are strong foundations; add device/E2E and targeted dispatch/scheduling/code-verification tests. Cover reconnect/expiry, revoked-driver completion, mode switching during a trip, and interrupted payment returns. The current scheduled/courier test exercises schema/state transitions, not every worker or delivery-code path.
- [ ] **Complete release QA and customer policy surfaces.** Verify screen-reader labels, font scaling, small screens, permissions denied, slow/no network, battery/background behavior, production maps/Google login, and payment returns. Add real terms/privacy/support information and data controls. Confirm any applicable operational requirements with the relevant local advisers before rollout; this audit does not assess legal compliance.

### P2 — optional product growth after the core works reliably

These are expansion options, not mandatory requirements for the first usable ride-hailing app:

- [ ] Multiple vehicle classes and category-aware supply/fare matching.
- [ ] Multiple stops, destination changes, and booking for another passenger.
- [ ] Direct card trip payment via Paystack, saved provider authorizations, tips, and itemized tolls/parking if commercially required.
- [ ] Approved waiting/cancellation/no-show pricing and surge rules.
- [ ] Real promotions/referrals/driver incentives with eligibility, budget limits, and ledger postings.
- [ ] Rakky Ride Plus subscription/membership and real benefits.
- [ ] Family and work profiles, shared budgets, billing, and statements.
- [ ] Multi-vehicle/fleet operations, richer demand analytics, and guaranteed scheduled reservations if the business can support them.

Hide or clearly mark optional UI-only features until their actual workflows exist. Additional tables, services, payment behavior, or dependencies require the project decisions described in `AGENTS.md`.

## 4. Current screen coverage

- **Authentication:** welcome, phone/name registration, returning-user login, OTP, profile setup, and notification setup. The current OTP flow creates the session immediately; profile/notification screens retain older setup assumptions and need reconciliation with that flow.
- **Rider:** home, destination selection, ride selection, ride details, ongoing trip, schedule, courier form, and courier review.
- **Driver:** onboarding, application status, dashboard/offer modal, and active trip.
- **Shared:** account menu, account sections, chat, call, completion/rating, and receipt.
- **Money/account sections:** rider wallet, driver wallet, earnings, payouts, add bank, withdrawal, and top-up are connected; the UI-only account sections are listed in section 2.
- **Developer:** component gallery and reusable visual helpers.

There are 28 source files under `mobile/src/screens`, including layout/illustration helpers and developer UI. That is not a count of 28 completed product features. Several route wrappers share one account-section implementation.

## 5. Verification performed in this audit

- **Backend:** `npm run typecheck` — passed.
- **Mobile:** `npm run typecheck` — passed.
- **Mobile:** `npm run lint` — passed, with no reported warnings/errors.
- **Backend:** `npm test` — **32 passed, 0 failed, 0 skipped**. The configured Postgres and Redis integrations ran; database tests used their temporary test schemas.
- Covered checks include fare/state-machine rules, ledger balancing/concurrent debits/immutability, trip assignment/completion races and settlement, top-up/payout retries/reversals, refund limits/concurrency, OTP attempts/atomic consumption, staff access/search/pagination, staff Google challenge validation, and Redis-adapter room delivery/revoked packets.
- Payment tests use test/mocked provider behavior; staff Google tests use controlled verification behavior. Passing them is not evidence of actual SMS delivery, Google production login, a live webhook, or a bank transfer.
- **Not performed:** phone-to-phone rider/driver E2E, foreground/background native QA, app-store release validation, real provider transactions, deployed readiness checks, production migrations/data inspection, load testing, external dashboard UI review, or a complete security/compliance assessment.

The dependency declarations align with the requested Expo 57 baseline: Expo `~57.0.15`, React Native `0.86.2`, React `19.2.3`. The [versioned Expo 57 documentation](https://docs.expo.dev/versions/v57.0.0/) was checked; it lists React Native 0.86, React 19.2.3, and minimum Node 22.13.x. Review the root/backend README's older Node ≥18 and Expo Go guidance against the actual build setup. No dependency upgrade was made.

## 6. Documentation and architecture alignment

- **Root/backend/mobile READMEs:** older scaffold content remains. Backend README describes a health-only API although many modules now exist; root setup points to `mobile/src/api/client.ts`, while the current client is under `src/lib` and services. Mobile README is still an Expo starter guide.
- **Payment gap report:** `docs/features/payments-ledger-gap-report.md` describes the old single-entry write path as current; active code uses double-entry ledger services. Treat that report as historical baseline and label/update it.
- **Screen inventory:** the original 19-screen plan does not describe the complete current route/screen set.
- **Admin specification:** it predates the new staff APIs and still calls some implemented backend capabilities missing. It remains useful for design, not an authoritative current implementation checklist.
- **Project rules:** the current code uses `user/admin/super_admin` platform roles plus `active_role`, expanded trip status names, tables beyond the original core, and an active ledger that retires `wallet_transactions`. Update `AGENTS.md` and architecture docs to describe approved reality. This audit does not assume earlier departures were unauthorized or introduce further changes.
- **Canonical locations:** actual backend configuration/entry/auth middleware live in `src/config/env.ts`, `src/index.ts`, and the auth module rather than every path named in the original structure guide. Document the actual paths.

## 7. Suggested next implementation sequence

1. Fix authoritative pricing, session/socket expiry, and active-trip/location cleanup; these affect otherwise implemented journeys.
2. Finish persistent account management and provide truthful, usable contact/support/safety actions.
3. Connect notifications and strengthen queue/offer/stale-trip recovery.
4. Prove one complete cash ride, wallet ride, scheduled ride, courier delivery/return, and payout on real devices with captured test-mode evidence.
5. Finalize tariffs/policies, staff workflows, deployment/backup/monitoring, and release QA.
6. Expand into promotions, subscriptions, extra categories, and family/work features only after the core pilot is reliable.

Use the unchecked backlog items as the implementation tracker. An item should move to complete only when its behavior and completion checks are verified, rather than when its screen is added.

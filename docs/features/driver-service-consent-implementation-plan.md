# Passenger rides and courier delivery: implementation plan

Prepared 14 October 2026. Implementation added to the working tree on 16 October 2026; see [implemented behavior and rollout](driver-service-consent.md). The initial design below is retained as the implementation checklist.

## Outcome

One person can be approved for passenger rides, courier delivery, or both in the same app. Each approved service has an independent availability preference. Courier-only cars and motorcycles never enter passenger search results, map markers, offers, or assignment. Drivers approved for both can choose either service or both; they can only have one active job across the two services.

Keep the existing modular monolith, PostgreSQL profiles and trips, Redis live locations and locks, Socket.io rooms/adapter, Zustand, Google Maps, and payment flows. Add fields to `driver_profiles`; this plan requires no new table, major dependency, separate app, or account role. Backend eligibility rules belong in the existing matching module; onboarding, trip, location, and staff modules call those rules rather than copying them.

## Starting-point gaps (14 October 2026)

- `backend/migrations/008_driver_courier_preference.sql` adds `accepts_courier`, default false. There is no passenger opt-out.
- `backend/src/modules/matching/matching.service.ts` allows every approved driver for `service_type='ride'`; courier additionally requires `accepts_courier`. Staff supply repeats this distinction.
- `backend/src/modules/location/location.service.ts` returns online approved drivers without a requested service. The controller does not accept a service filter.
- `mobile/src/hooks/useNearbyDrivers.ts` and `mobile/src/services/mapsService.ts` do not pass a service. `SetDestinationScreen` consumes these markers.
- `DriverDashboardScreen` exposes only courier opt-in; onboarding has no service choice or explicit vehicle category.
- Staff approval in `backend/src/modules/driver/admin.service.ts` is one whole-application decision. Material changes to an approved profile currently require review.
- `trips.service.ts` checks account/role and a valid offer during acceptance, but does not revalidate service approval, preference, vehicle category, or current financial eligibility.
- The actual schema uses `users.role` for user/staff authorization and `users.active_role` for rider/driver mode. Keep that existing distinction; courier is a service within driver mode, not a new authorization role.
- `trips.vehicle_type` currently identifies a tariff (`economy` or `courier`). Do not reuse it for physical vehicle category.

## Product rules

1. Registration keeps the existing rider/driver choice and account verification. After verification, driver onboarding starts with “What work do you want to do?”: passenger rides, courier delivery, or both. Require an explicit selection; do not select both automatically.
2. For this release, cars may apply for either or both. Motorcycles may apply for courier only. Passenger motorcycles and bicycles are outside this release.
3. Each service must be requested, have its terms accepted, and be approved independently. Overall profile approval alone never grants a new service.
4. After approval, enable only services explicitly selected by the driver. An approval cannot silently enable an additional service.
5. Dashboard switches control future requests, not cancellation of an accepted job. Both off means unavailable for new work, even if GPS presence is still fresh.
6. A courier-only driver can use the driver dashboard and wallet. Use “Delivery partner” and delivery-specific copy where appropriate.
7. Applying for a second service leaves the already approved service usable. Rejection of the second service does not remove the first approval.
8. A vehicle change remains subject to material review. If it affects existing service eligibility, pause affected new work until review; do not preserve passenger approval after changing a car to a motorcycle.
9. Finish tracking and the state-machine flow for an accepted job even if the driver disables that service for future work. Service suspension blocks new work; handling an existing safety incident uses the existing care process.

## Proposed profile data

Use a forward migration, provisionally `016_driver_service_eligibility.sql` if that remains the next free number at implementation time.

- `vehicle_category`: `car` or `motorcycle`, nullable only for legacy records awaiting classification. Never infer category from make/model strings.
- `ride_service_status` and `courier_service_status`: `none`, `pending`, `approved`, `rejected`, or `suspended`, enforced with database checks. A pending status records a requested service.
- `accepts_ride`: boolean, false by default for new records. Reuse existing `accepts_courier` as the courier availability switch.
- `service_review_details`: JSONB keyed by service, holding submission/review timestamps, reviewing staff ID, and rejection/suspension reason. Keep the current global fields for profile-level compatibility.
- `service_consent_history`: JSONB array of server-created records containing service, terms version, action (`accepted` or `withdrawn`), and server timestamp. Append under a profile row lock; never accept a replacement history or a client-supplied timestamp. Preserve earlier records when terms change. This is explicit service enrollment consent; dashboard availability changes do not rewrite it.
- `service_settings_version`: incrementing integer used to reject stale preference updates and synchronize multiple sessions.

Add constraints rejecting passenger approval/enablement for a known motorcycle and enablement of an unapproved service. Legacy null category is allowed only through the documented migration compatibility path. Global `status='approved'` remains necessary for new work; service statuses further restrict it. Keep global approval while a second service is pending, and keep it approved if one service passes and the other fails. Whole-profile suspension/rejection continues to block all new work.

Use the existing staff audit log for service review decisions, including before/after service state, reason, expected version, and request key. Consent history is not a substitute for that staff audit. If a future requirement needs a separate normalized consent log, propose that table separately rather than introducing it during this work.

## Shared eligibility contract

Implement reusable typed helpers in `backend/src/modules/matching/` for service eligibility, with batch reads for maps/dispatch and a locked assertion for acceptance.

A driver can receive a service request only when all of these are true:

- Account active, driver mode selected, overall profile approved.
- Requested service independently approved, enrollment consent valid for the required terms, and matching availability preference enabled.
- Vehicle eligible for that service, including the narrowly defined legacy compatibility path.
- Redis presence fresh and online; no shared Redis trip lock and no active database trip.
- Existing wallet/debt rules allow new work.

Keep one Redis geo index and one shared trip lock per driver. Never duplicate live locations in PostgreSQL or create independent passenger/courier locks. Read durable eligibility from PostgreSQL rather than trusting client switches or JWT claims.

Use the same rule for nearby markers, dispatch, recovered offers, staff passenger/courier supply counts, and acceptance. A Redis outage or missing eligibility data must not create a fallback that exposes every driver. Active-trip tracking is a separate participant-authorized path and must remain available.

## API contracts

- `GET /api/driver/service-settings`: returns vehicle category, each service status/reason, current preferences, current consent requirement, and settings version.
- `PUT /api/driver/service-preferences`: accepts both booleans and `expectedVersion`; returns canonical saved settings. Reject unknown fields, non-booleans, stale versions, and attempts to enable an unapproved service. Allow both false.
- `POST /api/driver/service-applications`: accepts requested services, expected settings version, and explicit acceptance of the server's current terms versions. Supports initial submission or a second-service request without clearing existing approval. Existing onboarding routes still own personal info, vehicle info, and document upload.
- Extend the existing staff application detail/review routes with per-service decisions, reasons, and version checks. Allow partial approval. Existing staff authorization, private document handling, idempotency, and audit requirements remain.
- Extend the existing nearby route with `serviceType=ride|courier`. Default omitted values to `ride` for older passenger clients, and reject invalid values. Courier callers must explicitly send `courier`.
- Temporarily keep `/api/driver/courier-preference` as a compatibility wrapper around the shared rules. It changes only courier preference and cannot enable courier on an unapproved/unconsented account or override passenger selection.

Use existing authentication middleware for all these routes. Add a service-settings-changed event to `websocket/events.ts` and the mobile constants, emitted after commit to the driver's named room. Clients refetch canonical settings on reconnect/foreground; the event improves responsiveness but is not the safety boundary.

## Implementation sequence

### 1. Data and migration

Add profile fields, checks, typed backend/mobile response contracts, and explicit legacy backfill. Update migration-dependent test fixtures, including tests that enumerate migration names. Prepare a report of approved profiles, existing courier opt-ins, and unknown vehicle categories before production backfill.

Deliverable: fresh install and upgrade both work; new accounts gain no service approval or preference by default.

### 2. Enrollment and independent approval

Extend `driver.service/controller/routes` for service submission/settings and `driver/admin.service/controller/routes` for per-service review. Update application status responses so mobile can show separate outcomes. Preserve approved material restrictions and user-then-profile lock order. Reuse current document requirements until product/operations approve any service-specific alternatives.

Deliverable: a courier-only application can pass; a driver can apply for a second service while retaining the first; staff can approve one and reject the other.

### 3. Enforce eligibility at every backend boundary

Replace ride-always-eligible conditions in matching and staff supply. Make nearby results service-aware while keeping raw Redis geo lookup reusable: a default passenger filter must not accidentally eliminate couriers before courier matching. Revalidate eligibility in dispatch before committing an offer, in current-offer recovery, and in `acceptTrip` before accepting the offer or advancing trip status.

Serialize preferences, consent withdrawal, and service-review changes with acceptance using the same user/profile row locks. Document the combined lock order against current dispatch and acceptance paths and add a race/deadlock test before finalizing it. Do not acquire trip/offer row locks while holding profile locks in a conflicting order. Commit settings first, then cancel incompatible outstanding offers, release owned offer locks, notify drivers, and resume affected searches through existing queue/recovery mechanisms. Recheck eligibility at acceptance so a late offer or delayed notification cannot assign a disabled service. Keep cleanup retryable through existing recovery infrastructure.

Online/GPS handlers must reject new availability when no enabled eligible service remains; an active job still needs its location heartbeat. Presence alone never overrides profile eligibility. Reuse shared Redis `SET NX EX`, DB uniqueness, and trip state-machine validation across services.

Deliverable: server-side separation holds even for stale or modified clients, old offers, reconnects, and concurrent workers.

### 4. Mobile onboarding and dashboard

Extend `DriverOnboardingScreen`, `driverService`, and `authStore` with the service selection, vehicle category, terms acceptance, and separate review outcomes. Extend `DriverApplicationStatusScreen` and account entry points to show “Passenger rides approved / Courier under review” and allow second-service application without restarting the approved profile.

Replace dashboard courier-only control with two independently labeled switches; show approval reasons for unavailable services and a clear “Rides only / Deliveries only / Rides and deliveries / Not accepting requests” status. Keep canonical cross-screen service settings in the existing Zustand auth/driver state, clear on logout, refresh on session changes, and do not let late responses overwrite a different account. Disable controls while saving; surface failures instead of pretending a failed save succeeded.

Pass the selected service through `mapsService`, `useNearbyDrivers`, and `SetDestinationScreen`. Clear old markers immediately on service changes and ignore late responses from the previous service; clear supply markers when refresh fails rather than presenting stale availability indefinitely. Use real Google Maps and semantic theme tokens in both schemes.

Deliverable: a courier-only partner has an understandable delivery workflow, and passenger map markers contain passenger-eligible drivers only.

### 5. Staff visibility and compatibility

Update staff read responses, supply metrics and reasons, and the admin implementation specification to distinguish profile approval from service approval. Show vehicle category and independent decisions in whichever staff client consumes the existing APIs; verify its source location before scheduling UI edits. Audit searches for all remaining assumptions that “approved driver means passenger driver,” including auth routing and current-offer recovery.

Deliverable: staff can explain why a driver is visible for deliveries and absent from passenger supply.

### 6. Verification and controlled rollout

Run the acceptance cases below, backend/mobile typechecks, and relevant isolated integration tests. Roll out backend enforcement before allowing courier-only enrollment in mobile. Enable registration only once all running API instances and queue workers use the new rules; the Redis adapter stays enabled.

Deliverable: courier-only registration is enabled after separation is demonstrated across maps, matching, and acceptance.

## Legacy rollout and rollback

1. Keep existing passenger approval for genuinely passenger-approved accounts and preserve current rider availability through explicit backfill, not new-account defaults. Flag unclassified vehicles for staff classification before broadening enrollment. Preserve pending/rejected global states without granting approval.
2. Treat existing `accepts_courier=true` as historical availability intent, not proof of accepted courier terms or independent courier approval. Have staff confirm courier eligibility and drivers accept courier terms before the courier enforcement cutover. Copy the pre-migration preference into legacy metadata in `service_review_details` and set `accepts_courier=false` until approval/consent are valid; offer restoration of that choice to the driver. This preserves historical intent while satisfying the new enablement constraints. Never invent historical consent timestamps.
3. Ship additive fields and compatible backend endpoints, then complete the existing-driver review/consent window. Coordinate enforcement across workers; do not run unrestricted legacy dispatch beside enforced dispatch. During cutover, rescan outstanding offers and preserve active jobs.
4. Ship mobile service controls, then enable courier-only signup. Older clients omit service on nearby calls and therefore see passenger supply only; old courier toggles pass the new validation.
5. Monitor ineligible offers/accept attempts, map service mismatches, supply by service, settings conflicts, and lost/late notification recovery. Avoid logging exact locations, private documents, or unnecessary recipient details.
6. Rollback disables new service enrollment while retaining backend separation and additive data. Never roll back to unrestricted passenger matching after courier-only accounts exist. If enforcement fails, stop issuing new offers and maps supply rather than routing couriers to passengers. Accepted work continues through existing recovery flows.

## Acceptance checks

- Approved courier-only car and motorcycle: visible for courier; absent from passenger markers, passenger offers, staff passenger supply, and passenger acceptance.
- Approved rides-only car: visible for rides; absent from courier supply and offers.
- Car approved for both: each switch combination works; both enabled can receive either job type, but concurrent ride/courier acceptance produces exactly one assignment.
- Neither switch enabled: no markers/offers and new online availability rejected; an already accepted job continues tracking and can complete.
- Unapproved, rejected, suspended, unconsented, wrong-category, inactive, wrong-role, stale-presence, busy, or financially blocked driver: excluded consistently.
- Preference disabled or approval withdrawn after offer creation: old offer cannot be accepted; search resumes; already accepted work is not silently cancelled.
- Concurrent settings update and acceptance: defined outcome based on committed state under DB locks; stale settings versions rejected; no application-memory lock dependency or deadlock.
- Second-service application pending/rejected: original approved service remains usable and driver mode remains accessible.
- Consent terms change/withdrawal: earlier evidence retained, no fabricated consent; affected new work blocked until valid enrollment is restored.
- Legacy migration, old clients, reconnects, two API instances, dispatch recovery, and queue retries: service separation stays enforced.
- Passenger/courier screen switching with delayed network responses: old service markers never populate the new screen. Verify light/dark labels, disabled switches, and saving/error states.
- Scheduled passenger rides use the same passenger eligibility when dispatch begins. Fare quotes, wallet holds, settlement, delivery codes/returns, and trip transitions retain their current behavior.

Suggested automated home: `backend/src/modules/auth/driverIntegrity.integration.test.ts` and `backend/src/modules/trips/trip.integration.test.ts`, or pass a focused new test explicitly to `npm test -- <path>`. The existing isolated runner discovers auth/trips/payments by default, so a matching-folder test needs explicit inclusion or runner discovery adjustment.

Required implementation checks: `npm run typecheck` in backend and mobile; targeted backend tests through the disposable database/Redis runner; regression tests for trip/payment behavior; manual Android/iOS and existing web map smoke checks. This planning-only change does not run database migrations or claim those feature tests have passed.

## Product decisions before release

- Confirm motorcycle courier document/verification requirements. The first implementation reuses current license, registration, and insurance requirements; do not relax them without a decision.
- Supply the passenger and courier terms text and initial versions. Technical consent capture can be built against versioned contracts, but enrollment cannot launch with placeholder terms.
- Confirm who performs legacy vehicle classification and courier review, and the transition window for existing couriers.
- Confirm whether a later release needs multiple vehicles per account; this plan follows the current single registered vehicle and does not introduce a vehicle-management redesign.

Expo reference consulted as required by AGENTS.md: [SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/). Read the relevant versioned package pages again when implementing mobile behavior; this feature does not call for an Expo upgrade or new package.

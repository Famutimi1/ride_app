# Passenger and courier service enrollment

Implemented in the working tree on 16 October 2026.

## Customer and partner flow

Registration retains the existing rider/driver choice and account verification. No passenger/courier fields were added to the registration page.

After verification, driver onboarding has five short steps:

1. Choose car or motorcycle, then passenger rides, courier deliveries, or both. Motorcycles offer courier only. Neither car service is selected automatically.
2. Personal information.
3. Vehicle information.
4. The existing licence, registration, and insurance uploads.
5. Review the selection and explicitly confirm the displayed service consent before submitting.

The recorded consent describes the request types and completion responsibilities. Its version is `service-choice-2026-10-16`; it does not replace platform contracts. Backend settings supply the displayed wording, and PostgreSQL retains an append-only consent history with server timestamps. Changing the consent version requires updating both `SERVICE_CONSENT_VERSION` and the SQL eligibility function in a forward migration.

Staff approve each requested service independently. A car can qualify for both; a motorcycle can qualify for courier only. The dashboard has separate passenger and courier switches, limited to approved, consented services. Both off means no new work. Disabling future requests does not cancel an accepted job or remove its tracking/finish/return path.

Approved partners use **Manage service applications** to apply for another service without repeating account registration or overwriting approved material. Their existing service remains available while the extra service is reviewed. Service suspension blocks only the selected service; restoring approval leaves that service off until the driver enables it again.

## Backend contracts

All driver routes below require the existing authenticated app session. Staff review retains its admin/super-admin authorization, evidence checks, audit reason, version check, and idempotency key.

- `GET /api/driver/service-settings`: canonical profile category, independent service statuses/preferences, current consent wording/version, settings version, and requested legacy category when awaiting classification.
- `PUT /api/driver/service-preferences`: `{ acceptsRide, acceptsCourier, expectedVersion }`. Both booleans are required; stale versions and attempts to enable an unavailable service are rejected.
- `POST /api/driver/service-applications`: `{ services: ["ride", "courier"], vehicleCategory: "car", consentAccepted: true, consentVersion: "service-choice-2026-10-16", expectedVersion }`. Send only the service(s) being requested. Initial onboarding then calls the existing `/onboarding/submit`; approved partners can request another service without changing overall approval.
- `POST /api/driver/service-consent/withdraw`: `{ service: "courier", expectedVersion }`. Appends withdrawal evidence and disables new requests. The driver must explicitly enroll again before enabling requests.
- `GET /api/driver/application/status`: retains the existing overall status fields and includes `serviceSettings` with the independent outcomes.
- The same application-status response now includes the authenticated driver's submitted `vehicle` metadata and `documents` upload-presence flags. The Vehicle & documents screen uses these fields; no file paths, invented expiry dates, or per-document verification claims are returned.
- `GET /api/location/nearby?...&serviceType=ride|courier`: filters eligible supply for that service. Missing service defaults to passenger rides for older clients. Invalid values return 400. New driver enrollment requires the updated onboarding client.
- Existing courier preference endpoints wrap the new rules. They cannot grant courier approval or alter passenger availability.

Staff `POST /api/admin/driver-applications/:id/review` retains `decision`, `expectedVersion`, `reason`, and `requestKey`. It accepts a `services` object for independent decisions, for example:

```json
{
  "decision": "approved",
  "services": { "ride": "approved", "courier": "rejected" },
  "expectedVersion": "the version returned by application detail",
  "reason": "Passenger requirements verified; courier evidence needs review",
  "requestKey": "a new UUID for this operation"
}
```

Per-service decisions are `approved`, `rejected`, or `suspended`, with transition checks. An omitted `services` object applies the existing decision to pending services only, never to an unrequested service. Staff must include `vehicleCategory` when classifying a legacy profile with unknown category. Account-wide approval is retained if at least one service is approved. A pending directory filter also includes approved profiles with a second service under review.

The separate admin frontend in the sibling `rakkydashboard` repository now renders independent passenger/courier status, preferences, consent evidence, vehicle classification, and service decisions. Its pending queue includes approved partners applying for another service. Live operations filter the queue and markers by the selected service. See `rakkydashboard/docs/driver-service-review.md` for the staff workflow and release checks. Staff review does not alter the driver’s availability preferences.

Drivers can withdraw service consent from **Your services**. A confirmation explains that new requests stop and consent must be accepted again through service applications; accepted jobs remain finishable. The control calls the withdrawal API through the session-aware client and updates the versioned Zustand settings. Request toggles remain the simpler option for a temporary break.

## Connection verification

On 17 October, the full-application HTTP check found and fixed a controller that rejected `service=ride|courier` on driver directories despite service-layer support. Both `/api/admin/drivers` and `/api/admin/driver-applications` now accept this filter. Unsupported service filters on the general user directory remain rejected.

`cd backend && npm run test:connections` builds the sibling dashboard and runs it against the actual Express app with disposable PostgreSQL and Redis resources. Set `RAKKY_DASHBOARD_TEST_ROOT` only if the dashboard is not at the sibling `rakkydashboard` path. The test verifies dashboard server rendering, private-document proxying, authenticated review proxying, CSRF, approval/suspension/restoration, exact retries, driver preference writes, withdrawal/re-enrollment, nearby supply, and staff service scopes. A second Socket.io instance verifies service-update delivery through the Redis adapter. No operational accounts or provider writes are used.

The connected local dashboard runs at `http://127.0.0.1:3015/login`, with `DASHBOARD_PREVIEW=false` and `RAKKY_API_URL=http://127.0.0.1:4000`. Staff must sign in normally. The earlier preview server on port 3016 was stopped to start the connected dashboard with its configured authentication origin. The backend readiness probe returned 200 and migration 016 is present in the local migration manifest.

## Matching and concurrency

`backend/src/modules/matching/serviceEligibility.ts` owns the service checks. The PostgreSQL `driver_service_enabled` function is the common durable predicate. Nearby maps, dispatch, recovered offers, final acceptance, staff supply, and offer push delivery use the service eligibility rules. Account activity, driver mode, wallet debt/freeze state, online presence, and existing work still restrict supply.

There is one Redis driver-location index and one trip lock across both services. A dual-service partner cannot accept a passenger ride and courier delivery simultaneously. Acceptance uses the existing Redis `SET NX EX`, a transaction, and database trip uniqueness.

Trip operations lock the trip before the user and profile; profile-only settings/review operations lock user then profile and commit before offer cleanup. Dispatch skips a locked candidate rather than waiting while holding other candidate locks. Acceptance reads preferences under those same user/profile locks, so an old offer cannot bypass a committed disable or service suspension. Tests exercise preference/acceptance and dispatch/settings races.

Settings changes publish `DRIVER_SERVICE_SETTINGS` to the partner's named room after commit. Incompatible outstanding offers are rescinded and searches resume through the existing queue. Maintenance recovery retries cleanup if post-commit Redis/queue work failed. Clients also refresh on reconnect and foreground; events are not required for assignment safety.

Mobile supply results carry a service tag. Only the focused map polls, old requests are ignored after service changes, mismatched cached markers are hidden, and a failed refresh clears supply markers. Assigned-job tracking remains a separate participant-authorized flow.

## Migration and release

`016_driver_service_eligibility.sql` adds fields to `driver_profiles`, constraints, the eligibility function, and the append-only consent-history trigger. It creates no table or dependency.

The migration preserves existing approved passenger availability through an explicit legacy marker. Category remains unknown until verified; it is never inferred from make/model. Existing courier preference is retained as `legacyCourierPreference` metadata and disabled until the driver explicitly enrolls and staff approve courier eligibility. No historical acceptance timestamp is invented. Existing pending applicants can complete service selection from their status screen without repeating registration or uploads. If a legacy partner declares a motorcycle, passenger availability stops while staff classify that vehicle.

For deployment:

1. Review existing passenger approvals and the courier transition process. Confirm the existing motorcycle document requirements and the operational consent wording.
2. Apply the migration and deploy the service-aware backend to every API instance and queue worker in a coordinated cutover. Do not leave an unrestricted legacy worker serving traffic beside the new matching code.
3. Release the updated mobile app, then admit courier-only partners. Verify ride and courier supply independently.
4. Keep the service enforcement and added data on rollback. Stop new enrollment or offers if needed; never revert to unrestricted passenger matching after courier-only accounts exist.

The migration was applied to the configured local development database. No production deployment was performed.

## Verification

- Full backend isolated suite: 153 tests passed, using a disposable PostgreSQL database and Redis process; includes migration/runtime, service separation, partial approval, suspension, consent withdrawal, staff HTTP review and version replay, inactive legacy suspension, acceptance races, trip recovery, payment, auth, and notification regressions.
- Backend compilation/typechecking and mobile `npm run typecheck` passed.
- Mobile `npm run lint` passed without warnings.
- Expo web export succeeded for all 54 static routes, including onboarding and the driver dashboard.
- Native Android/iOS visual and device smoke checks remain to be performed. A successful web export does not establish native device behavior.

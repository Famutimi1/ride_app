# Notification System Implementation Plan

**Status:** Implemented and migration-ready; physical-device push validation remains a release step  
**Applies to:** Rider and driver modes  
**Mobile:** Expo SDK 57 / React Native  
**Backend:** Express modular monolith, PostgreSQL, Redis, BullMQ, Socket.io

## 1. Purpose

Rakky Ride needs one notification system that supports:

- Foreground in-app notifications.
- Background and terminated-app push notifications.
- Time-sensitive driver ride and courier offers.
- Rider and driver trip lifecycle updates.
- Durable notification preferences.
- A notification inbox with read and unread state.
- Safe navigation from a notification into the appropriate app screen.
- Delivery retries, invalid-token cleanup, and operational monitoring.

The system must work for rider and driver modes in the same application. It must not create a second source of truth for trips or driver location.

## 2. Current Project State

The project already has useful notification foundations:

- Socket.io delivers `trip:offer`, `trip:offer_cancelled`, and `trip:status` events.
- Authenticated sockets join `user:{id}`, `driver:{id}`, and authorized `trip:{id}` rooms.
- The Socket.io Redis adapter supports multiple backend instances.
- Trip offers are stored in PostgreSQL and protected by Redis driver locks.
- Trip changes pass through the trip state machine.
- BullMQ and Redis are already available for background jobs.
- The mobile application recovers active trips when it returns to the foreground.

The implementation added:

- `expo-notifications` and its native configuration.
- Device push-token registration and logout revocation.
- Durable, server-enforced notification preferences.
- A backend notification module.
- A global in-app notification host and ride-offer overlay.
- A persistent notification inbox with read/unread state.
- Push delivery receipts, retry handling, recovery, and invalid-token cleanup.

The signup and account-setting toggles now persist through the notification preferences API and are enforced by the push-delivery worker.

The final implementation audit also added:

- FIFO foreground-banner queuing and socket/push/inbox deduplication.
- Atomic notification creation for top-ups, withdrawals, refunds, driver reviews, care cases, and trip settlement.
- Device revocation in logout, logout-all, and account-deactivation transactions.
- Stable compound-cursor inbox pagination for notifications with identical timestamps.
- Delivery/open timestamps, invalid-token reasons, 24-hour delivery health, and notification queue health in the admin health response.
- Expo batching for accounts with more than 100 registered devices.

## 3. Design Principles

### 3.1 Socket.io remains the live-state channel

Socket.io continues to deliver current trip state while the app is connected. A push notification is an attention and wake-up mechanism; it is not authoritative trip state.

When a user opens a notification, the app must fetch the current resource from the API before displaying actions or making decisions.

### 3.2 State changes create notifications

Notifications are created from committed domain events, such as a valid trip state transition, a completed payout, or a driver-document review result.

Controllers must not assemble notification payloads. The relevant service calls the notifications module after or within its database transaction.

### 3.3 Notifications cannot bypass business rules

Accepting a ride from a notification must call the existing authenticated trip API. It must still use:

- The trip state machine.
- The Redis driver-trip lock.
- PostgreSQL concurrency protection.
- Current offer expiry and eligibility checks.

### 3.4 One event must appear once

Socket and push delivery can overlap while the application is foregrounded. Every notification therefore has a stable event ID. The mobile notification store suppresses duplicate presentation of recently displayed event IDs.

### 3.5 Lock-screen content must be private

Push bodies must not contain:

- Exact home or pickup addresses.
- Phone numbers.
- Courier handoff or delivery codes.
- Authentication codes.
- Sensitive support or safety-report details.

The app can show detailed information after it authenticates the user and fetches the resource.

## 4. Implemented Architecture

The delivery path is:

1. A trip, wallet, document, safety, or support service commits a state change.
2. The notifications module builds a typed notification event.
3. The module checks the user's notification preferences.
4. A per-user notification row is inserted with a stable event key.
5. After commit, the notification is queued for delivery.
6. The backend emits the event to `user:{id}` for connected clients.
7. The push worker sends the notification to eligible registered devices.
8. The mobile notification host deduplicates and presents the event.
9. A notification tap opens an allowlisted route and refreshes server state.

### 4.1 Backend module

Create the following module:

```text
backend/src/modules/notifications/
  notifications.routes.ts
  notifications.controller.ts
  notifications.service.ts
  notifications.types.ts
  notificationTemplates.ts
  notificationQueue.ts
  notificationWorker.ts
```

Responsibilities:

- Validate and register device tokens.
- Store and enforce notification preferences.
- Create idempotent per-user notification records.
- Build privacy-safe notification text.
- Emit foreground notification events to authenticated user rooms.
- Queue and send Expo push notifications.
- Process push tickets and receipts.
- Retry transient delivery failures.
- Disable invalid or unregistered device tokens.
- Serve notification inbox and unread-count APIs.

### 4.2 Mobile structure

Create:

```text
mobile/src/components/notifications/
  NotificationHost.tsx
  NotificationBanner.tsx
  RideOfferOverlay.tsx
  NotificationInboxRow.tsx

mobile/src/services/
  notificationService.ts

mobile/src/store/
  notificationStore.ts
```

`NotificationHost` is mounted once inside the signed-in section of `mobile/src/app/_layout.tsx`.

Responsibilities:

- Request and report system permission.
- Register and refresh Expo push tokens.
- Receive foreground notifications.
- Receive notification responses and cold-start responses.
- Normalize socket and push payloads.
- Suppress duplicate event IDs.
- Display ordinary notification banners.
- Display time-sensitive ride-offer overlays.
- Navigate only to allowlisted destinations.
- Maintain unread count and inbox state.

## 5. Database Changes

These approved tables are created by `backend/migrations/015_notifications.sql`.

### 5.1 `push_devices`

One account can be used on multiple devices, and Expo tokens can rotate. Device registration therefore cannot safely be stored as one column on `users`.

Proposed fields:

- `id`
- `user_id`
- `expo_push_token`
- `platform`
- `device_identifier`
- `app_version`
- `enabled`
- `revoked_at`
- `last_seen_at`
- `created_at`
- `updated_at`

`expo_push_token` must be unique. The full token must not be written to application logs.

### 5.2 `notification_preferences`

Proposed fields:

- `user_id`
- `push_enabled`
- `trip_updates_enabled`
- `driver_offers_enabled`
- `scheduled_reminders_enabled`
- `wallet_updates_enabled`
- `promotions_enabled`
- `sound_enabled`
- `vibration_enabled`
- `created_at`
- `updated_at`

The server, rather than only the mobile UI, enforces these settings.

### 5.3 `notifications`

This table is both the user inbox and the initial durable delivery source.

Proposed fields:

- `id`
- `user_id`
- `type`
- `category`
- `priority`
- `event_key`
- `title`
- `body`
- `data` as safe JSONB
- `deep_link`
- `expires_at`
- `read_at`
- `delivery_status`
- `delivery_attempts`
- `last_delivery_error`
- `created_at`
- `updated_at`

A unique constraint on `(user_id, event_key)` prevents duplicate notification creation.

A separate outbox or delivery table is not required for the first release. A recovery worker can scan queued or retryable notification rows. A separate table should only be introduced if future delivery volume or auditing requirements justify it.

## 6. Notification Types

### 6.1 Driver events

- New ride offer.
- New courier offer.
- Offer expired.
- Offer rescinded.
- Rider cancelled.
- Scheduled trip will dispatch soon.
- Wallet credit posted.
- Withdrawal submitted, completed, or failed.
- Driver application status changed.
- Vehicle or document requires attention.
- Driver document is approaching expiry.

### 6.2 Rider events

- Driver assigned.
- Driver is approaching pickup.
- Driver arrived.
- Trip started.
- Trip cancelled by driver or system.
- No drivers found.
- Trip completed.
- Receipt available.
- Scheduled ride reminder or change.
- Wallet debit, refund, or top-up result.

### 6.3 Courier events

- Driver assigned for pickup.
- Driver arrived at pickup.
- Package collected.
- Package is approaching the recipient.
- Recipient unavailable.
- Package returning to sender.
- Package delivered.
- Package returned.

Delivery and handoff codes must never appear in the push body.

### 6.4 Shared events

- Safety alert.
- Security or session alert.
- Support case update.
- Important account change.
- Optional promotion or tip.

## 7. Presentation Rules

### 7.1 `NotificationBanner`

Use for ordinary foreground events. It contains:

- Title.
- Short body.
- Semantic icon and color.
- Optional safe action.
- Dismiss control.
- Accessible announcement and labels.

Only one banner should be prominent at a time. Additional events wait in the notification store queue.

### 7.2 `RideOfferOverlay`

Driver ride and courier offers require a dedicated component rather than a generic toast.

It contains:

- Service type.
- Pickup distance.
- Privacy-safe route summary.
- Estimated fare.
- Offer expiry countdown based on server time.
- Accept button.
- Decline button.

The overlay closes when:

- The driver accepts or declines.
- The offer expires.
- The offer is rescinded.
- The driver changes out of an eligible state.

### 7.3 Notification inbox

The inbox supports:

- Paginated history.
- Read and unread styling.
- Unread count.
- Mark one as read.
- Mark all as read.
- Category and timestamp.
- Safe deep-link navigation.
- Expired notifications that remain readable but are no longer actionable.

## 8. Preferences and Permissions

Application preferences and operating-system permission are different states and must be shown separately.

Recommended settings:

- Master push switch.
- Trip updates.
- Driver offers, visible in driver mode.
- Scheduled ride reminders.
- Wallet and payout updates.
- Promotions and tips.
- Sound.
- Vibration.
- System permission status.
- Open device settings action.

Turning off push does not stop active trip state updates inside the app. Socket subscriptions and API state continue to function.

Recommended policy:

- Users can disable all optional push categories.
- Promotions are opt-in or easily disabled.
- Safety and security events always remain available in the inbox.
- Whether safety and security push messages can bypass the master push preference is a product decision that must be approved before implementation.

Permission should be requested at a useful moment rather than immediately on app launch. Good moments include finishing signup, going online as a driver, or scheduling the first ride reminder.

## 9. Android Channels

Create explicit Android notification channels:

- `ride_offers`: high importance, short-lived, driver only.
- `trip_updates`: assignment, arrival, cancellation, and completion.
- `scheduled_rides`: reminders and schedule changes.
- `wallet`: payment, refund, payout, and withdrawal results.
- `safety_security`: safety, security, and important account events.
- `promotions`: optional and quiet by default.

Channel creation must happen before requesting notification permission on Android 13 and later.

## 10. Deep-Link Rules

The mobile app must map notification types to a fixed set of destinations. The server must not be able to send an arbitrary URL.

Examples:

- Active trip events → `/ongoing-trip` or `/driver-trip` after fetching the current trip.
- Ride offer → driver dashboard and offer overlay.
- Completed trip → trip receipt or completion screen.
- Wallet event → payment or driver wallet screen.
- Driver-document event → vehicle and documents screen.
- Support event → the referenced support case after authorization.

Every destination must verify the signed-in user can access the referenced resource.

## 11. Backend API

Proposed authenticated routes:

```text
POST   /notifications/devices
DELETE /notifications/devices/:id
GET    /notifications/preferences
PATCH  /notifications/preferences
GET    /notifications
GET    /notifications/unread-count
POST   /notifications/:id/read
POST   /notifications/read-all
```

Example device registration input:

```json
{
  "expoPushToken": "ExponentPushToken[...]",
  "platform": "android",
  "deviceIdentifier": "installation-scoped identifier",
  "appVersion": "1.0.0"
}
```

The API must derive `user_id` from the authenticated session and never accept it from the request body.

## 12. Reliable Delivery

### 12.1 Creation

Where possible, insert the notification row inside the same database transaction as the domain change. The push job is submitted only after the transaction commits.

### 12.2 Recovery

A periodic BullMQ recovery job scans notifications that remain queued beyond a short threshold and re-enqueues them. This closes the failure window between database commit and queue submission.

### 12.3 Retries

Retry only transient failures with exponential backoff. Do not retry:

- Invalid payloads.
- Expired notifications.
- Unregistered device tokens.
- Notifications disabled by current preferences.

### 12.4 Expo receipts

The worker stores Expo ticket IDs and checks receipts asynchronously. A `DeviceNotRegistered` receipt disables the affected token.

Ride-offer pushes include an expiry matching the server-side offer. A delayed push must not revive an expired offer.

## 13. Implementation Phases

### Phase 1: Foundation

- Approve `expo-notifications` and the three new tables.
- Add migration `015_notifications.sql`.
- Create notification types, templates, service, routes, and queue.
- Configure the Expo notifications plugin.
- Add Android channels and notification assets.
- Implement device registration and revocation.
- Implement durable preferences.

Exit condition: a physical iOS and Android device can register a token, receive a test notification, and persist user preferences.

### Phase 2: In-app experience

- Add `notificationStore`.
- Add `notificationService`.
- Add `NotificationHost` and `NotificationBanner`.
- Add notification response and cold-start routing.
- Add event-ID deduplication.
- Add notification inbox and unread count.

Exit condition: one event is shown once when socket and push delivery overlap, and notification history survives an app restart.

### Phase 3: Trip lifecycle and offers

- Integrate driver offer creation and cancellation.
- Add `RideOfferOverlay`.
- Add driver assigned, arrived, started, cancelled, completed, and no-driver events.
- Add courier collection, delivery, and return events.
- Preserve all existing trip and Redis-lock validations.

Exit condition: foreground, background, and terminated-app trip scenarios pass on physical devices.

### Phase 4: Operational events

- Add scheduled ride reminders.
- Add wallet and payout events.
- Add driver application and document events.
- Add safety, security, and support events.
- Add promotions only after preference enforcement is verified.

Exit condition: role and preference rules are covered by automated tests.

### Phase 5: Reliability and rollout

- Add receipt processing and invalid-token cleanup.
- Add retry and recovery jobs.
- Add delivery metrics and alerts.
- Complete lock-screen privacy review.
- Run staged internal and production rollout.

Exit condition: push failures, queue lag, invalid tokens, open rates, and driver-offer latency are observable.

## 14. Testing Plan

### 14.1 Backend unit tests

- Event-to-template mapping.
- Role and preference rules.
- Event-key idempotency.
- Expiry behavior.
- Privacy-safe content.
- Deep-link allowlist.
- Retry classification.

### 14.2 Backend integration tests

- Each trip transition creates the expected notification once.
- Transaction rollback creates no notification.
- Recovery re-enqueues a committed but unqueued row.
- Multiple registered devices receive delivery.
- Revoked devices receive nothing.
- Invalid tokens are disabled.
- Preferences are enforced server-side.

### 14.3 Mobile tests

- Foreground banner.
- Driver offer overlay and countdown.
- Background push.
- Terminated-app push and cold-start navigation.
- Allowed, provisional, and denied system permission.
- Socket and push deduplication.
- Role switching.
- Token rotation.
- Logout and account deletion.
- Accessibility labels and screen-reader announcements.

### 14.4 End-to-end scenarios

- Rider requests a ride while an eligible driver is backgrounded.
- Driver opens the offer and accepts before expiry.
- Rider receives assignment and arrival updates.
- Rider cancellation dismisses the driver's current UI.
- Driver completes the trip and both users receive the correct final event.
- Scheduled ride reminder and dispatch.
- Courier delivery and return without revealing the code in push content.

Remote push notifications must be tested in Expo development builds and on physical devices, not only in Expo Go or a browser.

## 15. Observability

Record metrics for:

- Notifications created.
- Notifications queued.
- Expo push tickets accepted or rejected.
- Receipt successes and failures.
- Invalid tokens removed.
- Retry count and queue age.
- Notifications opened.
- Notification actions attempted.
- Duplicate presentations suppressed.
- Time from domain commit to foreground display.
- Time from offer creation to driver presentation.
- Offer acceptance rate by delivery path.

Logs must use notification IDs and event types rather than full tokens or sensitive payloads.

## 16. Rollout Order

1. Internal development devices.
2. Rider trip updates.
3. Driver ride and courier offers.
4. Scheduled rides and courier lifecycle events.
5. Wallet, payout, document, support, and safety events.
6. Promotions last.

Each stage should have a feature flag or server-side delivery switch so it can be paused without removing application code.

## 17. Definition of Done

The notification system is complete when:

- Users can manage durable notification preferences.
- System permission status is visible and understandable.
- Drivers reliably receive time-limited ride and courier offers.
- Riders receive the important trip lifecycle updates.
- Foreground socket and push delivery never cause duplicate presentation.
- Notification taps navigate safely and refresh authoritative state.
- Notifications remain available in an inbox after restart.
- Logout and account deletion revoke the appropriate device registrations.
- Expired offers cannot be accepted through stale notifications.
- Push receipts, failures, retries, and invalid tokens are observable.
- Type checking and the notification test matrix pass.

## 18. Approved Architecture Decisions

The implementation proceeded with approval for:

1. Adding the Expo SDK 57-compatible `expo-notifications` dependency.
2. Adding `push_devices`, `notification_preferences`, and `notifications`.
3. Creating `backend/src/modules/notifications`.
4. The policy for safety and security alerts when the master push switch is off.

Safety and security messages remain in the in-app history even when push is disabled. They do not bypass the operating-system permission or the user's master push switch.

## 19. Android installed-build troubleshooting

On 16 October 2026, inspection of the connected Samsung Android 15 phone confirmed that its 3 October development APK did not declare `android.permission.POST_NOTIFICATIONS`. Its Android notification app-op was blocked, explaining the greyed-out system setting. The current local APK does declare the permission, but its debug signing certificate differs from the installed EAS APK. Updating JavaScript or installing a differently signed debug APK cannot repair that installation in place. Build an updated EAS APK with the existing signing key, verify its permission and signing certificate, and update without uninstalling the app.

The development EAS environment now supplies the existing Firebase Android client configuration through the secret file variable `GOOGLE_SERVICES_JSON`, as expected by `app.config.ts`. Do not commit that client configuration or copy its contents into logs.

Permission handling now distinguishes browser support, Expo Go, a missing native module, a module-load failure and an OS denial. Settings offer the OS prompt when it can be shown and the device-settings link only for blocked permission; returning from system settings refreshes the displayed state. Signup can request local notification permission on an emulator without attempting remote push registration. Ten permission-flow tests passed, together with mobile/backend typecheck and mobile lint. Physical-device push receipt remains a separate check from declaring and granting the permission.

Physical-device repair completed on 16 October 2026: EAS development build `8438772c-ddcc-4853-9bc9-2643ddb7ac21` finished successfully. The downloaded APK declares `POST_NOTIFICATIONS`, passes APK signature verification and matches the installed app's certificate. It was installed with `adb install -r` without uninstalling; Android retained the original 3 October first-install timestamp and recorded the update on 16 October. The requested notification permission was then enabled and checked on the connected phone. Android reports `POST_NOTIFICATIONS: granted=true` and notification app-op `allow`. Remote push receipt and app-background/cold-start delivery were not tested by this repair.

### Android push delivery credential blocker

Follow-up inspection on 16 October 2026 found an enabled Android device registration and enabled push preferences. An attempted Expo delivery failed with `InvalidCredentials`. Read-only `eas credentials --platform android` inspection confirmed that no FCM V1 Google service account key is assigned to `com.rackyride.app` in EAS. The existing Android client configuration belongs to Firebase project `rakky-ride-f1892`.

`GOOGLE_SERVICES_JSON` is the Android client configuration; it does not supply Expo's server credential for sending through FCM. Configure a service account for that same Firebase project with only the required Firebase Cloud Messaging permissions, then assign its key to the app's FCM V1 credentials in EAS. Credential creation, permission grants and uploading the key require explicit approval. Keep private keys outside version control and logs. See [Expo's FCM V1 credential instructions](https://docs.expo.dev/push-notifications/fcm-credentials/).

The two initially available Google accounts were denied access to this Firebase project. The user then signed in with the project account, and Firebase project access was verified. The user confirmed that the first of the two similarly named Firebase projects is correct: `rakky-ride-f1892`, which matches the app's client configuration; the other project is `rakky-ride`. Firebase confirms that FCM V1 is enabled for the correct project.

The user approved creating a dedicated messaging service account, assigning its key to Expo, and sending one clearly labelled “Rakky Ride push test” notification to their own phone. The user completed Google Cloud's account terms prompt. On 16 October 2026, `rakky-expo-push@rakky-ride-f1892.iam.gserviceaccount.com` was created with the Firebase Cloud Messaging API Admin role (`roles/firebasecloudmessaging.admin`), with no additional role or principal delegation configured.

The in-app browser did not save the generated JSON file; a replacement attempt through its download handler also failed. Chrome successfully saved key `19ea740fd306040e4ef764e25c1714babf208169`. The private file was validated against the intended project and service account, moved outside the repository to `/Users/mac/.config/rakkyride/credentials/expo-fcm-v1.json`, and restricted to file mode `0600` inside a `0700` directory. No private key material was printed or committed.

With explicit cleanup approval, the two unused keys (`7a45aeb27fde6ed7e2b458bbc479983cb49479c1` and `7739efd98f6a8fedbb8ecde00dc71c0136494af1`) were deleted. A refreshed Google Cloud key list confirms that only the intended key remains. EAS CLI confirmed that this key is uploaded and assigned to `com.rackyride.app` for FCM V1 in project `famutimi1/rackyride`. The existing APK signing key was preserved. Updating this server credential did not require rebuilding the APK.

The approved single test was created through the existing backend notification service with event key `diagnostic:push-test:2026-10-16` and notification ID `4b5338fd-7663-4300-861e-363506e02962`. Expo accepted it on the first send attempt without the previous `InvalidCredentials` error. Its subsequent receipt returned `DeviceNotRegistered`; the backend disabled the stale device registration. This receipt is a delivery failure, not confirmation that the phone received anything. The user was asked to open the installed app to refresh registration before another user-approved test. At that point, physical-device receipt, background display and notification-tap navigation were still unverified; the follow-up results are below.

### Successful physical-device verification and receipt-worker repair

The user toggled push notifications off and on in the installed app. A new enabled Android registration reached the backend on 16 October 2026. Each subsequent confirmation send was explicitly requested by the user. The first resend received an `ok` provider receipt. The next confirmation test (`b715b939-1865-4d10-b4c5-9c8a9ce5e1bf`) also received an `ok` receipt and the app recorded it as opened at 14:07 Lagos time. The user then confirmed that the notification was visible and requested one more resend (`82415ca8-3a35-4488-a065-b42accbc2393`), which received an `ok` receipt and was recorded as opened at 14:10 Lagos time. These tests establish actual notification visibility and an app-reported open, beyond Expo accepting a payload. Terminated-app delivery and every ride/driver notification scenario were not separately tested in this session.

During verification, scheduled receipt jobs exposed a PostgreSQL error: `inconsistent types deduced for parameter $2`. The receipt update reused the status parameter for a varchar assignment and a text comparison without explicit typing. The processor now casts that parameter consistently, records successful provider handoffs, and retains specific provider errors such as `DeviceNotRegistered`. A valid device can still receive a notification when another registered device is invalid. The live worker subsequently processed receipts successfully and correctly marked the original stale-token test as failed and the successful resend as delivered.

Backend typecheck and 12 targeted notification tests passed using a disposable PostgreSQL database and separate temporary Redis process. Four database regression cases cover successful receipts, invalid device revocation with the specific error, pending receipts, and mixed valid/invalid devices. Provider responses were mocked for those automated tests; physical-device sends were separate and user-approved. No new dependency, table or APK build was needed for this backend fix.
# Rider and driver inbox separation

The notification center follows the active role in the auth store. Driver offers, driver application decisions, driver earnings top-ups and withdrawals belong to the driver inbox. Rider trip updates, scheduling, wallet payments, refunds and rider wallet top-ups belong to the rider inbox. General support, safety and account notices are shared; reading a shared notice reads that same notice in both modes.

New records carry `data.audience` (`rider`, `driver`, or `shared`). The notification audience helpers also classify historical records from their event keys, types and destination paths without changing stored history. Historical top-ups used the same driver-wallet destination for both targets, so their two original producer titles distinguish rider wallet credits from driver earnings credits. New top-ups pass their actual payment-intent target explicitly.

Inbox listing, pagination, unread counts, individual reads and Read all accept a validated `role=rider|driver` query parameter. Filtering happens in PostgreSQL before pagination, always within the authenticated user's records. Omitting the parameter preserves compatibility with older clients. Preferences and device registration remain account-wide; this change does not suppress background push delivery for the inactive mode.

The mobile store clears its list, unread count, pagination and banner queue synchronously when the account or role changes. Async reads and writes cannot restore the previous context. Incoming socket banners are restricted to the active mode plus shared notices. A native notification tap authenticates ownership through the existing opened endpoint before navigating; when needed it switches through the existing role API. Application decisions can open Application Status before the applicant has permission to enter driver mode. Completed trip links use the original trip ID for receipts.

Validation: 54 focused tests passed using disposable PostgreSQL and Redis, mocked provider responses, and the actual mobile modules with controlled dependencies. These cover legacy classification, role-scoped pagination/counts/read-all, ownership, stale responses after mode changes/logout, deduplicated delivery, retry, destinations, and native tap callbacks. Mobile and backend TypeScript checks, targeted mobile ESLint, and whitespace checks passed. The local browser showed Driver notifications with rider scheduling/no-driver updates excluded; All and Unread filters were checked without marking real notifications read. Physical-device/background push delivery was not retested. Production requires publishing the updated backend and mobile code; no database migration is required.

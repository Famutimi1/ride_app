# Native audio: second implementation increment

The second increment is implemented behind separate server and native-build flags. It adds native incoming-call handling, a system call lifecycle, provider delivery, and recovery. It is **not enabled or verified for public use**. No operational database migration, TURN deployment, or real Firebase/APNs call push was performed. Physical two-phone audio and iOS compilation remain release gates.

Starting without provider credentials or a relay? Follow [the step-by-step audio setup guide](trip-audio-setup.md), beginning with two Android phones and adding Apple setup afterward.

## Implemented behavior

- `react-native-callkeep` 4.6.1 integrates CallKit on iOS and a self-managed Telecom phone account on Android. The existing WebRTC audio transport remains responsible for media. Caller handles use call UUIDs and a generic participant label, never phone numbers.
- Audio now permits direct connections using standard ICE selection (`iceTransportPolicy: all`), with optional configured STUN discovery and authenticated TURN fallback. Candidates are checked together, preferring direct routes; TURN can still allocate/check before a relay is selected. Existing relay-only binaries need an app update to use direct routes. Direct connections reveal candidate network addresses to the authorized peer. See [the transport details](trip-audio-calls.md).
- A local Expo module under `mobile/modules/rakky-native-calls` receives native events independently of navigation. It starts iOS PushKit at native app launch and reports genuine VoIP invites to CallKit before HTTP or JavaScript work. A subsequent status check closes stale, expired, or revoked invites. The Swift source parses, but it has not been compiled with Xcode on this machine.
- Android uses one app-specific FCM service, extending the installed Expo notification service. Call invites are handled natively; other messages and token callbacks continue through Expo. Firebase's default fallback service remains in the manifest. Incoming calls use CallStyle notifications and Telecom. Full-screen UI is requested only when the OS permits it; otherwise the notification provides Answer/Decline controls.
- Android keeps the phone-call service separate from microphone capture. Answer opens the app before authenticated acceptance and microphone service startup. The microphone foreground service starts only after permission, and failures end the native call instead of crashing the process. Normal phone-number/cellular-call permissions added by CallKeep are blocked because self-managed VoIP does not require them.
- System answer/end events are queued until authenticated recovery is ready. Duplicate answers share the controller, and lifecycle reports are serialized so a delayed connecting update cannot recreate a terminated call. Old queued actions expire. Native mute, hold, and audio-session interruption events affect actual media tracks; an interruption ending does not override a deliberate user hold.
- Compatible configured builds retain calls after backgrounding, with native timer events driving reconciliation and a bounded native watchdog. Foreground-only builds retain the earlier behavior of ending media on backgrounding. Microphone/earpiece/speaker/headset and interruption behavior still require device validation; the code does not establish an OS guarantee against force-stop, force-quit, or process termination.
- The caller performs at most two automatic negotiation recovery attempts after a media disconnection. Negotiation generations reject stale signals. TURN credentials still renew before expiry. Failed recovery closes the call and releases media; continuous handover quality is not yet measured.
- Android requests optional Nearby Devices permission during a call action for Bluetooth routing. Denial leaves earpiece/speaker calling available. Bluetooth and cellular-interruption behavior have not been verified on physical hardware.

## Server delivery and authorization

Migration `025_native_call_delivery.sql` evolves the existing `push_devices` table with `expo`, `fcm`, and `apns_voip` provider types. Legacy Expo registrations still work. Native tokens are encrypted with AES-256-GCM, have a SHA-256 uniqueness hash, and bind to the authenticated app session, installation, and protocol version. They are not included in API responses or logs. Account/installation transfer revokes obsolete eligibility. Existing session expiry/revocation prevents later delivery, and the global push preference suppresses native wakeups.

A call's creation transaction inserts per-device `call_push_deliveries`. The communication worker claims small leased batches and sends high-priority FCM data or APNs VoIP invites. Each attempt rechecks ringing state, expiry, recipient ownership, session validity, revocation, provider configuration, and push preference. Expired or closed invites are skipped; invalid tokens are disabled; transient provider failures retry within the remaining ring window. Provider acceptance is not treated as device delivery or audible ringing.

Push payloads contain call/trip IDs, registration ID, expiry, and a signed short-lived native invitation grant. They contain no SDP, TURN credentials, message body, or contact number. The invitation grant can read minimal invite status and decline its own unanswered call. It cannot accept, obtain media credentials, terminate an accepted call, or authenticate as an app access token. The narrow decline capability allows a native Reject action before JavaScript is ready. Tickets travel in POST bodies rather than URL query strings.

A push may already be in flight when the call is cancelled or answered elsewhere. Native status reconciliation handles this race. iOS must report a genuine VoIP invite first, so a stale call may briefly appear before it is ended. Cancellation is not sent as a separate VoIP push.

Authenticated additions:

- `GET /api/calls/config`: protocol and configured native provider capabilities, without credentials.
- `POST /api/calls/devices`: `{provider, token, installationId, appVersion, protocol: 1}`. Session identity is derived from authentication.
- `DELETE /api/calls/devices/:id`: revoke a registration belonging to the current account/session.

Narrow signed-grant endpoints:

- `POST /api/calls/invite-status` with `{ticket}`: current authorization/status and expiry only.
- `POST /api/calls/native-decline` with `{ticket}`: dismiss only the associated unanswered invite.

## Configuration needed before a real call test

1. Apply migrations 023–025 in staging using the existing migration runner. The communication worker now checks the native-delivery table at startup. Follow the writer-drain requirements of migration 023. These migrations were applied only to disposable test databases during development.
2. Configure and verify a private TURN relay for fallback. See the next section. Set backend `STUN_URLS` (for example `stun:turn.your-domain:3478`), `TURN_URLS`, `TURN_SHARED_SECRET`, in the intended test environment. Empty STUN configuration omits separate STUN discovery; TURN remains required for reliable fallback.
3. Generate a stable random 32-byte key encoded as base64 and supply it as backend `CALL_PUSH_TOKEN_KEY`. Keep it in the secret store; changing it requires re-registering or re-encrypting existing native tokens. Do not put it in an `EXPO_PUBLIC_` variable or commit it.
4. For Android, supply `CALL_FCM_CREDENTIALS_FILE` (the JSON supplies its project ID) for a Firebase service account authorized to send FCM messages in the project used by the app's existing `google-services.json`. The client configuration file is not server authorization. No Firebase Admin SDK dependency was added; the existing Google authentication library obtains an access token for FCM HTTP v1.
5. For iOS, supply `CALL_APNS_KEY_FILE`, `CALL_APNS_KEY_ID` and `CALL_APNS_TEAM_ID`. The bundle ID defaults to `com.rackyride.app` without another environment value. Set `CALL_APNS_SANDBOX` to match the signed build's APNs environment. The app uses PushKit directly and does not need a Firebase iOS configuration for VoIP delivery.
6. Native call capability is detected from provider credentials and token encryption; no backend enable variable is required. Missing prerequisites keep provider capability false.
7. Rebuild the native app; calling integration is included by default. Set `RAKKY_APNS_ENVIRONMENT=development` for development provisioning or `production` for the appropriate distribution profile. These are build inputs, not JavaScript toggles. The config plugin adds the iOS push entitlement and `audio`, `voip`, and `remote-notification` background modes. Expo Go/older binaries cannot use the bridge. An explicit legacy `RAKKY_NATIVE_CALLS_ENABLED=false` can still opt a build out.
8. Run `npm run check:audio -- --require-ready` in `backend`. It reads configuration and migration state without modifying the database. Provider key shape checks do not prove provider permissions, actual delivery, TURN allocation, or sound.

The original native-increment readiness check reported missing runtime prerequisites. During the subsequent web update, a read-only local check found migrations 023–025 already present, with audio still disabled and TURN unconfigured. No operational configuration or migration was changed by that update. Browser calling is now implemented separately; see [web audio and persistent chat](web-audio-and-chat-persistence.md).

## TURN files prepared

`backend/docker/turn/compose.yaml` pins the official Coturn `4.18.0-r0` image. It is intended for a Linux TURN host with host networking, a read-only container, bounded temporary storage/logs, and explicitly mounted configuration and TLS files. Docker is installed here but its daemon is not running; this container was not started or provisioned on a public server.

On the chosen relay host, provide `TURN_REALM`, `TURN_PUBLIC_IPV4`, optional `TURN_RELAY_IPV4` for NAT mapping, and the same URL-safe random `TURN_SHARED_SECRET` used by the backend. Run:

```sh
npm run prepare:turn -- --output /secure/location/turnserver.conf
```

The generator writes mode 0600, refuses overwrite, and does not print the secret. It configures authenticated UDP/TCP 3478, TLS 443, a bounded UDP relay range 49160–49359, allocation/bandwidth quotas, and private/link-local/multicast peer restrictions. Match the config/certificate file ownership to `TURN_UID`/`TURN_GID` (defaults 1000:1000), set `TURN_CONFIG_FILE`, `TURN_TLS_CERT_FILE`, and `TURN_TLS_KEY_FILE`, then use the compose file through the normal deployment process. Allow those listener/relay ports at the host and cloud firewall. Use a valid certificate for the relay hostname and verify external/NAT port mapping.

Backend URLs should include the actual endpoints, for example `turn:turn.your-domain:3478?transport=udp,turns:turn.your-domain:443?transport=tcp`. Test a second independent relay, blocked-UDP TLS fallback, capacity, certificate rotation, and credentials lasting beyond one renewal window before rollout. An HTTP proxy does not relay TURN traffic. The generator and compose file are deployment preparation, not a running or validated public relay.

## Verification performed

- **Direct-route update: 65 focused communication/call tests pass**, including server STUN/TURN configuration, short-lived relay authorization, direct and relay candidate forwarding/queuing, legacy relay-policy compatibility, call recovery, native delivery, and messaging. Backend/mobile type checks and mobile lint pass. These tests exercise configuration and signaling; real direct-route selection and forced-TURN fallback with audible media still require physical device tests. The 129-test run and Android build below describe the preceding native-incoming-call implementation.

- **129 focused tests passed.** Disposable PostgreSQL/Redis checks cover native token encryption/transfer, Expo compatibility, transaction rollback, concurrent delivery claims, scope-limited tickets/declines, revoked sessions, push preference, retries, invalid-token handling, and disabled flags. They also cover the earlier messaging/call lifecycle, cross-instance sockets, compiled migration serialization/readiness/shutdown, queued native actions, stale callbacks, actual media hold/mute/cleanup, and bounded negotiation recovery.
- Android debug compilation succeeds with CallKeep and the local native module. The module's release manifest excludes the shell-only debug receiver. The merged app manifest has one app-specific FCM handler, the Firebase fallback, call/microphone service types, and no unnecessary phone-number permissions.
- An Android emulator test installs the debug APK, injects a synthetic native invite before app UI/JavaScript startup, validates against a local fixture endpoint, observes Telecom and the phone-call foreground service, displays the native incoming call notification, and taps Decline. All seven assertions pass. Results and screenshot are in `docs/testing/trip-audio-calls/`.
- The emulator test uses a shell-permission-protected receiver included only in the debug source set. It calls the same native receive path as FCM but **does not prove FCM/APNs wakeup, real server ticket authentication, TURN traffic, or audible media**. Backend tests verify real ticket authentication separately. The helper preserves app data, clears its synthetic native state and reverse-port mapping, and deliberately refuses physical-device targets.
- Mobile TypeScript/lint and Expo web export pass. Swift source parsing passes. No Xcode/iOS compilation or physical iOS/Android audio test has been performed.

To rerun the synthetic Android check after building with the native flag:

```sh
cd mobile
npm run test:native-calls-ui -- --serial emulator-5554
```

To run the focused application checks:

```sh
cd backend
npm test -- src/modules/communication/nativeCalls.integration.test.ts src/modules/communication/mobileNativeCalls.test.ts src/modules/communication/call.integration.test.ts src/modules/communication/mobileCall.test.ts src/modules/communication/mobileAudioMedia.test.ts src/modules/communication/communication.integration.test.ts src/modules/communication/mobileChat.test.ts src/modules/auth/socket.integration.test.ts src/modules/auth/runtime.integration.test.ts src/modules/auth/mobileRoleAccess.test.ts src/modules/auth/mobileSession.test.ts src/modules/notifications/notifications.integration.test.ts src/modules/notifications/mobileNotificationRoles.test.ts
```

## Remaining exit gates

Real provider credentials, native entitlements/signing, a reachable TURN deployment, and staging migrations are still needed. Then verify two-way sound with direct candidate selection on a permissive network and relay selection when direct connectivity is blocked; foreground/background/locked/cold-process incoming calls; answer/decline/end and simultaneous-device acceptance; native watchdog and logout; speaker/headsets/Bluetooth; cellular interruption and hold; Wi-Fi/cellular change; UDP-blocked TLS; credential renewal beyond five minutes; and provider/server/Redis outages. Record OS/build versions and distinguish OS-killed apps from user force-stop/force-quit. Do not claim wakeup in every OS/user-disabled state. No second-phase production exit is claimed until these checks pass.

Disabling `COMMUNICATION_NATIVE_CALLS_ENABLED` suppresses new native push delivery; existing foreground/media calls still follow the audio lifecycle. Disabling `COMMUNICATION_AUDIO_ENABLED` stops new audio and causes active calls to terminate through reconciliation. Keep the additive schema and delivery records during rollback; do not deploy an older Expo worker that sends native-token rows to the Expo push API.

Primary references: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [CallKeep native lifecycle](https://github.com/react-native-webrtc/react-native-callkeep), [Apple PushKit](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit), [Android foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types), [FCM message priority](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-priority), [Coturn release](https://github.com/coturn/coturn/releases/tag/docker/4.18.0-r0).

## Local Android credential reuse — 27 October 2026

The existing FCM v1 service-account key used by Expo push notifications was found in the local Rakky Ride credentials directory outside this repository. Its project matches the Android client configuration, its RSA key parsed successfully, and an authenticated FCM HTTP v1 `validate_only: true` request returned HTTP 200. No device notification was sent by this validation. A second Firebase project or new service-account key was not created.

The ignored local backend environment now points `CALL_FCM_CREDENTIALS_FILE` at that existing file and derives the project ID from its JSON. Native call delivery is enabled locally and a 32-byte token-encryption key was generated only after verifying there were no pre-existing encrypted device registrations requiring an older key. The backend was restarted and its health check passed. Existing Expo message notification delivery remains in place. Keep the token-encryption key stable and supply the credential file separately when deploying to another host; the local path is not a deployed secret mount.

The read-only readiness check now reports native delivery, token encryption, migrations and FCM configured. APNs and public TURN remain unconfigured, so the overall production/provider readiness gate remains false. The local backend retains its automatic direct-only development mode. Actual FCM delivery, background/locked/closed-app ringing and physical-device sound remain unverified. Native video invitations still use the shared audio-answer OS call UI; distinct video notification presentation is separate work.

## Simplified communication configuration — 27 October 2026

For normal Android operation, the backend automatically locates the existing Firebase JSON at `~/.config/rakkyride/credentials/expo-fcm-v1.json`, or `/run/secrets/rakky-fcm.json` on a server. Only `CALL_PUSH_TOKEN_KEY` remains a separate secret alongside the existing database/Redis/application configuration. A custom location can still use `CALL_FCM_CREDENTIALS_FILE` or `GOOGLE_APPLICATION_CREDENTIALS`. The backend reads `project_id` from the service-account JSON. The file path locates the credential; the encryption key protects app-owned device tokens in PostgreSQL and is separate from the Firebase private key. Keep that encryption key stable.

Messaging/audio/video use normal defaults. Native capability still requires provider credentials and token encryption, and production media still requires authenticated TURN fallback. Development/test permits local direct calls automatically. The four old `COMMUNICATION_*_ENABLED` switches and the direct-only override are no longer required; explicit values remain supported for compatibility and incident shutdown. A conflicting legacy `CALL_FCM_PROJECT_ID` fails startup with a bounded error; remove that redundant override. Native binaries still need a rebuild to include the integration; new builds include it by default without another enable variable. The APNs signing environment remains an iOS-specific setting.

The ignored local backend environment was cleaned up only after checking that computed capabilities and its existing encryption key stayed unchanged. No Firebase private key was copied into the repository.

The fixed-location follow-up removed the credential-path assignment from the ignored local `.env` after verifying that the resolved credential/project and existing encryption key stayed identical. The encryption key was generated earlier by the application setup and remains in `backend/.env`; it is not part of Google's service-account JSON and is never copied into source code. Tests do not automatically discover the developer's real credential.

# Messaging, audio and video code review and verification

27 October 2026. The communication checks pass after fixes to message retry durability/order and WebRTC reconnect races. The wider repository suite still has three unrelated failures. This is local validation, not a production-readiness certification.

## Fixes made during this review

- Persist message attempts, retry deadlines and failed status before leaving a failed flush. Restore bounded retry deadlines after restart, so restarting does not bypass backoff or silently retry exhausted sends.
- Preserve the order of pending messages: later sends wait behind an earlier retry deadline, and messages created in the same millisecond retain enqueue order rather than sorting by random UUID.
- Bind asynchronous SDP, ICE, signaling and callbacks to their original call generation and peer. Replacing a peer discards queued old signals; a stalled old operation cannot block or configure the replacement peer. Both browser and native adapters ignore late results/errors from replaced peers. Browser camera switching also checks whether its peer was replaced during permission/track replacement.
- Sync the generated local Android project with the existing camera permission configuration and rebuild. The test build enables native incoming calls explicitly; production provider configuration remains unchanged.
- Make the Android UI harness fail early if its generated build configuration disables native calls, verify camera/microphone declarations, and allow 59 seconds for the synthetic invite within the native handler's 60-second bound. The backend's actual 30-second ring window is unchanged.

Nine new regression tests cover message retry persistence, exhausted retries, pending-message ordering and stale WebRTC operations. The retry, ordering and reconnect defects were reproduced by regression tests before the corresponding fixes. Existing authorization, call ownership and trip eligibility checks remain in force.

## Results

- **160 focused automated tests passed**, zero failures/skips. These cover the communication module, driver motion evidence, mobile session/role isolation and trip UI integration. [Focused output](focused-tests.log).
- **18 messaging/audio browser scenarios passed** through the actual Expo UI and isolated backend. [Results](../local-direct-audio/virtual-test-results.json). They include durable history, read receipts, pending-send reload with the same UUID, offline draft/history recovery, microphone denial, actual bidirectional audio RTP with connected DTLS, mute, navigation, authorized reconnect replacing both peers, cleanup and completed-trip/outsider restrictions.
- **8 video browser scenarios passed**. [Results](../trip-video/results.json). They include audio/video selection, camera denial, explicit acceptance, actual audio/video RTP and decoded frames, camera release, movement-triggered downgrade, audio-only answering, hidden-tab downgrade and stale-location restrictions.
- **9 Android emulator assertions passed** using a rebuilt native-enabled debug APK. [Results](../trip-audio-calls/android-native-smoke.json). Camera/microphone declarations, native status validation, Telecom, foreground service, notification/Answer/Decline UI and scoped native decline all passed. This uses a synthetic invite/status endpoint and does not prove provider delivery or native two-peer media.
- Backend and mobile TypeScript, backend script checking, full mobile lint, Expo web export, Android arm64 debug build and whitespace checks passed. The local backend health endpoint returned HTTP 200.
- **Full project suite: 389 passed, 3 failed, 0 skipped (392 total)**. [Full output](full-suite.log). The remaining failures are the existing email palette/generated-token mismatch and two care/settings test fixtures missing `borderWidths.divider`. They were already present in the initial baseline before this audit's fixes. No assertions were disabled or skipped. A migration-lock timing failure during a loaded intermediate run passed independently and in the final full run; [recheck](runtime-recheck.log).

## Review scope

Reviewed server message/history/receipt policy, message and call outbox delivery, socket routing, account/session ownership, call reservations and versions, short-lived TURN credentials, call lifecycle and recovery, video motion/trip restrictions, local cache/drafts/queue isolation, shared controller, browser/native media adapters, call rendering and native call coordination. Messaging is authenticated and durable; message content is readable by the service and is not end-to-end encrypted. Browser media statistics verified connected DTLS transports; audio/video is carried by WebRTC rather than sent through the message database.

Tests used disposable PostgreSQL/Redis, fictional users/trips and synthetic browser devices. Operational accounts, trip state and ledger records were not changed by these tests. Browser requests to external providers were blocked. Android native UI testing used only an emulator and cleared its synthetic call state afterward.

## Repeating the checks

From `backend`:

```sh
npm test -- src/modules/communication/*.test.ts src/modules/location/driverMotion.test.ts src/modules/auth/mobileRoleAccess.test.ts src/modules/auth/mobileSession.test.ts src/modules/trips/mobileDriverTrip.test.ts src/modules/trips/mobileTripRetry.test.ts
npm run typecheck
npm run typecheck:scripts
npm test
```

From `mobile`:

```sh
npm run typecheck
npm run lint
npx expo export --platform web --output-dir /tmp/rakky-audit-web-export
RAKKY_NATIVE_CALLS_ENABLED=true npx expo prebuild --platform android --no-install
```

The local Android build used JDK 17, installed NDK 27.1 and the temporary NDK selection script documented in the audio deployment notes. After building a native-enabled debug APK, run `npm run test:native-calls-ui -- --serial emulator-5554`. These build settings do not configure FCM/APNs server credentials.

The browser runs used session-local Playwright harnesses at `/tmp/rakky-audit-messages-audio.test.mjs` and `/tmp/rakky-video.test.mjs` against Expo on port 8081. They ran through `npm test -- <absolute harness path>`, so each received its own disposable database and Redis. They require the installed local Playwright runtime/Chromium; the temporary harnesses are not a portable checked-in browser test runner. The application and its durable automated regression tests do not add a Playwright dependency.

## Remaining validation

Physical Android/iPhone media, Bluetooth/audio routing, native video rendering/camera switching, background/lock behavior and real push delivery still require phones and server credentials. Xcode is unavailable here. TURN/provider configuration is absent, so live relay connectivity and real carrier/Wi-Fi handover remain unverified; existing tests validate credential generation, authorization and ICE configuration only. The browser engine available locally was Chromium; Firefox/Safari and production load/bandwidth/battery measurements remain outstanding. The subsequent [audio-to-video/Android follow-up](../android-communication/README.md) implemented consented upgrades and verified native video rendering/camera switching; its results supersede those particular gaps and update the automated counts to 172 focused tests and 10 video browser scenarios. Physical devices, providers and public TURN remain outstanding.

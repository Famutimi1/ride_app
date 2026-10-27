# Trip audio calls: first native increment

Status: the foreground implementation is complete and the second native incoming-call/background increment is implemented behind additional flags. See [phase-two setup and evidence](trip-audio-phase-two.md). Native provider delivery, physical-device sound, and iOS compilation remain unverified. Browser calling was added afterward; see [web calling and persistence](web-audio-and-chat-persistence.md). Video remains disabled.

## Implemented architecture

Express and PostgreSQL own call authorization and state. Socket.IO and its existing Redis adapter carry transient WebRTC offers/answers/ICE to the accepted authenticated session. Audio uses a native WebRTC peer connection with direct routes preferred, authenticated TURN fallback, and DTLS-SRTP; Express does not transport or record audio. PostgreSQL stores metadata, never SDP, ICE, or recordings.

The server now supplies `iceTransportPolicy: all` and optional `STUN_URLS` alongside TURN. ICE gathers/checks candidates together and prioritizes direct routes; it can select a relay when those routes cannot connect. It does not wait for an entire direct-only call attempt to time out. TURN allocations/checks may occur even if the eventual media route is direct. Direct candidates expose network addresses to the authorized peer; relay-only address isolation is no longer the default. See [WebRTC transport policy](https://w3c.github.io/webrtc-pc/#rtcicetransportpolicy-enum) and [ICE candidate priorities](https://www.rfc-editor.org/rfc/rfc8445.html#section-5.1.2.2).

Migration `024_trip_audio_calls.sql` creates call sessions, per-user active reservations, and a durable call-event outbox. Initiation reserves both accounts in one transaction, regardless of current display role. Sorted per-user advisory locks serialize opposite calls; the reservation primary key is the final busy invariant. Call commands use trip -> conversation -> sorted user advisory locks -> call -> reservations. A trip trigger terminates calls and releases reservations in the same transaction as closure or reassignment.

Call states are `ringing`, `connecting`, `connected`, then `ended`, `declined`, `cancelled`, `missed`, or `failed`. Acceptance binds the first receiving authentication session. A second session may observe state but cannot signal or obtain TURN credentials. The originating session owns offers. Commands check versions; negotiation generations reject stale media signals. Both endpoints must report media connectivity before the server marks the call connected. A connected report is a client assertion, not proof that a person heard audio.

A BullMQ communication recovery job runs every second. It expires ringing/setup calls after 30 seconds, expires connected calls when either endpoint stops renewing for 30 seconds, and retries leased outbox publication after failures. The native controller reconciles every five seconds and after reconnection. It releases local media on hangup, logout, terminal state, or prolonged server loss. Foreground-only builds also release media on backgrounding; native-enabled builds now use the phase-two lifecycle. It buffers and serializes early signals and resends unanswered offers. Ordinary Expo notifications are not used to imitate VoIP incoming-call delivery.

The native controller requests microphone permission before initiating/accepting, captures audio only, and enables tracks after acceptance. Mute changes the audio track's `enabled` property. Speaker changes the native audio route through InCallManager. Navigation and rider/driver mode switches do not create a second controller. A process reload ends a previously accepted call rather than silently reacquiring the microphone. Foreground-only builds end calls on backgrounding and state that restriction. Phase-two builds can use the separately gated native lifecycle.

TURN credentials expire after five minutes, are HMAC-SHA1 signed using the coturn REST authentication convention, and are issued only to the bound endpoints of an active call. Before expiry, the originating controller requests a new negotiation generation and fresh credentials for both endpoints. A fresh connection may cause a brief audio interruption. Network and route handover still need physical-device verification. Credential expiry alone does not revoke an established connection instantly.

## Deployment prerequisites

No operational database migration or TURN deployment was performed during implementation. Do not enable audio on the existing running server until these steps are complete.

1. Apply migrations 023 and 024 through the normal staging/deployment process. The communication worker now checks that call tables exist at startup. Follow the writer-drain requirements for migration 023 in `docs/features/trip-communication.md`.
2. Provide a private coturn deployment with a public reachable address, valid TLS certificate, `use-auth-secret`, a strong `static-auth-secret`, a realm, bandwidth/allocation quotas, and relay-port firewall rules. Use the coturn deployment guidance rather than exposing an unauthenticated relay. Configure an external/public IP mapping if the relay sits behind NAT.
3. Set backend `TURN_URLS` to comma-separated endpoints, for example `turn:turn.your-domain:3478?transport=udp,turns:turn.your-domain:5349?transport=tcp`. Set `STUN_URLS=stun:turn.your-domain:3478` for direct-route discovery through your Coturn listener. Empty STUN configuration omits separate STUN discovery; no third-party public server is added. Set `TURN_SHARED_SECRET` to the identical coturn shared secret, at least 32 random characters. Never set it in an `EXPO_PUBLIC_` variable or ship it in a mobile bundle. Keep `COMMUNICATION_AUDIO_ENABLED=false` outside private staging until the two-device check passes. TURN configuration remains required for the fallback; missing relay configuration leaves the capability false.
4. Rebuild Android/iOS with the pinned native dependencies. Expo Go and an older development client do not contain these modules. The app config includes microphone permission text and Android audio permissions; WebRTC and InCallManager autolink. Camera capture is always false. This is a native binary change, not an OTA-only update.
5. In a private staging environment, configure the relay and restart the backend, confirm communication worker readiness, then test with two assigned trip participants. Updated browser clients can also call over HTTPS/localhost using the same backend; browser testing/limits are documented in the web guide.
6. Complete the device checks below before any wider rollout. Disable the audio flag and restart to stop new calls; active calls are terminated by the recovery worker and clients release media when they reconcile. Metadata remains available for investigation.

The project uses `react-native-webrtc` 155.0.1 and `react-native-incall-manager` 4.3.0. Pinning and successful compilation do not establish audio-session, Bluetooth, interruption, or OS background compatibility. Native CallKit/Telecom integration is now implemented in phase two; provider delivery, iOS compilation, and physical-device validation remain required before a production claim.

## API and events

All endpoints require authenticated app-session identity. Request bodies do not choose caller/callee IDs or session IDs.

- `POST /api/trips/:id/calls` with `{requestId: UUID}` initiates or recovers the same committed request. The request key is scoped to the originating account and bound to its session/trip.
- `GET /api/calls/active` returns the current account's reserved call or null.
- `GET /api/calls/:id` returns participant-authorized metadata plus `deviceRole` (`caller`, `receiver`, or `observer`). Session identifiers and contact numbers are not returned.
- `POST /api/calls/:id/accept|decline|cancel|end|restart` with `{version: number}` applies a permitted state change. Restart is caller-owned and rate limited.
- `POST /api/calls/:id/lease` with `{generation: number, connected: boolean}` renews endpoint liveness without extending the absent endpoint's lease.
- `POST /api/calls/:id/turn-credentials` returns optional STUN endpoints, short-lived TURN credentials, and `iceTransportPolicy: all` to a bound active endpoint. Updated native clients honor both `all` and a legacy `relay` response during rollout; old binaries still enforce their original relay-only behavior.
- Server `call:state` events carry metadata to both participant user rooms. Clients fetch authenticated current state and discard stale versions; an outbox retry does not restore an old ringing state.
- Bidirectional `call:signal` carries `{callId, generation, kind: offer|answer|ice, sdp? ,candidate?}`. The server derives the target session, validates identity/state/generation and payload sizes, rejects video/data SDP, applies per-user rate limits, and acknowledges the command. Signaling is transient and recovered through negotiation, not persisted in an outbox.

## Verification

Run focused checks from `backend`:

```sh
npm test -- src/modules/communication/call.integration.test.ts src/modules/communication/mobileCall.test.ts src/modules/communication/mobileAudioMedia.test.ts src/modules/communication/communication.integration.test.ts src/modules/communication/mobileChat.test.ts src/modules/auth/socket.integration.test.ts src/modules/auth/runtime.integration.test.ts
```

The harness creates and destroys a disposable PostgreSQL database and dedicated temporary Redis process. Tests exercise real call transactions, HTTP authentication, two Socket.IO instances and session-targeted signaling, concurrent initiations/answers, versions, timeouts, credential signatures, trip closure, outbox recovery, and the actual mobile controller/native adapter with controlled native/network I/O. The adapter tests check audio-only capture, track mute, early ICE, repeated offers, native-module absence, and idempotent cleanup. They do not establish audible media quality.

The focused verification run passed **52 tests**. Android `:app:assembleDebug` also succeeded with the installed JDK 17 and valid NDK 27.1 (using a temporary Gradle init script to select that NDK for all Android modules). This is compilation evidence, not a two-phone audio result. The debug APK is generated under `mobile/android/app/build/outputs/apk/debug/app-debug.apk` and is not committed.

Also run mobile `npm run typecheck`, `npm run lint`, and `npx expo export --platform web` to verify that the existing web app remains buildable. The initial local Android build encountered an incomplete NDK 27.0 directory and JDK 25 CMake tool errors. Local verification uses installed JDK 17 and NDK 27.1; no global SDK/JDK settings were changed. iOS compilation requires Xcode, which is absent on this machine.

Before declaring this ready for a pilot, verify actual two-way sound, relay candidate selection and traffic, permission denial/revocation, earpiece/speaker/headset/Bluetooth, cellular interruptions, navigation and role changes, hangup from either device, no-answer/decline, expired invite, app restart, account logout/revocation, trip completion, UDP-blocked TLS-only relay, credential renewal beyond five minutes, airplane mode, Wi-Fi/cellular handover, and relay/server/Redis failure on physical Android and iOS devices. Verify backgrounding ends foreground-only calls cleanly. Background/locked/killed-app ringing must be implemented and tested separately before changing that product promise.

Primary integration references: [React Native WebRTC](https://github.com/react-native-webrtc/react-native-webrtc), [InCallManager](https://github.com/react-native-webrtc/react-native-incall-manager), [coturn configuration](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf).


For current migration 025, native flags/provider credentials, TURN deployment files, and the Android native UI smoke result, use the [phase-two guide](trip-audio-phase-two.md). The first-increment verification above is historical; it does not replace the newer gate.

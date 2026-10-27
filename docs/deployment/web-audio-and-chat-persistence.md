# Browser audio and persistent trip chat

Browser audio now uses `mobile/src/services/calling/audioMedia.web.ts`. Android/iOS keep their native adapter. Both use the existing authenticated call APIs, trip authorization, Socket.IO signaling, direct ICE routes, STUN discovery, and short-lived authenticated TURN fallback. No dependency or database migration was added for this update.

## Browser calling

- Use a browser with WebRTC and microphone support on **HTTPS or localhost**. A plain HTTP LAN URL is not a secure microphone context.
- Keep the tab open and allow microphone access. The app requests audio only. It keeps microphone tracks disabled until acceptance and stops them on hangup or page exit.
- The root controller handles incoming-call prompts while navigating within the app. In-app navigation does not destroy an active call. A hidden tab does not intentionally hang up, but browser/OS suspension can delay timers and end the server lease; reliable closed-tab or locked-phone ringing is not provided by this adapter.
- If automatic remote playback is blocked, use **Enable call audio**. Browser audio output follows browser/system settings; the native phone speaker toggle is hidden on web.
- Browser-to-browser and browser-to-native use the same signaling protocol. Real Android/iOS interoperability, Safari/Firefox audio behavior, public-network TURN fallback, and headset/device routing remain device test gates.

Production requires `TURN_URLS` and `TURN_SHARED_SECRET` before exposing calling; a separate audio enable value is no longer needed. Add `STUN_URLS` for separate direct-route discovery. Local testing before TURN is ready automatically allows direct calls in development/test. Production never permits this exception. The local backend now uses this direct-only mode; no fake TURN credentials or external STUN provider were added. See [the local testing follow-up](../testing/local-direct-audio/README.md). Follow [the audio service setup guide](trip-audio-setup.md) before production enablement.

## Message history and drafts

Previously, the app saved only pending sends. Confirmed messages lived in the running store and needed the server after a restart. The message composer also held its draft in screen state, so navigation discarded unsent text.

The shared web/native store now saves three separate account-scoped files through AsyncStorage (localStorage on web):

- Existing pending sends: up to 50, with the existing 24-hour expiry and stable retry IDs.
- Confirmed message cache: the newest 200 messages across at most 20 conversations. The server retains authoritative history; this cache is only a bounded device copy.
- Unsent drafts: up to 20 trip drafts, each limited to 2,000 Unicode code points. Draft changes save independently of the larger message-history cache. Drafts are never sent automatically. Successful enqueue into the durable pending queue clears the composer and saved draft; a send-storage failure preserves the draft.

Navigation and same-account role changes retain conversations and drafts. Logout/account changes clear that account's local files and in-memory content. Generation checks reject late results from the old account. Cached records do not grant sending/calling permissions or advance delivery/read receipts. A restored cache synchronizes from sequence zero to recover missing older records without duplicate bubbles. Explicit server authorization rejection removes the cached confirmed conversation.

When conversation requests fail, cached messages remain visible and an existing draft remains editable, with Send disabled until server authorization reloads. Startup authentication is still required: this change does not introduce an offline sign-in mechanism. Storage is unencrypted, matching the existing AsyncStorage queue; it does not provide encrypted offline history. Browser storage clearing/private-session expiration removes device copies, while confirmed history can be reloaded from the authorized server.

## Verification

The focused run passed **112 tests**, covering actual store/cache/draft recovery, account isolation, pending retries, permission denial, autoplay retry, media cleanup, candidate signaling, call lifecycle, native event compatibility, and role/session checks. Backend compilation/type checking, mobile TypeScript/lint, and Expo web/Android exports passed. The Android export verifies native bundle resolution; no new APK or physical-phone interaction test is claimed for this update.

The actual Expo web app also passed **15 browser UI checks** using separate rider/driver Chromium sessions with an isolated PostgreSQL database and Redis process. The test used synthetic microphones but real RTCPeerConnections: both sides sent/received audio RTP packets, negotiated connected DTLS transports, selected direct host candidates, and played remote streams. Mute affected the real outgoing track; hangup stopped microphone tracks and closed peers. Permission denial created no server call. Navigation, conversation-API outage followed by page reload, and sending/reloading preserved messages and handled drafts correctly. It sent no real push notifications or external provider requests.

This verifies the browser implementation and shared persistence logic. It does not establish audible quality on physical phones, a public TURN allocation, or native/browser interoperability. The isolated test's intentionally unreachable local TURN endpoint was only a fixture to exercise direct routing; it was not copied to operational configuration.

See [browser results and screenshots](../testing/web-communication/README.md).

To rerun the focused checks from `backend`:

```sh
npm test -- src/modules/communication/browserAudioMedia.test.ts src/modules/communication/mobileChat.test.ts src/modules/communication/mobileCall.test.ts src/modules/communication/mobileAudioMedia.test.ts src/modules/communication/mobileNativeCalls.test.ts src/modules/communication/call.integration.test.ts src/modules/communication/communication.integration.test.ts src/modules/auth/mobileRoleAccess.test.ts src/modules/auth/mobileSession.test.ts
```

Then run `npx tsc --noEmit`, `npx expo lint`, and `npx expo export --platform web` from `mobile`.

References: [WebRTC connection setup](https://webrtc.org/getting-started/peer-connections), [microphone secure-context and permission requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

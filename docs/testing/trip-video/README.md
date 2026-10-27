# Trip video verification

27 October 2026. Actual Expo UI in separate Chromium rider/driver contexts; synthetic camera and microphone devices; disposable PostgreSQL and Redis; synthetic stationary/moving evidence in the existing driver-location cache.

Validation passed: 172 focused tests, ten browser scenarios, backend/mobile TypeScript, and targeted mobile ESLint. The local backend health endpoint returns HTTP 200.

The browser check verifies:

- The Call icon opens audio/video choices and does not request a camera just by opening the chooser.
- Caller camera denial creates no call and leaves audio available.
- Both participants explicitly accept video, exchange audio/video RTP, decode frames, and establish DTLS transports. No peer is created before recipient acceptance.
- Camera-off stops both cameras and reconnects audio in the same call.
- Audio-to-video requests require peer consent; Keep audio releases the staged camera without replacing the audio generation.
- Accept video reuses the call ID and microphone, exchanges encrypted audio/video, and supports camera-off back to audio.
- Moving-driver evidence switches both participants to audio.
- Recipient camera denial preserves the invitation and allows an audio answer without camera capture.
- Hiding a tab stops capture and falls back to audio.
- Missing driver-location evidence disables video while audio remains selectable.

Backend/controller/media tests additionally cover stale/inaccurate GPS, heartbeat freshness, trip-start downgrade, protocol/version/session ownership, SDP restrictions, native camera flip and release, native audio-only answering, pending camera permission during background/logout/downgrade, retry, reservations and existing audio/native-call behavior. Test results in [results.json](results.json) include DTLS and packet/frame statistics. Physical phones, carrier/TURN networks, iOS compilation and production load are outside this browser test.

## Screenshots

- [Audio/video chooser](call-options.png)
- [Audio-to-video upgrade](audio-to-video-upgrade.png)
- [Rider video call](rider-video-call.png)
- [Driver video call](driver-video-call.png)
- [Motion-triggered audio fallback](motion-audio-fallback.png)
- [Unavailable video with an audio option](video-unavailable-audio-option.png)

The green test pattern is Chromium's synthetic camera feed, not an application placeholder or recording.

The [combined communication audit](../communication-audit/README.md) adds reconnect-race and message-queue regression coverage and records the latest Android build/emulator checks.

Follow-up [Android emulator evidence](../android-communication/README.md) verifies native rendering, camera flip, audio-to-video switching and navigation persistence against a real browser peer. Full suite: 401 passed, 3 existing unrelated failures (404 total). The browser harness used `/tmp/rakky-video-upgrade.test.mjs` via the repository isolated test runner and the locally installed Playwright runtime; the ten results are recorded here, while durable controller/adapter/server regressions are checked into the communication test files.

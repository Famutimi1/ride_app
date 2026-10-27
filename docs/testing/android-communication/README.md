# Android communication and audio-to-video verification

27 October 2026. The custom Android development build (`com.rackyride.app`, API 37 emulator) was paired with a Chromium virtual driver through the real app API, Socket.IO and WebRTC. Fixtures used disposable PostgreSQL/Redis, fictional participants and synthetic stationary-driver evidence. No operational trip or ledger was modified.

## Verified on the emulator

- Receive the virtual driver's message; send a pickup quick reply; leave and reopen chat with the sent message and unsent draft retained.
- Answer audio; verify connected DTLS and bidirectional audio packets.
- Press **Switch to video** in the audio call; the browser participant explicitly accepts. The same call gains audio/video RTP and decoded video frames.
- Render browser video and native local preview; flip to the rear camera while media remains connected.
- Press **Camera off**, returning the shared call to audio; end the call and verify the peer closes.

The initial native render was black because RTCView first received an empty remote stream. The adapter now publishes a remote video stream only when it contains a video track. A regression test fails without that fix, and the screenshots below verify the corrected native renderer. Chromium's green pattern and Android's synthetic scene are emulator camera sources.

[Audio with Switch to video](audio-with-video-button.png) · [Connected video](video-upgrade-connected.png) · [Rear camera](video-rear-camera.png) · [Audio fallback](back-to-audio.png) · [Chat and retained draft](chat-persistence-return.png) · [45-second screen recording](working-upgrade.mp4).

Machine-readable snapshots and packet counts are linked from [results.json](results.json). This is real peer transport using virtual media sources; perceived microphone/speaker quality was not assessed.

## Automated verification

- **172 focused tests passed**, no failures/skips: [output](focused-tests.log). Includes server/device/session/version/policy enforcement, upgrade consent/rejection, camera staging, expiry/cancellation, partial native permissions, renderer timing, reconnect races and durable chat retries.
- **10 actual-browser video scenarios passed**, including accepted and rejected upgrades: [output](browser-tests.log), [scenarios and DTLS/frame statistics](../trip-video/results.json).
- Backend/mobile TypeScript, backend script checking, full mobile lint and Expo web export passed.
- **Full suite: 401 passed, 3 failed, 0 skipped (404 total)**: [output](full-suite.log). Existing failures: email palette/generated-token synchronization and care/settings test fixtures missing `borderWidths.divider`. These failures were present before this follow-up.

The live Android demo fixture stayed open through the interactive session and exceeded its 20-minute node:test timeout. It is manual evidence, not an additional passing automated test. The call was ended and isolated services stopped explicitly. The original encrypted emulator login was restored and hash-verified, its saved app data restored, and the app reopened successfully on the original development server. The extra Metro process was stopped; the existing web/backend services remain available.

## Repeating automated checks

From `backend`:

```sh
npm test -- src/modules/communication/*.test.ts src/modules/location/driverMotion.test.ts src/modules/auth/mobileRoleAccess.test.ts src/modules/auth/mobileSession.test.ts src/modules/trips/mobileDriverTrip.test.ts src/modules/trips/mobileTripRetry.test.ts
npm run typecheck
npm run typecheck:scripts
npm test
```

From `mobile`, run `npm run typecheck`, `npm run lint`, and `npx expo export --platform web --output-dir /tmp/rakky-upgrade-web-export`.

The UI demo used session-local Playwright/native UI helpers and the already installed development APK, not a checked-in portable emulator scenario. Durable server/controller/adapter regressions are in the repository test suite. Physical Android/iPhone media quality, Bluetooth/background/lock, provider delivery, iOS compilation, public TURN/carrier handover, Safari/Firefox and production load remain release gates. Expo Go cannot run these WebRTC native modules.

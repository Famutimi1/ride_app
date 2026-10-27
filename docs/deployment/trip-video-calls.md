# Trip video calls and audio-to-video switching

Implemented 27 October 2026 on the shared audio-call architecture. No new package, call service, or live-location store is introduced.

## User experience

The rider progress screen, driver progress screen, and chat Call icon open the same chooser with **Audio call** and **Video call**. An unavailable video option explains why. Choosing video opens a call screen; **Start video call** requests camera and microphone permission. No media is sent before the recipient accepts. The recipient can answer with video or audio. Camera denial leaves an explicit audio path.

The call screen renders remote video and a muted local preview. Flip camera selects the other camera where supported. Camera off stops video capture and switches the shared call to audio for both participants. During a connected audio call, **Switch to video** requests a change in the same call. The other participant sees **Accept video** and **Keep audio**. A camera is requested only after that participant explicitly accepts. The requesting camera track stays disabled until acceptance; the existing microphone and audio connection remain available while waiting. Rejecting, cancelling, camera denial or the 30-second request timeout keeps audio. After camera-off, switching back to video requires this consent flow again and a fresh stationary-driver policy check.

## Backend and compatibility

Apply migration `026_trip_video_calls.sql` after 023–025, using `npm run migrate` in the backend. It adds media, requested-media, downgrade-reason and policy-deadline columns to `call_sessions`, plus a trip-status downgrade trigger. Existing calls remain audio. Workers check the new schema at startup.

Apply `027_call_video_upgrade.sql` next. It adds the request owner and expiry to the same call record. Authenticated, device-bound `POST /api/calls/:id/request-video`, `/accept-video` and `/reject-video` actions use the existing version/locking mechanism. Request/accept require protocol 2, connected audio and fresh video eligibility. Only the other participant may accept. Acceptance advances the negotiation generation and preserves the call ID and microphone; the original caller still owns the SDP offer. Pending upgrades clear on expiry, policy failure or reconnect.

Video now uses the normal product default and needs no enable variable. Existing explicit false overrides remain supported for older deployments and incidents. Trip membership, camera consent, stationary-driver policy, audio availability and TURN requirements still apply. Development/test permits direct-only calls automatically; production does not. Production still needs authenticated TURN fallback. ICE uses direct candidates first with relay candidates available; video changes neither that routing policy nor transport encryption.

Start-video and accept-video requests use `protocol: 2`. Older clients cannot accept a video invitation as video. Native OS answer actions intentionally downgrade to audio before acceptance and never request a camera. Existing generic native incoming-call UI remains an audio answer path; in-app foreground UI provides explicit video acceptance.

SDP/ICE stay ephemeral, bound to the authenticated call session and generation. Audio calls reject video SDP; video calls accept one audio and at most one video media section, and reject data channels. Cameras do not upgrade silently. The existing reservations, versions, outbox, room targeting and caller-owned offer path remain authoritative.

## Stationary-driver pilot policy

Video is allowed only in `driver_assigned` or `driver_arrived`. The existing authenticated Redis driver-location record holds transient evidence:

- Three distinct GPS fixes spanning at least eight seconds.
- GPS accuracy at most 20 metres.
- Reported and derived speed at most 0.5 metres per second.
- Consecutive fixes no more than seven seconds apart.
- Server receipt age at most seven seconds and GPS fix age at most ten seconds.

GPS uncertainty or absence disables video. A presence heartbeat retains the original GPS sample timestamp and cannot refresh its motion evidence. Compare-and-set updates prevent concurrent location writers from merging stale evidence. These conservative pilot values need physical-device validation and safety review; GPS is not proof that driving is safe.

Initiate, accept, credential issuance, signaling, call reads/leases and the recovery worker check policy. An `in_progress`/`returning` trip transition downgrades video in the database transaction. Driver clients also stop camera capture on unsafe fresh GPS updates. Clients hold a bounded camera deadline, stop capture when it expires, and request audio fallback; missed API updates cannot renew it. A permission dialog that outlives a downgrade answers with the current media/version and closes the unwanted camera.

Backgrounding/inactive native apps and hidden browser tabs stop video. Supported native call sessions can retain audio; foreground-only native builds retain their existing call-ending behavior. Browser page exit ends the call. Signaling cannot instantly revoke an established media path in an unmodified/uncooperative client; do not describe these checks as an independently audited driving-safety guarantee.

## Native build and validation

Rebuild and install the development app after the permission changes. The config adds Android camera permission and iOS camera usage text. Expo Go cannot load the existing WebRTC native modules. Capture uses a 640 × 360, approximately 15 fps pilot configuration and WebRTC adaptation; browser camera constraints are preferences and actual hardware dimensions may differ. Physical bandwidth, battery, Bluetooth, native background/lock and camera-switch behavior still need two-phone tests. iOS compilation and native provider video behavior were not verified in this increment.

Web testing uses HTTPS or localhost and explicit camera/microphone permission. Keep both app instances visible for video and enable driver location. A browser that supplies stale or inaccurate GPS fixes will correctly offer audio only.

## Verification and local setup

Focused backend/controller/media/authentication/driver-flow tests and two-browser media tests run against disposable local PostgreSQL/Redis instances. Browser media tests use synthetic camera/microphone devices, real WebRTC peers, DTLS connections, decoded video frames and exchanged audio packets. See [test evidence](../testing/trip-video/README.md).

Migrations 026 and 027 have been applied to the local development database and video enabled in the ignored local backend `.env`. The local development backend has been started. No trip or ledger rows were changed as part of this local setup. Public deployment and TURN/provider setup have not been performed.

The Android development build was exercised against a virtual browser driver: connected audio, consented video upgrade, visible remote/local video, rear-camera switching, camera-off back to audio, and navigation with retained chat/draft. An empty-stream renderer defect found in that run was fixed and covered by a regression test. This is emulator coverage; physical phones and public relay networks remain separate gates. See [Android evidence](../testing/android-communication/README.md).

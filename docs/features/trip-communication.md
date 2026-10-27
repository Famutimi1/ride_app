# Trip communication implementation status

## First increment implemented

The first increment delivers text messaging in the existing rider/driver app and backend. It reuses Express, raw pg, Redis, BullMQ, Socket.IO, Zustand, AsyncStorage, and the current theme. No new package or external infrastructure was installed.

Implemented behavior:

- One conversation opens from the persisted driver assignment, remains open in `driver_assigned`, `driver_arrived`, `in_progress`, and `returning`, and closes at the terminal trip state. Participant-authorized history remains readable after closure.
- Identity is derived from the authenticated account. Public communication metadata contains a safe participant ID/name and no phone number. Unexpected assignment changes fail closed for the original conversation.
- Text accepts 1–2,000 Unicode code points after trimming. Null characters are rejected. The existing 30-send-attempts-per-user-per-minute Redis limit remains in place.
- Every new message commits with delivery work in the same PostgreSQL transaction. A stable client retry key prevents duplicate inserts; changing text under an existing key returns a conflict. Retrying a previously committed message still works after trip closure.
- Per-trip sequence allocation is serialized with the message transaction. Backward record-ID cursors remain supported; forward synchronization uses numeric sequences and a bounded snapshot. Bigint values are strings in JSON.
- Receipt watermarks are participant-scoped and monotonic. Read cannot advance beyond delivered. Provider push receipts do not become chat-delivery receipts.
- Live publication has a fast path after commit plus a durable outbox retry path. Events target named user rooms and reach the participant's other devices through the existing Redis adapter. Clients deduplicate repeated publications.
- A SQL outbox and a BullMQ worker recover failed dispatch and expired worker leases. Push fallback waits five seconds for a recipient receipt, collapses messages into 15-second bursts, and uses generic locked-screen text. Chat push expires after five minutes; native/browser delivery rechecks whether the conversation closed or the message was received.
- The mobile chat uses a shared account-scoped store, saves pending text before transmission, preserves retry keys across app restarts, retries transient failures with backoff, and displays Pending, Sent, Delivered, Read, or Failed. Failed messages can be retried or discarded.
- Pending text is bounded to 50 messages with a 24-hour lifetime. The subsequent persistence fix also caches 200 confirmed messages and 20 unsent trip drafts per account, retaining them through navigation/reload. AsyncStorage is not encrypted. Logout/account change clears these account files; role changes on the same account preserve them. Server history remains authoritative. See [web audio and persistence](../deployment/web-audio-and-chat-persistence.md).
- A root chat bootstrap keeps pending-send recovery working after navigation. The open conversation refreshes on reconnect, foreground, and every five seconds to cover missed pub/sub events. Forward snapshots are fetched in pages of at most 50; cumulative receipts advance only after catch-up, not after an out-of-order live event.
- Push/history links load server-authorized trip context independently of the active-trip store. Closed conversations show a read-only composer state. The new chat screen exposes no calling button while server call capabilities are false.
- The old simulated call timer, cosmetic media controls, and trip `tel:` fallback were removed. Audio and the subsequent foreground video increment use the shared authorized call lifecycle behind separate flags. See the implementation status below.

## Database design and deployment

Migration `023_trip_communication.sql` adds `trip_communications` and `communication_outbox` and extends `trip_messages`. Migration `024_trip_audio_calls.sql` now adds call sessions, active participant reservations, and a call-state outbox for the audio increment.

The migration backfills accepted historical trips and message order, preserving existing message IDs and client retry keys. A database trigger mirrors persisted trip assignment/closure into communication metadata, including older trip writers and maintenance updates. It never changes trip status or bypasses the trip state machine. A message-insert trigger allocates the per-trip sequence under the same trip-to-conversation lock order as the service writer. These triggers make lifecycle/ordering invariants hold for compatibility writers as well as new routes.

The schema change and backfill were exercised only against disposable test databases. **No operational database migration has been run.**

Deployment procedure:

1. Back up the operational database and confirm restoration steps. Assess table size and the migration lock window in staging.
2. Drain all message writers and background write jobs. The backfill locks trips and message storage; do not run old and new chat writers together during cutover.
3. Run `npm run migrate` from `backend` against the intended environment through the normal deployment process.
4. Deploy/start the new backend. It requires the communication delivery worker in addition to the existing required workers. Readiness returns unavailable when that worker/queue is unavailable or paused.
5. Verify old `GET/POST /api/trips/:id/messages` clients, new metadata/receipts, and cross-instance live delivery in staging. Only then release the mobile update and resume full traffic.
6. Inspect the admin dependency-health entries for the communication worker and due outbox backlog. A due event older than 30 seconds reports degraded delivery.

Chat is available by default without an environment variable. The optional legacy `COMMUNICATION_CHAT_ENABLED` override is retained. Set it to `false` and restart the backend to block new sends during an incident; history and idempotent recovery of committed messages remain available. It does not configure calling.

The scheduler retains only bounded completed/failed BullMQ jobs. Outbox delivery metadata is retained in PostgreSQL for investigation; production retention/archival, notification preferences, privacy approval, alert thresholds, load targets, and device field testing remain release work. No user-message deletion policy has been invented.

For rollback, disable new sends and drain traffic first. Keep the additive migration and stored history. Restoring older server binaries that use shared message-write locks requires a reviewed writer rollback path; do not assume reversing the migration or redeploying the old writer is safe under concurrent traffic. The preferred incident action is to disable writes while keeping the new read/recovery code running.

## API additions

- `GET /api/trips/:id/communication`: safe participant metadata, the caller's trip-participant role, availability, max length, high-water sequence, receipts, and independently gated audio/video capabilities.
- `GET /api/trips/:id/messages?afterSeq=0&throughSeq=...&limit=50`: forward snapshot recovery. `throughSeq` is optional on the first request; preserve the returned high-water value for subsequent pages. `nextAfter` continues the snapshot. `before` remains a record-ID cursor for backward history; forward/backward modes cannot be mixed.
- `POST /api/trips/:id/communication/receipts`: `{kind: "delivered" | "read", sequence: "..."}`. The sequence must identify a peer message in that trip; read requires an already delivered watermark.
- Existing `POST /api/trips/:id/messages` and `trip:message:send` use the same writer. A successful response contains the canonical record ID, client key, sequence, sender identity, and server time.
- `chat:receipt` is an outgoing named-room event; message publication retains `trip:message`. Receipt commands currently use acknowledged HTTPS. A socket receipt-write alternative and typing indicators are not implemented in this increment.

## Verification and remaining work

Tests cover migration/backfill, duplicate concurrency, identity spoofing, snapshot boundaries and numeric ordering, transaction rollback after outbox failure, monotonic receipts, failed-publication recovery, expired leases, private push fallback, closed-trip retry recovery, third-party access, and unexpected reassignment. Mobile tests run the actual Zustand store/helpers with controlled native storage/network I/O and cover persistence before transmission, lost acknowledgements across restart, storage failure, offline retry, out-of-order live events, receipt-only updates, malformed/expired saved data, failed-message discard, and account switching during a request.

The Expo web export and mobile TypeScript/lint checks pass. Targeted backend/mobile integration checks include real PostgreSQL/Redis isolation, two-instance socket delivery, compiled migrations/readiness/shutdown, and compatibility with existing browser chat. Physical Android/iOS interaction, push display, and carrier testing are still required; a web export does not establish native-call compatibility.

Before the audio increments, the full repository suite reported 295 passing tests and 9 pre-existing failures in email-brand synchronization and mobile care/settings/trip-retry mocks. Those 9 failures were reproduced from the unmodified HEAD in a temporary source copy. They are separate from communication tests and are not described as passing.

## Audio increment implemented

Foreground native audio has a durable server call lifecycle, busy/device arbitration, authenticated cross-instance signaling, short-lived TURN credentials, microphone audio, real mute/speaker controls, and root-level call ownership. Audio uses normal product defaults, requires relay configuration in production, and needs a rebuilt native app. Native background/locked-screen handling was added in the second increment below; browser audio was added in the subsequent web update. See [audio deployment and verification](../deployment/trip-audio-calls.md) for the original native scope. Production audio is not complete until physical-device and background-call verification pass; video follows verified audio and the driver-safety policy.


## Second audio increment

Audio routing now allows direct peer connections using standard ICE selection, with optional configured STUN discovery and authenticated TURN fallback. The native adapter honors the server's `all` transport policy while remaining compatible with legacy `relay` responses. TURN configuration is still required before enabling calling so the fallback is available. Real direct-route selection and forced-relay sound tests remain staging device gates.

Native incoming-call and background lifecycle code now integrates CallKeep, PushKit/CallKit, native Android FCM/Telecom and call-style notifications, session-bound encrypted tokens, durable invite delivery, native answer/end queues, and bounded network recovery. Flags remain off in the running backend. The Android emulator validates the native incoming/Decline path; real provider delivery, public TURN, physical two-phone audio, and iOS builds remain pending. See the [phase-two implementation and setup](../deployment/trip-audio-phase-two.md).

## Browser audio and persistent drafts/history

Local follow-up: development-only direct-call testing is now enabled without TURN. The backend advertises its connection mode, production still requires TURN, and completed trips show an explicit closed-call reason. The local fix passed 52 focused checks and 17 browser UI checks. See [local direct audio](../testing/local-direct-audio/README.md).

Browser WebRTC audio now uses the shared call controller and authorized backend, with microphone permission handling, actual remote playback, autoplay recovery, mute, page-exit cleanup, and incoming UI across app navigation. The browser implementation and shared web/native history/draft persistence passed 112 focused checks plus 15 actual-browser UI checks. See [the implementation and limits](../deployment/web-audio-and-chat-persistence.md). Operational audio is still disabled pending real TURN setup. Migrations 023–025 were already present when read-only checked during this update; this update applied no migration.

## Foreground video increment — 27 October 2026

Call icons on rider progress, driver progress and chat now open Audio call / Video call options. The existing WebRTC adapters and call controller support explicit video invitations, local/remote rendering, camera flip, camera-off, and audio-only answers. The same backend call records, device ownership, outbox, generations, busy arbitration, signaling and direct-first/TURN fallback apply.

Migration 026 extends the existing call record. Video requires pre-trip status and fresh stationary-driver evidence derived in the existing Redis location system. Movement, stale/uncertain location, trip start, camera revocation and backgrounding stop capture and downgrade to audio. The client also enforces a camera-expiry deadline. Local development has migration 026 applied and video available; production requires the normal relay and driver-policy checks. Migration 027 adds a 30-second consented upgrade request to the same call record. Connected audio exposes Switch to video; the other participant explicitly accepts or keeps audio. Request rejection/expiry/camera denial preserves audio, and approved video negotiates a new generation while retaining the call and microphone.

See [video setup, compatibility and release limits](../deployment/trip-video-calls.md) and [browser test evidence](../testing/trip-video/README.md). Browser video and adapter/controller behavior are verified; physical two-phone video, native provider behavior, iOS compilation and public TURN/cellular validation remain release work.

The follow-up passed 172 focused tests and 10 browser scenarios. Android emulator with a browser driver verified real bidirectional audio/video RTP, connected DTLS, visible native remote video, camera switching, audio fallback and retained chat/draft across navigation. The full suite has 401 passing tests and the same three unrelated baseline failures. See [Android verification](../testing/android-communication/README.md).

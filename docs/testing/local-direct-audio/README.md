# Local browser calling without TURN

Local development calling is now enabled through two ignored backend runtime settings:

```dotenv
COMMUNICATION_AUDIO_ENABLED=true
COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY=true
```

The direct-only exception works only with `NODE_ENV=development` or `test`. Production still requires TURN endpoint/shared-secret configuration. No placeholder TURN endpoint, fabricated credential, or public STUN server is supplied. With no STUN configured, test on the same machine or a network that permits direct host connectivity. Both participants need authenticated sessions for the rider/assigned-driver accounts of an active trip. Browser microphone access needs HTTPS or localhost.

The local backend was reloaded and read-only readiness reports `audioEnabled: true`, `connectionMode: direct-only`, and communication migrations present. Native push/provider readiness remains false because credentials are not configured. This does not enable reliable closed-tab/native ringing or guarantee calls across different networks.

The trip the user had open was already completed, with a closed communication window. The screen now says **This trip has ended. Calls are closed.** rather than incorrectly blaming global audio enablement. Existing trip eligibility rules are preserved. Call metadata refreshes while the screen is mounted, so configuration/trip-state changes do not remain stale until a full page reload.

Verification:

- **52 focused tests passed**, covering direct-only opt-in, production exclusion, trip/session authorization, empty or STUN-only ICE configuration, ordinary authenticated TURN fallback, browser media, and call recovery. Backend compilation and script type checks pass; mobile TypeScript/lint pass.
- **18 actual browser UI checks passed**, including two real browser WebRTC peers exchanging synthetic microphone audio without any TURN URL/secret, connected DTLS transports, mute, page navigation, permission denial, hangup cleanup, persistent messages/drafts, and the correct completed-trip disabled state.
- Browser checks use disposable PostgreSQL/Redis and fictional rider/driver accounts. Existing local trip records and accounts were read-only inspected; no completed trip was reopened. No provider pushes, payments, or real microphone recordings were used.

See [machine-readable browser results](virtual-test-results.json), [connected local call](browser-audio-call.png), and [completed-trip call state](completed-trip-call.png).

Configure [real TURN fallback](../../deployment/trip-audio-setup.md) before production use. After configuring TURN, the backend automatically advertises `direct-and-relay` mode; production ignores the development-only direct-call exception.

The [27 October combined communication audit](../communication-audit/README.md) includes message retry/order and reconnect fixes, plus a real peer replacement/reconnect browser scenario.

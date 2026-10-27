# Browser audio and chat persistence verification

The actual Expo web app at `http://localhost:8081` passed all **15 checks** in separate Chromium rider/driver sessions. HTTP and Socket.IO traffic from only those fresh sessions was bridged to a disposable backend with its own PostgreSQL database and Redis process. Existing user accounts, trips, browser sessions, and runtime flags were unchanged.

Verified behavior:

1. Both assigned participants load chat.
2. Rider sends one persisted message to driver.
3. Driver replies to rider.
4. Both receive read receipts.
5. Reload recovers confirmed history without duplicate bubbles.
6. Offline send retries with one persisted record.
7. Leaving/reopening chat preserves history and unsent draft.
8. Reload while the conversation API is unavailable displays cached messages/draft and disables sending; reconnect restores authorization. Authentication requests remain available in this scenario.
9. Sending clears the draft across a fresh page load.
10. Microphone denial creates no call and does not ring the peer.
11. Browser calling rings the recipient, then both real WebRTC peers exchange audio packets, negotiate DTLS, and play their remote streams.
12. Mute controls the outgoing audio track; navigating to messages keeps the same call connected.
13. Hangup ends the server call, closes both peers, removes remote audio elements, and stops captured microphone tracks.
14. Trip completion leaves both histories read-only.
15. An unrelated account cannot read the trip conversation.

Synthetic microphone input was used. The selected candidate types were `host` on both sides; DTLS was `connected` on both transports. This demonstrates actual direct WebRTC transport, not physical audible quality, public TURN fallback, or browser-to-phone interoperability. No SMS, payment, or provider push was sent. Test services and data were removed afterward.

- [Machine-readable results](virtual-test-results.json)
- [Connected browser call](browser-audio-call.png)
- [Cached history and unsent draft during conversation API outage](offline-history-and-draft.png)
- [Rider history after trip completion](virtual-rider-chat.png)
- [Driver history after trip completion](virtual-driver-chat.png)

See [implementation, setup, and reusable regression commands](../../deployment/web-audio-and-chat-persistence.md).

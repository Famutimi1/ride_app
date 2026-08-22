# Third-Party: Socket.io

## Why / how we use it
Real-time delivery layer for trip requests, status updates, live location push.
See docs/architecture/real-time-layer.md for rooms and event design.

## Client setup (React Native)
- socket.io-client v4.8, connects with JWT in handshake auth
- **RN gotcha:** pass `transports: ['websocket']` to skip HTTP long-polling (the
  flaky path in React Native); sticky sessions then aren't needed server-side
- Reconnection is automatic (defaults: infinite attempts, 1s→5s backoff) — no
  need to hand-tune backoff in most cases
- The OS suspends the socket when the app is backgrounded, and it reconnects as a
  *new* session on foreground. Don't rely on the socket for background driver
  location — that's the background-location task + HTTP POST (see
  docs/features/location-tracking.md)

## Server setup
- socket.io v4.8, attaches to the same HTTP server as Express
- Named rooms `driver:{id}` and `trip:{id}` for targeted delivery; event names
  live as constants in /websocket/events.ts (AGENTS.md Section 6)
- Multi-instance scaling: `@socket.io/redis-adapter` v8.3 — **defer until 2+
  instances**. Bring your own redis client: pass pub + sub connections
  (`const sub = pub.duplicate()`) to `createAdapter(pub, sub)`
- Versions verified 2026-08-22 against live npm. Full stack plan: docs/setup/dependencies.md

## Links
- https://socket.io/docs/v4/

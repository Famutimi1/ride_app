# Third-Party: Redis

## Why / how we use it
Live driver location (GEO), online status, trip-locking. See
docs/architecture/real-time-layer.md for full key design.

## Hosting
Options considered: Upstash, Redis Cloud, Railway/Render, AWS ElastiCache,
self-hosted VPS. Free tier (Upstash or Redis Cloud) recommended for current stage.
Fill in actual choice + connection details here once decided (not the credentials —
those go in .env).

## Client library
**ioredis v6** (`npm i ioredis`) — chosen for clean GEO command support
(`GEOADD`/`GEOSEARCH` for driver matching) and reconnection handling. Verified
2026-08-22: it's under the official Redis org and actively maintained (the old
"maintenance mode" reputation is outdated); TypeScript types are bundled.

Notes:
- Driver-trip locking uses `SET driver:{id}:onTrip {tripId} NX EX 60` (AGENTS.md).
- Socket.io's Redis adapter (multi-instance only) needs **two** connections —
  create the second with `pub.duplicate()`. See docs/third-party/socketio.md.
- Full stack plan + versions: docs/setup/dependencies.md

## Links
- https://redis.io/docs/latest/
- https://upstash.com/docs/redis

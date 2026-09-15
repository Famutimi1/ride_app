# Real-Time Layer (Redis + Socket.io)

## Redis responsibilities
| Key pattern | Purpose | TTL |
|---|---|---|
| `drivers:locations` (GEO set) | Live lat/lng of all online drivers | — |
| `driver:{id}:status` | online/offline | 30s, refreshed each ping |
| `driver:{id}:onTrip` | Locks driver to a trip ID | 60s |

## Socket.io responsibilities
- Implemented room: `trip:{id}`. Driver/user rooms remain part of the broader trip/auth roadmap.
- Event names live in `backend/src/websocket/events.ts` — never hardcode strings
- `driver:location:update` writes Redis first, then emits `driver:location` to the trip room
- Rider coordinates are interpolated over incoming updates for smoother marker motion
- Multi-instance deployment requires the Socket.io Redis adapter

## Why split this way
Redis is fast for high-frequency writes + geo queries. Socket.io is the delivery
mechanism for pushing state changes instantly instead of polling. Neither depends
on the other — Redis works fine without Socket.io, and vice versa.

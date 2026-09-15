# Feature: Location Tracking

## What it does
Drivers send GPS pings; stored in Redis GEO set for fast nearby-driver queries.

## Key files
- Backend: `backend/src/modules/location/*`, `backend/src/shared/config/redis.ts`
- WebSocket: `backend/src/websocket/*`
- Frontend: `mobile/src/services/locationService.ts`, `mobile/src/store/mapStore.ts`
- UI: `mobile/src/components/map/DriverOnlineControl.tsx`

## How it works
See docs/architecture/real-time-layer.md

## Status
- [x] Driver foreground watcher (4 seconds or 10 metres)
- [x] Driver background TaskManager update flow
- [x] Separate foreground/background permission prompts
- [x] Redis GEO storage
- [x] Nearby-driver GEOSEARCH endpoint
- [x] Trip-room Socket.io push
- [x] Smooth rider-side marker interpolation and bearing
- [ ] Tune intervals with real Lagos driving and battery tests
- [ ] Add stale-GPS visual treatment to the active trip screen

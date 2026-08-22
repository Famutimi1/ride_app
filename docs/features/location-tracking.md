# Feature: Location Tracking

## What it does
Drivers send GPS pings; stored in Redis GEO set for fast nearby-driver queries.

## Key files
- Backend: /src/modules/location/*
- Frontend: /src/services/locationService.js, /src/store/locationStore.js

## How it works
See docs/architecture/real-time-layer.md

## Status
- [x] Driver location update endpoint
- [x] Redis GEO storage
- [ ] Background location updates (app backgrounded)
- [ ] Battery-efficient ping interval tuning

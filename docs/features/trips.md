# Feature: Trips

## What it does
Full trip lifecycle: request -> match -> accept -> arrive -> in progress -> complete/cancel

## Key files
- Backend: /src/modules/trips/*
- Frontend: /src/screens/rider/*, /src/screens/driver/*, /src/store/tripStore.js

## State machine
requested -> accepted -> driver_arriving -> in_progress -> completed
                                                          -> cancelled (from several points)

## How it works
See docs/architecture/matching-engine.md for the matching step.
Status transitions are validated server-side against an allow-list — never set directly.

## Status
- [x] Request trip + match driver
- [x] Status transition validation
- [ ] Cancellation flow + who-cancelled tracking
- [ ] Fare finalization on completion

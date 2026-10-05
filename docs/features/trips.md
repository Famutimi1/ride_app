# Feature: Trips

## What it does

Rakky Ride uses one server-owned trip lifecycle for riders and drivers:

`searching → driver_assigned → driver_arrived → in_progress → completed`

The legal terminal alternatives are `cancelled` and `no_drivers_found`. Clients call actions such as accept, arrived, start, and complete; they never send or write a status.

The detailed requirements and test scenarios live in [trip-system-task-spec.md](./trip-system-task-spec.md).

## Implementation map

- Database: `backend/migrations/002_trip_system.sql`
- State machine: `backend/src/modules/trips/tripStateMachine.ts`
- Fare and settlement: `backend/src/modules/trips/fare.service.ts`, `settlement.service.ts`
- Dispatch: `backend/src/modules/matching/matching.service.ts`, `backend/src/modules/trips/dispatch.service.ts`
- Durable jobs: `backend/src/modules/trips/tripQueue.ts`
- HTTP API: `backend/src/modules/trips/trips.routes.ts`, `trips.controller.ts`, `trips.service.ts`
- Socket authorization and live location: `backend/src/websocket/handlers.ts`
- Mobile API/store/recovery: `mobile/src/services/tripService.ts`, `mobile/src/store/tripStore.ts`, `mobile/src/components/trip/TripRecovery.tsx`
- Rider trip UI: `mobile/src/screens/rider/RideSelectionScreen.tsx`, `RideDetailsScreen.tsx`, `OngoingTripScreen.tsx`
- Driver trip UI: `mobile/src/screens/driver/DriverDashboardScreen.tsx`, `DriverTripScreen.tsx`
- Shared receipt/rating UI: `mobile/src/screens/shared/TripCompletedScreen.tsx`, `TripReceiptScreen.tsx`

## Spec mappings and decisions

- The older draft names `requested`, `accepted`, and `driver_arriving` map to the final names `searching`, `driver_assigned`, and `driver_arrived`.
- The repository did not have wallet holds. Wallet rides check balance at request and settle atomically at completion.
- The existing location module exposes `saveDriverLocation` and `findNearbyDrivers`; matching reuses both and adds eligibility checks and owner-safe Redis locks.
- `fare_config` contains development placeholder Lagos pricing: ₦800 base, ₦250/km, ₦35/min, ₦1,200 minimum, and 15% commission. Replace these values after product approval.
- MVP supports `economy`, cash, and wallet. Comfort, XL, card charging, cancellation fees, and surge pricing remain future work.

## Runtime behavior

- Trip creation requires an idempotency key and recomputes the route and fare on the server.
- BullMQ offers a request sequentially to nearby approved drivers, expires unanswered offers, expands the search radius, and ends stale searches.
- PostgreSQL row locks, conditional transitions, and partial unique indexes decide accept/cancel races and enforce one active trip per rider and driver.
- Completion and append-only ledger settlement share one PostgreSQL transaction.
- Drivers publish live location about every four seconds. Redis holds the current point and online status; PostgreSQL stores a breadcrumb about every 15 seconds.
- The mobile app recovers `/trips/active` at startup, foreground, and socket reconnect and routes from server state.
- A driver who becomes suspended may finish an assigned active trip, but cannot accept another offer or go online afterward.
- Cash commission debt at or below `-CASH_DEBT_LIMIT_KOBO` blocks going online until the balance is settled.

## API

- `POST /api/trips/estimate`
- `POST /api/trips`
- `GET /api/trips/active`
- `GET /api/trips/history`
- `GET /api/trips/:id`
- `POST /api/trips/:id/cancel`
- `POST /api/trips/:id/accept`
- `POST /api/trips/:id/decline`
- `POST /api/trips/:id/arrived`
- `POST /api/trips/:id/start`
- `POST /api/trips/:id/complete`
- `POST /api/trips/:id/rating`

## Verification

- `cd backend && npm run migrate`
- `cd backend && npm run typecheck && npm test`
- `cd mobile && npm run typecheck && npm run lint`

The integration test creates and drops an isolated PostgreSQL schema. It verifies the two-driver accept race, single-winner completion, unique settlement rows, and append-only history/ledger protection.

## Native location note

Background driver tracking uses `expo-location` and `expo-task-manager`. Test it in an EAS development build on a physical device; web can only exercise foreground updates.

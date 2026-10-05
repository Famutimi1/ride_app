# Task Spec: Trip System (Request → Dispatch → Ride → Settlement → Rating)

**Target:** AI coding agent 
**Depends on:** `AGENTS.md` (stack rules), the live auth system (`users`, `driver_profiles`, `requireAuth`, `requireApprovedDriver`), and the modules already built: Location (Redis GEO), Matching (Redis `SET NX EX` locks), Trip state machine, Socket.io layer (JWT auth, `driver:{id}` and `trip:{id}` rooms), Payments/Wallet ledger.

> **Rule zero for the agent:** this spec EXTENDS the existing modules. Before writing anything, read the existing trip state machine, matching engine, socket layer and wallet module. Reuse their names, helpers and conventions. Do not build a second state machine, a second lock system or a second ledger. Where this spec and existing code disagree on naming, keep the existing names and map this spec onto them, then list the mappings in the PR description.

---

## 0. Architecture Decisions (do not deviate without flagging)

1. **The server is the only source of truth for trip state.** Clients never send a status. They call an action endpoint ("accept", "arrived", "start", "complete") and the server decides if the transition is legal. Think of it like a bank: you ask the teller to move money, you don't edit your own balance.
2. **Every transition goes through one function** (`transitionTrip`) that enforces the allowed-transition map, uses a conditional `UPDATE ... WHERE status = $expected`, and writes an append-only history row. No other code path may write `trips.status`.
3. **Concurrency is solved in Postgres, not in JavaScript.** Row locks (`SELECT ... FOR UPDATE`) and conditional updates decide races (two accepts, cancel vs accept). Redis locks only protect driver *offers*. This matches the project rule that `await` is not concurrency protection.
4. **Money in, money out happens in the same DB transaction as `in_progress → completed`.** There must never be a completed trip without its settlement rows, or settlement rows without a completed trip.
5. **Upfront fare.** The rider sees a fixed fare at request time (like Uber/Bolt). MVP does not recalculate from the meter. The fare is computed server-side from `fare_config`; the client never sends a fare.
6. **Dispatch is sequential offers, not broadcast.** Offer to the nearest eligible driver, wait for a short timeout, then the next one. Offer timeouts and search expiry run as durable jobs (BullMQ on the existing Redis), not `setTimeout`, so a server restart does not strand a rider in "searching" forever.
7. **Reconnect recovery is mandatory.** Nigerian connectivity drops. Sockets are a speed-up, not the truth. On app start, foreground and socket reconnect, the client calls `GET /trips/active` and routes to the right screen from the response. (Same idea as the auth `hydrate` step.)
8. **One active trip per rider and one per driver**, enforced by partial unique indexes in Postgres.
9. **Money is stored as integer minor units (kobo)** unless the existing ledger uses a different convention. Match the ledger exactly and never mix units.
10. **MVP ships a single vehicle type (`economy`).** The schema and `fare_config` support more types so adding Comfort/XL later is data, not code.

---

## 1. Trip State Machine

Statuses: `searching`, `driver_assigned`, `driver_arrived`, `in_progress`, `completed`, `cancelled`, `no_drivers_found`.

| From | To | Triggered by |
|---|---|---|
| `searching` | `driver_assigned` | Driver accepts offer |
| `searching` | `no_drivers_found` | System (search timeout or offers exhausted) |
| `searching` | `cancelled` | Rider |
| `driver_assigned` | `driver_arrived` | Driver |
| `driver_assigned` | `cancelled` | Rider or driver |
| `driver_arrived` | `in_progress` | Driver |
| `driver_arrived` | `cancelled` | Rider or driver (e.g. no-show) |
| `in_progress` | `completed` | Driver |

Terminal states: `completed`, `cancelled`, `no_drivers_found`. No transitions out of them. `cancelled_by` (`rider | driver | system`) and `cancel_reason` carry who and why. There is no cancel from `in_progress` in MVP.

```js
// trips/tripStateMachine.js  (reconcile with the EXISTING state machine file)
const ALLOWED = {
  searching:       ['driver_assigned', 'no_drivers_found', 'cancelled'],
  driver_assigned: ['driver_arrived', 'cancelled'],
  driver_arrived:  ['in_progress', 'cancelled'],
  in_progress:     ['completed'],
  completed: [], cancelled: [], no_drivers_found: [],
};

async function transitionTrip(client, { tripId, from, to, actorId, actorType, fields = {}, meta = {} }) {
  if (!ALLOWED[from]?.includes(to)) throw new ApiError(409, 'invalid_transition', { from, to });

  // Conditional update: only succeeds if the trip is STILL in `from`.
  // If someone else changed it first, rowCount is 0 and we fail safely.
  const setClauses = ['status = $3', 'updated_at = now()'];
  const values = [tripId, from, to];
  for (const [col, val] of Object.entries(fields)) {   // fields are server-built, never raw client input
    values.push(val);
    setClauses.push(`${col} = $${values.length}`);
  }
  const { rowCount } = await client.query(
    `UPDATE trips SET ${setClauses.join(', ')} WHERE id = $1 AND status = $2`, values
  );
  if (!rowCount) throw new ApiError(409, 'trip_state_changed');

  await client.query(
    `INSERT INTO trip_status_history (trip_id, from_status, to_status, actor_id, actor_type, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tripId, from, to, actorId, actorType, meta]
  );
}
```

---

## 2. Database Schema

### 2.1 `trips`

```sql
CREATE TYPE trip_status AS ENUM
  ('searching','driver_assigned','driver_arrived','in_progress','completed','cancelled','no_drivers_found');
CREATE TYPE payment_method AS ENUM ('cash','wallet','card');
CREATE TYPE cancelled_by AS ENUM ('rider','driver','system');

CREATE TABLE trips (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id              UUID NOT NULL REFERENCES users(id),
  driver_id             UUID REFERENCES users(id),            -- null until accepted
  status                trip_status NOT NULL DEFAULT 'searching',
  vehicle_type          VARCHAR(20) NOT NULL DEFAULT 'economy',
  payment_method        payment_method NOT NULL,

  pickup_lat            DOUBLE PRECISION NOT NULL,
  pickup_lng            DOUBLE PRECISION NOT NULL,
  pickup_address        TEXT NOT NULL,
  pickup_place_id       TEXT,
  dropoff_lat           DOUBLE PRECISION NOT NULL,
  dropoff_lng           DOUBLE PRECISION NOT NULL,
  dropoff_address       TEXT NOT NULL,
  dropoff_place_id      TEXT,

  estimated_distance_m  INT NOT NULL,
  estimated_duration_s  INT NOT NULL,
  route_polyline        TEXT,                                  -- stored once at estimate, reused (saves Maps API cost)

  fare_kobo             BIGINT NOT NULL,                       -- upfront fare shown to rider
  commission_kobo       BIGINT,                                -- set at completion
  driver_earning_kobo   BIGINT,                                -- set at completion

  idempotency_key       VARCHAR(80) NOT NULL,
  cancelled_by          cancelled_by,
  cancel_reason         VARCHAR(200),

  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at           TIMESTAMPTZ,
  arrived_at            TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (rider_id, idempotency_key)
);

-- One active trip per rider and per driver, enforced by the database itself.
CREATE UNIQUE INDEX one_active_trip_per_rider ON trips(rider_id)
  WHERE status IN ('searching','driver_assigned','driver_arrived','in_progress');
CREATE UNIQUE INDEX one_active_trip_per_driver ON trips(driver_id)
  WHERE driver_id IS NOT NULL AND status IN ('driver_assigned','driver_arrived','in_progress');

CREATE INDEX idx_trips_rider_created ON trips(rider_id, created_at DESC);
CREATE INDEX idx_trips_driver_created ON trips(driver_id, created_at DESC);
CREATE INDEX idx_trips_status ON trips(status);
```

### 2.2 `trip_status_history` (append-only)

```sql
CREATE TABLE trip_status_history (
  id           BIGSERIAL PRIMARY KEY,
  trip_id      UUID NOT NULL REFERENCES trips(id),
  from_status  trip_status,
  to_status    trip_status NOT NULL,
  actor_id     UUID,                       -- null for system
  actor_type   VARCHAR(10) NOT NULL,       -- 'rider' | 'driver' | 'system'
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tsh_trip ON trip_status_history(trip_id, created_at);
```

Never UPDATE or DELETE rows here. It is the audit trail for disputes.

### 2.3 `trip_offers`

```sql
CREATE TYPE offer_status AS ENUM ('sent','accepted','declined','expired','rescinded');

CREATE TABLE trip_offers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       UUID NOT NULL REFERENCES trips(id),
  driver_id     UUID NOT NULL REFERENCES users(id),
  status        offer_status NOT NULL DEFAULT 'sent',
  distance_to_pickup_m INT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  responded_at  TIMESTAMPTZ,
  UNIQUE (trip_id, driver_id)              -- never offer the same trip to the same driver twice
);
CREATE INDEX idx_offers_driver ON trip_offers(driver_id, sent_at DESC);
```

Also gives you driver acceptance rate later for free.

### 2.4 `trip_ratings`

```sql
CREATE TABLE trip_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID NOT NULL REFERENCES trips(id),
  rater_id    UUID NOT NULL REFERENCES users(id),
  ratee_id    UUID NOT NULL REFERENCES users(id),
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     VARCHAR(300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, rater_id)
);

ALTER TABLE users ADD COLUMN rating_avg NUMERIC(3,2) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN rating_count INT NOT NULL DEFAULT 0;
```

`rating_avg` and `rating_count` are updated in the same transaction as the rating insert.

### 2.5 `fare_config` (pricing lives in data, not code)

```sql
CREATE TABLE fare_config (
  vehicle_type      VARCHAR(20) PRIMARY KEY,
  base_fare_kobo    BIGINT NOT NULL,
  per_km_kobo       BIGINT NOT NULL,
  per_min_kobo      BIGINT NOT NULL,
  min_fare_kobo     BIGINT NOT NULL,
  commission_bps    INT NOT NULL,          -- basis points: 1500 = 15%
  is_active         BOOLEAN NOT NULL DEFAULT true,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Seed one row for 'economy'. Ask Dunsin for the real Lagos numbers; use clearly-labelled placeholders until then.
```

### 2.6 `trip_locations` (breadcrumb trail)

```sql
CREATE TABLE trip_locations (
  id           BIGSERIAL PRIMARY KEY,
  trip_id      UUID NOT NULL REFERENCES trips(id),
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_tl_trip ON trip_locations(trip_id, recorded_at);
```

Sampled (about every 15 seconds), not every tick. Used for disputes and later fare/route checks.

---

## 3. Backend Implementation

### 3.1 Folder structure (fits the existing modular monolith)

```
/src/modules/trips
  trips.routes.js
  trips.controller.js
  trips.service.js            # create, cancel, accept, arrived, start, complete
  tripStateMachine.js         # ALLOWED map + transitionTrip (reconcile with existing file)
  fare.service.js             # estimate + final fare + commission split
  maps.service.js             # server-side Directions/Distance Matrix wrapper (server key)
  dispatch.service.js         # candidate selection, offer creation
  dispatch.worker.js          # BullMQ workers: dispatch, offer-timeout, search-expiry
  settlement.service.js       # money movement on completion (uses existing wallet module)
  tripSocket.js               # emit helpers + driver location ingest
  ratings.service.js
```

### 3.2 Fare service

```js
// fare = max(min_fare, base + per_km * km + per_min * minutes), rounded to nearest 50 kobo? NO.
// Round to a whole naira (100 kobo) so riders never see odd amounts.
function calculateFare(cfg, distanceM, durationS) {
  const raw = cfg.base_fare_kobo
            + Math.round((distanceM / 1000) * cfg.per_km_kobo)
            + Math.round((durationS / 60) * cfg.per_min_kobo);
  const fare = Math.max(cfg.min_fare_kobo, raw);
  return Math.ceil(fare / 100) * 100;
}

function splitFare(fareKobo, commissionBps) {
  const commission = Math.floor((fareKobo * commissionBps) / 10000);
  return { commission, driverEarning: fareKobo - commission };  // the two always sum to the fare exactly
}
```

Distance and duration come from Google Directions called **server-side** with a server key, once at estimate time. Store `route_polyline` and reuse it for the trip screens. Cache identical pickup/dropoff estimates in Redis for 60 seconds. Maps cost matters.

### 3.3 Endpoints

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/trips/estimate` | Rider | pickup + dropoff → distance, duration, polyline, fare per vehicle type |
| POST | `/trips` | Rider | Create trip (requires `Idempotency-Key` header) → status `searching`, enqueue dispatch |
| GET | `/trips/active` | Rider or driver | The caller's current active trip, or `null`. Used for reconnect recovery |
| GET | `/trips/:id` | Participant | Trip detail (rider and assigned driver only) |
| POST | `/trips/:id/cancel` | Participant | Body: `reason`. Legal only from allowed states |
| POST | `/trips/:id/accept` | Approved driver | Accept the current offer |
| POST | `/trips/:id/decline` | Approved driver | Decline the current offer |
| POST | `/trips/:id/arrived` | Assigned driver | `driver_assigned → driver_arrived` |
| POST | `/trips/:id/start` | Assigned driver | `driver_arrived → in_progress` |
| POST | `/trips/:id/complete` | Assigned driver | `in_progress → completed` + settlement, atomically |
| POST | `/trips/:id/rating` | Participant | Body: `rating`, `comment?`. Only after `completed`, once per rater |
| GET | `/trips/history` | Rider or driver | Cursor-paginated past trips for the caller's active role |

All endpoints use `requireAuth`. Driver action endpoints use `requireApprovedDriver` (checks `driver_profiles.status = 'approved'`, never `active_role`). Every endpoint checks the caller is a participant of that specific trip.

### 3.4 Create trip (idempotent, guarded)

Steps inside one transaction:
1. Validate pickup/dropoff coordinates and that they are not identical.
2. Re-run the fare calculation server-side. Ignore any fare the client sends.
3. If `payment_method = 'wallet'`, check the rider's wallet balance is at least `fare_kobo` using the existing wallet module. If the wallet module supports holds, place a hold. If not, just check balance now and settle at completion; do not invent new ledger semantics.
4. `INSERT` the trip. A unique violation on `(rider_id, idempotency_key)` means a retry: return the existing trip with 200. A violation on `one_active_trip_per_rider` means return `409 rider_has_active_trip` with that trip's id.
5. Commit, then enqueue the `dispatch` job. Enqueue after commit so a worker never sees an uncommitted trip.

The idempotency key matters here: on a flaky network the rider's app will retry, and without it you create two trips.

### 3.5 Dispatch (sequential offers)

```
dispatch job(tripId):
  trip = load trip; if status != 'searching' -> stop
  radius = step through [3000m, 5000m, 8000m] across attempts
  candidates = GEOSEARCH online drivers within radius (existing Location module)
               filter: vehicle_type matches, approved, no active trip,
                       not already in trip_offers for this trip
               sort: nearest first
  if none at this radius -> expand radius; if max radius done or MAX_OFFERS reached
        or now - requested_at > SEARCH_TIMEOUT -> transitionTrip(searching -> no_drivers_found, system)
  driver = candidates[0]
  acquire Redis lock `driver:offer:{driverId}` SET NX EX (OFFER_TIMEOUT + 5)   <- use the EXISTING matching engine helper
  if lock fails -> try next candidate
  INSERT trip_offers (status 'sent', expires_at = now + OFFER_TIMEOUT)
  emit to room driver:{driverId}: 'trip:offer' { tripId, pickup, dropoff, fareKobo,
        distanceToPickupM, expiresAt }
  enqueue delayed job 'offer-timeout' (tripId, driverId) after OFFER_TIMEOUT seconds
```

```
offer-timeout job(tripId, driverId):
  UPDATE trip_offers SET status='expired', responded_at=now()
    WHERE trip_id=$1 AND driver_id=$2 AND status='sent'
  if rowCount == 0 -> already answered, stop
  release driver offer lock; emit 'trip:offer_cancelled' to driver
  enqueue 'dispatch' again (next candidate)
```

### 3.6 Accept (the race-condition hot spot)

```js
async function acceptTrip(driverId, tripId) {
  return withTransaction(async (client) => {
    // 1. Lock the trip row. Anyone else touching this trip waits here.
    const { rows: [trip] } = await client.query(
      `SELECT * FROM trips WHERE id = $1 FOR UPDATE`, [tripId]);
    if (!trip) throw new ApiError(404, 'trip_not_found');
    if (trip.status !== 'searching') throw new ApiError(409, 'trip_no_longer_available');

    // 2. The offer must be live, addressed to THIS driver, and not expired.
    const { rowCount } = await client.query(
      `UPDATE trip_offers SET status='accepted', responded_at=now()
       WHERE trip_id=$1 AND driver_id=$2 AND status='sent' AND expires_at > now()`,
      [tripId, driverId]);
    if (!rowCount) throw new ApiError(409, 'offer_expired_or_invalid');

    // 3. Move the trip. Unique index one_active_trip_per_driver is the final safety net.
    await transitionTrip(client, {
      tripId, from: 'searching', to: 'driver_assigned',
      actorId: driverId, actorType: 'driver',
      fields: { driver_id: driverId, accepted_at: new Date() },
    });
  });
  // After commit: cancel the pending offer-timeout job, emit 'trip:status' to trip:{id} room.
}
```

Races this handles: accept after timeout (`expires_at` check), two drivers accepting (row lock, only one sees `searching`), rider cancels at the same instant (row lock decides, the loser gets a 409), same driver double-tapping (second call fails the status check).

### 3.7 Completion + settlement (one transaction)

```js
async function completeTrip(driverId, tripId) {
  return withTransaction(async (client) => {
    const { rows: [trip] } = await client.query(
      `SELECT * FROM trips WHERE id=$1 AND driver_id=$2 FOR UPDATE`, [tripId, driverId]);
    if (!trip) throw new ApiError(404, 'trip_not_found');
    if (trip.status !== 'in_progress') throw new ApiError(409, 'trip_not_in_progress');

    const cfg = await getFareConfig(client, trip.vehicle_type);
    const { commission, driverEarning } = splitFare(trip.fare_kobo, cfg.commission_bps);

    await transitionTrip(client, {
      tripId, from: 'in_progress', to: 'completed', actorId: driverId, actorType: 'driver',
      fields: { completed_at: new Date(), commission_kobo: commission, driver_earning_kobo: driverEarning },
    });

    // Uses the EXISTING wallet/ledger module, same client (same transaction).
    // Every ledger row carries idempotency key `trip:${tripId}:settlement:<leg>`
    // with a UNIQUE constraint, so a retried call can never double-pay.
    await settleTrip(client, { trip, commission, driverEarning });
  });
}
```

Settlement by payment method:

| Method | Rider side | Driver side | Platform |
|---|---|---|---|
| `wallet` | Debit rider wallet `fare` | Credit driver wallet `driverEarning` | Credit commission |
| `cash` | Nothing (paid in hand) | Debit driver wallet `commission` (cash was collected, commission is owed) | Credit commission |
| `card` | **Future** (Paystack charge at completion) | | |

Cash policy (MVP): a driver whose wallet falls below `-CASH_DEBT_LIMIT_KOBO` cannot go online until they top up. Enforce this in the existing go-online path. All ledger rows are append-only. Corrections are offsetting rows, never edits.

### 3.8 Cancel

- Rider can cancel in `searching`, `driver_assigned`, `driver_arrived`. Driver can cancel in `driver_assigned`, `driver_arrived`.
- Always record `cancelled_by`, `cancel_reason`, `cancelled_at`.
- On cancel from `searching`: mark any `sent` offer as `rescinded`, release the driver lock, emit `trip:offer_cancelled`, remove pending jobs.
- On cancel after assignment: the driver becomes free again (the partial index releases automatically because the status is no longer active).
- MVP records cancellations only. Cancellation fees and driver penalties are Future, but the data to support them is captured now.

### 3.9 Live location

- Driver app emits `driver:location` `{ lat, lng, heading, speed, at }` about every 4 seconds while online (existing Location module also keeps the GEO entry fresh). Validate lat/lng ranges, reject payloads from drivers not assigned to an active trip for the trip broadcast.
- Server forwards to room `trip:{id}` as `driver:location`. Latest point is also kept in Redis `trip:{id}:loc` with a short TTL so a reconnecting rider gets the last known position immediately.
- Persist one breadcrumb to `trip_locations` roughly every 15 seconds while the status is `driver_assigned`, `driver_arrived` or `in_progress`.
- Do not call Google Distance Matrix on every location tick. Refresh ETA at most every 30 to 60 seconds, or compute remaining time client-side from the stored polyline.

### 3.10 Ratings

`POST /trips/:id/rating`: only from `completed` trips, only participants, one per rater (unique constraint). Rider rates driver, driver rates rider. In one transaction, insert the rating and update the ratee's `rating_avg` and `rating_count`. Ratings are not shown to the other party until they have also rated or 24 hours pass (Future; MVP can show immediately).

### 3.11 Background jobs (BullMQ on the existing Redis)

| Queue | Purpose |
|---|---|
| `dispatch` | Pick next candidate and send an offer |
| `offer-timeout` | Expire an unanswered offer, trigger next dispatch |
| `search-expiry` | If still `searching` after `SEARCH_TIMEOUT_SECONDS`, move to `no_drivers_found` |
| `stale-trip-reaper` (cron, every 5 min) | Flag trips stuck in `driver_assigned` over 30 min with an offline driver, or `in_progress` over 6 hours. MVP: log and alert; auto-resolution is Future |

All jobs must be idempotent: re-running one must be harmless because each starts by re-checking current DB state.

---

## 4. Socket Events

Uses the existing Socket.io layer. Join validation: a socket may join `trip:{id}` only if the authenticated user is that trip's rider or assigned driver.

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `trip:offer` | server → `driver:{id}` | `tripId, pickup, dropoff, fareKobo, distanceToPickupM, expiresAt` | Client countdown uses `expiresAt` minus a server-time offset, not a local 15s timer |
| `trip:offer_cancelled` | server → `driver:{id}` | `tripId` | Offer expired, rescinded or trip cancelled |
| `trip:status` | server → `trip:{id}` | `tripId, status, at, driver?` | `driver` (name, photo, rating, vehicle, plate, phone proxy) is included on `driver_assigned` |
| `driver:location` | driver → server | `lat, lng, heading, speed, at` | Ack required so the driver app can detect a dead connection |
| `driver:location` | server → `trip:{id}` | same | Rider map marker |

Rule: socket events are notifications. After any reconnect, call `GET /trips/active` and trust that over anything missed.

---

## 5. Frontend Implementation (React Native / Expo)

### 5.1 Trip store and recovery

```js
// src/store/tripStore.js (Zustand)
export const useTripStore = create((set, get) => ({
  trip: null,            // active trip from the server
  offer: null,           // driver only: incoming offer
  driverLocation: null,  // rider only: live driver position

  recover: async () => {                       // call on app start, foreground, socket reconnect
    const { data } = await api.get('/trips/active');
    set({ trip: data.trip });
  },
  applyStatus: (evt) => set((s) => (s.trip?.id === evt.tripId
    ? { trip: { ...s.trip, status: evt.status, ...(evt.driver && { driver: evt.driver }) } } : s)),
  clear: () => set({ trip: null, offer: null, driverLocation: null }),
}));
```

Screen routing is a pure function of `trip.status` and `activeRole`. Write one `routeForTrip(trip, role)` helper so the same logic runs after recovery and after live events.

### 5.2 Rider screens

| Screen | Behavior |
|---|---|
| Destination search | Places autocomplete (from the Maps task doc). Pickup defaults to current location |
| Ride options / estimate | Calls `/trips/estimate`, shows fare + ETA per vehicle type, payment method selector (cash / wallet), "Request" button |
| Searching | Pulse animation, "Cancel" button, generates `Idempotency-Key` once per request attempt and reuses it on retries |
| Driver on the way | Map with route polyline, driver marker (smoothly interpolated between location updates), ETA, driver card (photo, name, rating, car, plate), call/chat (in-trip calling spec), cancel |
| Driver arrived | Banner "Your driver has arrived", same map |
| Trip in progress | Map following the route, destination, fare, (Future: share trip, SOS) |
| Trip completed | Fare summary, payment confirmation (cash: "Pay driver ₦X"), 1–5 star rating + comment |
| No drivers found | Retry / change pickup |
| Trip history + detail | From `/trips/history`, receipt view |

### 5.3 Driver screens

| Screen | Behavior |
|---|---|
| Online home | Online/offline toggle (existing), today's earnings (existing wallet) |
| Incoming offer | Full-screen modal with sound + vibration, pickup/dropoff summary, fare, distance to pickup, countdown from `expiresAt`, Accept / Decline. Auto-dismiss on `trip:offer_cancelled` |
| Navigate to pickup | Map + route, "Open in Google Maps/Waze" (navigation preference from settings doc), "I've arrived" button, cancel |
| Waiting at pickup | Rider details, call/chat, "Start trip", cancel (no-show) |
| Trip in progress | Route to dropoff, "Complete trip" button (with confirm dialog to prevent accidental taps) |
| Trip summary | Fare, commission, earning. If cash: "Collect ₦X from rider". Rate rider |
| Trip history | Past trips with earnings |

Driver app must keep emitting location while backgrounded during an active trip. Use Expo background location (`expo-location` + `expo-task-manager`) with a foreground-service notification on Android. This needs a dev client / EAS build, not Expo Go. Flag to Dunsin before building.

### 5.4 Map details

- Decode `route_polyline` once, render with `react-native-maps` `Polyline`.
- Animate the driver marker between updates (interpolate over about 1 second) so it glides instead of teleporting.
- Fit the map to pickup + driver (en route) or driver + dropoff (in progress).
- Use semantic design tokens for marker and route colors. No raw hex values.

---

## 6. Security Checklist (non-negotiable)

- [ ] Fare, commission and status are **never** accepted from the client. Server computes all of them
- [ ] Every trip endpoint verifies the caller is that trip's rider or assigned driver (no IDOR: changing `:id` in the URL must not expose someone else's trip)
- [ ] Driver actions are guarded by `requireApprovedDriver`, not by `active_role`
- [ ] Socket room joins for `trip:{id}` are authorized against trip participants
- [ ] `Idempotency-Key` required on `POST /trips`; ledger rows carry unique settlement keys
- [ ] All status changes go through `transitionTrip`. Grep the codebase to confirm no other code writes `trips.status`
- [ ] Rate limit `POST /trips` and `/trips/estimate` per user (Redis) so a buggy client cannot hammer Google Maps
- [ ] Google Maps **server** key is server-only and restricted by IP. Never ship it in the app
- [ ] Driver phone numbers are masked via the proxy provider in the calling spec, never returned raw to riders
- [ ] Location payloads validated (range, timestamp not wildly in the future/past). Anti-spoofing is Future
- [ ] `trip_status_history` and ledger tables are never updated or deleted

---

## 7. Environment Variables (add to `.env.example`)

```
GOOGLE_MAPS_SERVER_KEY=
DISPATCH_RADIUS_STEPS_M=3000,5000,8000
OFFER_TIMEOUT_SECONDS=15
SEARCH_TIMEOUT_SECONDS=120
MAX_OFFERS_PER_TRIP=6
DRIVER_LOCATION_EMIT_MS=4000
BREADCRUMB_SAMPLE_SECONDS=15
ETA_REFRESH_SECONDS=45
CASH_DEBT_LIMIT_KOBO=
TRIP_ESTIMATE_RATE_LIMIT_PER_MIN=20
```

---

## 8. MVP vs Future

| MVP | Future |
|---|---|
| Single vehicle type (economy), `fare_config` ready for more | Comfort / XL tiers |
| Upfront fare, server-calculated | Surge pricing, meter-based recalculation |
| Cash + wallet payment | Paystack card auto-charge |
| Sequential dispatch with radius expansion | Batched/optimized dispatch, driver acceptance-rate weighting |
| Cancel with reason recorded | Cancellation fees, driver penalties |
| Live driver tracking, breadcrumb trail | Route-deviation detection, anti-GPS-spoofing |
| Two-way ratings | Tipping, tags ("great conversation"), hidden-until-both-rate |
| Reconnect recovery via `/trips/active` | Offline queueing of driver actions |
| Stale-trip reaper (log + alert) | Auto-resolution of stuck trips |
| Trip history + receipts | Receipt emails/PDF |
| | Scheduled rides, multi-stop, ride pooling, promo codes, trip-start PIN, share-trip link, SOS (see settings doc) |

---

## 9. Build Order (execute in this sequence)

1. **Read the existing code**: trip state machine, matching engine, socket layer, wallet module. Write a short mapping note of any naming differences with this spec.
2. **Migrations**: `trips`, `trip_status_history`, `trip_offers`, `trip_ratings`, `fare_config`, `trip_locations`, rating columns on `users`, partial unique indexes. Seed `fare_config` for `economy` with placeholder values.
3. **Fare service + `/trips/estimate`**: unit-test `calculateFare` and `splitFare` (commission + earning always equals fare).
4. **`transitionTrip` + history**: reconcile with the existing state machine; unit-test every legal and illegal transition.
5. **`POST /trips`** with idempotency and active-trip guards. Test double-submit and second-trip attempts.
6. **BullMQ setup + dispatch / offer-timeout / search-expiry workers.** Test with fake drivers in Redis before touching the UI.
7. **Accept / decline endpoints + `trip:offer` socket events.** Test two drivers accepting at once.
8. **arrived / start / complete + settlement** for wallet and cash. Test a retried `complete` call produces no duplicate ledger rows.
9. **Cancel (rider + driver)** including offer rescinding.
10. **Live location ingest + `trip:{id}` broadcast + breadcrumbs.**
11. **`GET /trips/active`, `/trips/:id`, `/trips/history`, ratings.**
12. **Stale-trip reaper cron.**
13. **Frontend foundations**: `tripStore`, socket hook, `recover()` on start/foreground/reconnect, `routeForTrip` helper.
14. **Rider screens** in flow order: search → estimate → searching → on the way → in progress → completed + rating → history.
15. **Driver screens**: offer modal → navigate to pickup → arrived/start → in progress → summary; then background location.
16. **End-to-end test pass** (below).

### End-to-end scenarios that must pass

- Happy path: rider requests, driver accepts, arrives, starts, completes, both rate (wallet and cash variants)
- Two drivers tap Accept at the same moment: exactly one wins, the other gets a clean 409
- Driver accepts after the offer expired: rejected
- Rider cancels at the same moment a driver accepts: one outcome only, consistent on both screens
- Rider double-taps "Request" or retries on a bad network: exactly one trip
- No drivers online: rider reaches `no_drivers_found` within the search timeout
- Rider's app killed mid-trip, reopened: lands on the correct screen via `/trips/active`
- Driver loses connection during `in_progress`, reconnects: trip continues, location resumes
- `complete` called twice: second call fails, no duplicate money movement
- Driver suspended mid-trip: current trip can finish, driver cannot go online afterwards
- Cash trip pushes driver past the debt limit: driver cannot go online until topped up

---

## 10. Open Questions (agent: surface these, do not guess)

1. Do the existing state machine's status names match section 1? If not, list the mapping.
2. Does the wallet module support holds/escrow? If yes, use a hold at request time for wallet payments. If no, balance check at request and settle at completion.
3. What are the real Lagos `economy` fare numbers and commission percentage? Use clearly-labelled placeholders until confirmed.
4. What does the existing Location module expose for "online drivers near a point" and for marking a driver busy? Use those helpers rather than querying Redis directly.

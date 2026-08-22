# Architecture Overview

## System type
Modular monolith backend (Node/Express) + single React Native app (rider/driver
role-switching) + PostgreSQL (source of truth) + Redis (real-time/geo state) +
Socket.io (live updates) + Paystack (payments).

## High-level diagram (describe in words until a real diagram is added)
Client (React Native)
  <-- HTTP --> Express API
  <-- WebSocket --> Socket.io layer
Express API
  --> PostgreSQL (users, trips, payments, ratings, wallet_transactions)
  --> Redis (driver geo locations, online status, trip locks)
  --> Paystack API (charges, transfers)

## Why modular monolith, not microservices
See `AGENTS.md` Section 4. Short version: microservices solve org-scale problems this
project doesn't have yet. Clean module boundaries now make a future split possible
without paying the distributed-systems cost today.

## Core flows
- Auth: see `docs/features/auth.md`
- Trip request → match → complete: see `docs/features/trips.md` and `matching.md`
- Payments/wallet: see `docs/features/payments.md` and `wallet.md`

## Related docs
- `database-schema.md` — full table definitions
- `real-time-layer.md` — Redis + Socket.io design
- `matching-engine.md` — driver matching logic
- `wallet-ledger.md` — append-only ledger design
- `decisions/` — Architecture Decision Records (ADRs) for major choices


# Ride-Hailing App — Architecture & Documentation Plan

**App type:** Combined Rider/Driver app (single React Native app, role-based)
**Stack:** React Native, Zustand, Socket.io, Node/Express, PostgreSQL, Redis, JWT, Google Maps API, Paystack

---

## 1. FRONTEND (React Native)

### 1.1 Screens Needed (~19 pages total)

**Auth flow (4 screens)**
1. Splash Screen
2. Onboarding (1-2 swipeable slides, skip on repeat visits)
3. Login (phone + password)
4. Signup (name, phone, password, role default = rider)

**Shared/Common (5 screens)**
5. Home (map-based, shows Rider mode or Driver mode based on toggle)
6. Profile
7. Edit Profile
8. Wallet / Payment Methods (Paystack card management)
9. Notifications

**Rider flow (6 screens)**
10. Set Destination (search + Google Places autocomplete)
11. Confirm Ride (pickup, dropoff, fare estimate, ride type)
12. Finding Driver (loading/matching state)
13. Trip In Progress — Rider view (live map, driver info, ETA)
14. Trip Summary & Rating (after completion)
15. Trip History (list) + Trip Details (single trip)

**Driver flow (4 screens)**
16. Go Online/Offline (map + toggle + earnings summary widget)
17. Incoming Trip Request (modal/overlay, accept/decline with timer)
18. Trip In Progress — Driver view (navigate to pickup → navigate to dropoff)
19. Driver Earnings / Trip History

> Note: Trip History list/detail and Payment Methods screens are shared components reused by both roles — don't duplicate them.

### 1.2 Folder Structure

```
/src
  /screens
    /auth
      SplashScreen.js
      OnboardingScreen.js
      LoginScreen.js
      SignupScreen.js
    /rider
      SetDestinationScreen.js
      ConfirmRideScreen.js
      FindingDriverScreen.js
      TripInProgressScreen.js
      TripSummaryScreen.js
    /driver
      DriverHomeScreen.js
      IncomingRequestScreen.js
      DriverTripScreen.js
      EarningsScreen.js
    /shared
      HomeScreen.js
      ProfileScreen.js
      EditProfileScreen.js
      WalletScreen.js
      NotificationsScreen.js
      TripHistoryScreen.js
      TripDetailsScreen.js

  /components
    /map
      DriverMarker.js
      RouteLine.js
    /common
      Button.js
      Input.js
      LoadingSpinner.js
      RatingStars.js

  /navigation
    AppNavigator.js        # root switch: Auth stack vs Main stack
    AuthStack.js
    MainStack.js            # bottom tabs, role-aware

  /store                    # Zustand stores
    authStore.js             # user, token, role
    locationStore.js          # current GPS position
    tripStore.js               # active trip state
    uiStore.js                  # role toggle, modals, loading flags

  /services
    api.js                    # axios instance + interceptors (attach JWT)
    socket.js                  # socket.io client setup
    locationService.js          # GPS watching, background updates
    mapsService.js                # Google Places/Directions calls
    paymentService.js              # Paystack SDK wrapper

  /hooks
    useSocketEvents.js         # subscribes to trip/location events
    useCurrentLocation.js

  /constants
    colors.js
    config.js                   # API_BASE_URL, GOOGLE_MAPS_KEY

  /utils
    formatCurrency.js
    formatDistance.js

  App.js
```

**Why Zustand here:** you have real-time state (driver location, active trip status) that needs to update across multiple screens instantly without prop-drilling. Zustand is lighter than Redux for this scale — a few small stores, no boilerplate, and it plays well with values coming in over WebSocket events.

---

## 2. BACKEND (Node/Express)

### 2.1 Folder Structure

```
/src
  /modules
    /auth
      auth.routes.js
      auth.service.js
      auth.controller.js

    /users
      users.routes.js
      users.service.js
      users.controller.js

    /trips
      trips.routes.js
      trips.service.js
      trips.controller.js

    /location
      location.routes.js
      location.service.js

    /matching
      matching.service.js       # no routes — only used internally by trips

    /payments
      payments.routes.js
      payments.service.js
      paystack.client.js         # wraps Paystack API calls

    /ratings
      ratings.routes.js
      ratings.service.js

  /websocket
    index.js                     # socket.io server setup
    events.js                    # event name constants (avoid typos)
    handlers.js                  # what happens on each event

  /shared
    /middleware
      authMiddleware.js
      errorHandler.js
      validateRequest.js
    /config
      db.js                      # Postgres pool
      redis.js
      env.js                     # loads/validates .env vars
    /utils
      generateOtp.js
      calculateFare.js
      geoHelpers.js

  server.js
```

**Why `matching` has no routes file:** it's never called directly by the frontend — only used internally by the trips module. Not every module needs the full routes/service/controller trio; keep it lean.

---

## 3. DATABASE SCHEMA (PostgreSQL)

Keeping this to the essential 7 tables — enough for a real working MVP, no overengineering.

```sql
-- 1. Users (both riders and drivers)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(100),
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'rider',     -- 'rider' | 'driver' | 'both'
  profile_photo_url VARCHAR(255),
  rating_avg FLOAT DEFAULT 5.0,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Driver-specific details (only exists if user has driver role)
CREATE TABLE driver_profiles (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) UNIQUE,
  license_number VARCHAR(50),
  license_photo_url VARCHAR(255),
  verification_status VARCHAR(20) DEFAULT 'pending', -- pending | approved | rejected
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Vehicles (a driver could technically have more than one, but keep 1:1 for MVP)
CREATE TABLE vehicles (
  id SERIAL PRIMARY KEY,
  driver_id INT REFERENCES users(id),
  make VARCHAR(50),
  model VARCHAR(50),
  plate_number VARCHAR(20) UNIQUE,
  color VARCHAR(30),
  vehicle_type VARCHAR(20) DEFAULT 'standard' -- standard | premium | bike
);

-- 4. Trips
CREATE TABLE trips (
  id SERIAL PRIMARY KEY,
  rider_id INT REFERENCES users(id),
  driver_id INT REFERENCES users(id),
  pickup_lat FLOAT NOT NULL,
  pickup_lng FLOAT NOT NULL,
  pickup_address VARCHAR(255),
  dropoff_lat FLOAT NOT NULL,
  dropoff_lng FLOAT NOT NULL,
  dropoff_address VARCHAR(255),
  status VARCHAR(20) DEFAULT 'requested',
  -- requested | accepted | driver_arriving | in_progress | completed | cancelled
  distance_km FLOAT,
  fare FLOAT,
  cancelled_by VARCHAR(10),          -- 'rider' | 'driver' | null
  requested_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- 5. Payments
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  trip_id INT REFERENCES trips(id),
  amount FLOAT NOT NULL,
  method VARCHAR(20) DEFAULT 'card',  -- card | cash | wallet
  status VARCHAR(20) DEFAULT 'pending', -- pending | success | failed
  paystack_reference VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 6. Ratings (kept separate from trips so a trip could theoretically have rider->driver AND driver->rider ratings)
CREATE TABLE ratings (
  id SERIAL PRIMARY KEY,
  trip_id INT REFERENCES trips(id),
  rated_by INT REFERENCES users(id),
  rated_user INT REFERENCES users(id),
  stars INT CHECK (stars BETWEEN 1 AND 5),
  comment VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 7. OTP verifications (for phone signup/login verification)
CREATE TABLE otp_verifications (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  verified BOOLEAN DEFAULT FALSE
);
```

**Why not a `driver_locations` table:** live location doesn't belong in Postgres — it changes every few seconds and doesn't need permanent history for an MVP. Redis handles it (see below). If you later want trip route replay/analytics, that's a `trip_location_logs` table added later — not needed now.

---

## 4. REDIS — Key Structure (not tables, but just as important)

| Key pattern | Purpose | TTL |
|---|---|---|
| `drivers:locations` (GEO set) | All online drivers' live lat/lng | — |
| `driver:{id}:status` | `online` / `offline` | 30s (refreshed on each ping) |
| `driver:{id}:onTrip` | Trip ID if currently locked to a trip | 60s |
| `user:{id}:socketId` | Maps user to their active socket connection (optional, if not using rooms) | on disconnect |

---

## 5. ENVIRONMENT VARIABLES (.env)

```
DATABASE_URL=postgres://user:pass@localhost:5432/rideapp
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret
GOOGLE_MAPS_API_KEY=your_google_key
PAYSTACK_SECRET_KEY=your_paystack_secret
PORT=5000
```

---

## Build Order Recap

1. Auth + Users tables (done)
2. Location + Matching (done)
3. Trips + WebSocket wiring (done)
4. Payments (Paystack integration)
5. Ratings
6. Frontend screens, starting with Auth → Rider flow → Driver flow
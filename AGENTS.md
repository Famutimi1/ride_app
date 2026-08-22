# AGENTS.md

This file defines how any AI coding agent (or human dev) should work on this project.
Read this fully before writing or modifying any code.

---

## 1. Project Overview

# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.


A ride-hailing mobile platform (Uber/Bolt-style), combining **rider and driver experience
in a single React Native app** with role-based screen switching (not two separate apps).

- Target market context: Lagos, Nigeria (Lekki/Amuwo used for map/testing coordinates)
- Primary payment provider: **Paystack**
- Backend pattern: **Modular monolith** (not microservices) — see Section 4 for why

---

## 2. Tech Stack (do not substitute without asking)

| Layer | Technology |
|---|---|
| Language | **TypeScript** (both mobile app and backend) |
| Mobile app | React Native (Expo) |
| State management | Zustand (+ AsyncStorage for persistence, system-scheme detection for theme) |
| Real-time | Socket.io (WebSocket) |
| Backend | Node.js + Express |
| Primary database | PostgreSQL |
| Cache / geo / real-time state | Redis |
| Auth | JWT (access + refresh tokens) |
| Maps | Google Maps API (real embeds — never illustrated/placeholder maps) |
| Payments | Paystack (primary), Flutterwave patterns referenced for webhook handling |

Do not introduce a new library, ORM, state manager, or infra piece (e.g. swapping Redux
in for Zustand, or Prisma in for raw `pg`) unless explicitly asked. If you think a
substitution is a good idea, propose it and explain why — don't just do it.

---

## 3. Repository Structure

### Frontend (`mobile/src`)
```
/screens/{auth,rider,driver,shared}
/components/{map,common}
/navigation
/store        <- Zustand stores (authStore, locationStore, tripStore, uiStore)
/services     <- api.ts, socket.ts, locationService.ts, mapsService.ts, paymentService.ts
/hooks
/constants    <- colors.ts (single source of truth for palette), config.ts
/utils
```

### Backend (`backend/src`)
```
/modules/{auth,users,trips,location,matching,payments,ratings}
  each module: *.routes.ts, *.service.ts, *.controller.ts
  (matching has no routes.ts — it's only called internally by trips)
/websocket    <- index.ts, events.ts (event name constants), handlers.ts
/shared
  /middleware <- authMiddleware.ts, errorHandler.ts, validateRequest.ts
  /config     <- db.ts (Postgres pool), redis.ts, env.ts
  /utils      <- generateOtp.ts, calculateFare.ts, geoHelpers.ts
server.ts
```

**Rule:** new backend logic goes in the matching module folder. Do not create files
directly in `/src` or dump logic into `server.ts`. Do not merge unrelated concerns into
one file (e.g. payment logic inside trips.service.ts) — cross-module calls should
import the other module's service function, not reimplement it.

---

## 4. Architecture Principles (the "why" — follow these, don't just pattern-match)

- **Modular monolith over microservices at this stage.** Microservices solve
  org-scale problems (many teams, independent deploys). At this project's size they'd
  only add network overhead and distributed-transaction pain. Module boundaries inside
  the monolith should stay clean enough that a future split is possible, but don't
  build it as if it's already split.
- **Real-time driver location lives in Redis, never Postgres.** High write frequency
  (every few seconds, per driver) + need for fast geo queries (`GEOADD`/`GEOSEARCH`)
  makes Redis the right tool. Postgres stores permanent records (trips, payments,
  ratings) where correctness matters more than raw speed.
- **Money is append-only.** Wallet/ledger entries (`wallet_transactions`) are never
  edited or deleted. Corrections are new offsetting rows (a credit to reverse a debit,
  etc.), so there's always a full audit trail. This is non-negotiable — do not write
  code that does `UPDATE wallet_transactions SET amount = ...`.
- **Concurrency protection happens in the database, not in application code.**
  Wallet balance changes and withdrawal processing use `SELECT ... FOR UPDATE` inside
  an explicit transaction. Do not rely on `await`/in-memory locks/flags to prevent race
  conditions — Node's single-threaded event loop does not protect against concurrent
  requests interleaving between awaited DB calls.
- **Driver-trip locking uses Redis `SET NX EX`.** When a driver accepts a trip, lock
  them with `SET driver:{id}:onTrip {tripId} NX EX 60`. This guarantees only one rider
  can successfully claim a given driver, and auto-expires if something goes wrong
  mid-flow.
- **Trip status changes must go through the explicit state machine**
  (`requested → accepted → driver_arriving → in_progress → completed/cancelled`).
  Never let a route handler set `status` directly without checking it's a valid
  transition from the current state.
- **Withdrawals are webhook-driven, with a reconciliation fallback.** Payment
  provider webhooks resolve withdrawal status. A cron job separately queries the
  provider's transfer-status API for anything stuck in `pending` beyond a threshold —
  don't assume webhooks always arrive.

---

## 5. Database Rules

- Standard 7-table core: `users`, `driver_profiles`, `vehicles`, `trips`, `payments`,
  `ratings`, `otp_verifications` (+ `wallet_transactions` for ledger). Don't add tables
  speculatively — if a new table seems needed, flag it and explain why before creating it.
- All money fields are ledger entries in `wallet_transactions`, not columns mutated
  in place.
- Use parameterized queries (`$1, $2...`) always. Never string-concatenate user input
  into SQL — no exceptions, this is a hard rule, not a style preference.
- Foreign keys reference `users(id)` for both riders and drivers — there is one
  `users` table with a `role` field (`rider` | `driver` | `both`), not separate tables.

---

## 6. Real-Time / WebSocket Rules

- Use named rooms: `driver:{id}` and `trip:{id}` for targeted delivery. Don't broadcast
  globally and filter client-side.
- Socket event names live in `/websocket/events.ts` as constants — never hardcode
  event name strings inline in emit/on calls.
- If running multiple Node instances, the Socket.io Redis adapter is required so
  events reach clients connected to a different instance. Don't assume single-instance
  deployment when writing WebSocket code.

---

## 7. Frontend Rules

- **Design direction:** white-forward, clean UI (Bolt/Uber-inspired). No dark/moody
  default aesthetics. No illustrated/placeholder maps — always real Google Maps
  embeds.
- **Color system:** three semantic colors only — blue `#2F6FED` (actions), jade
  `#12B87A` (online/earnings-in), coral `#F0473F` (decline/earnings-out). Amber is
  reserved for star ratings only, not general use.
- **All raw hex values live in one palette/theme file.** Components reference
  semantic tokens (`colors.action`, `colors.positive`, etc.), never hardcoded hex
  values inline. This is what makes the whole app re-themeable by editing one file.
  Enforce this even under time pressure — don't hardcode "just this once."
- **Light/dark mode** via CSS custom property token swapping on a `[data-theme]`
  attribute — not two parallel hardcoded style sheets.
- **Driver wallet screen colors carry financial meaning** (success/warning/danger).
  If reskinning this screen, preserve the semantic mapping — don't let a palette swap
  accidentally turn "danger" red into a decorative color choice.
- Zustand stores are the source of truth for cross-screen real-time state (active
  trip, current location, role toggle). Don't prop-drill state that a store already
  owns.

---

## 8. Security Rules

- Passwords: bcrypt hash only, never store or log plaintext.
- JWT secret and all provider keys (Paystack, Google Maps) come from `.env` /
  `shared/config/env.ts` — never hardcoded, never committed.
- Every route that isn't public (auth, health check) goes through `requireAuth`
  middleware.
- Payment card data is never handled or stored directly — always via Paystack's SDK/API.

---

## 9. Code Style Conventions

- Explanations and PR descriptions should be written plainly — assume a junior
  developer is reading, favor short code snippets and plain-English "why" over dense
  jargon.
- Route files handle HTTP concerns only (status codes, req/res). Service files hold
  business logic and should be callable independent of Express (so logic is reusable
  from scripts, admin tools, etc.).
- Prefer explicit, readable code over clever one-liners.
- New modules follow the existing `routes / service / controller` file trio unless
  there's a clear reason not to (like `matching`, which is internal-only).
- **TypeScript everywhere** (`.ts`). Type function inputs/outputs and API request/response
  payloads; avoid `any`. Run `npm run typecheck` before considering a change done.

---

## 10. Things to Never Do

- Never build custom card/payment processing — always go through Paystack.
- Never mutate wallet/ledger rows — always insert offsetting entries.
- Never skip the trip state machine validation.
- Never use string concatenation for SQL queries.
- Never hardcode hex colors outside the palette file.
- Never introduce a second live-location store — Redis is the only source of truth
  for "where is this driver right now."
- Never assume single-server deployment for WebSocket code without the Redis adapter.
- Never add a new table, service, or major dependency without flagging it first.

---

## 11. What To Do When Unsure

If a request conflicts with anything in this file, or requires a decision not covered
here (new table, new dependency, architecture change), stop and ask before proceeding
rather than guessing. State the trade-off briefly and let the human decide.
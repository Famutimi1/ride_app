# Dependencies & Stack Plan

The recommended libraries for this project, mobile and backend, with the
reasoning behind each and **when** to add it (mapped to the build order in
`CLAUDE.md`). This is a plan, not a lock file — nothing here is installed until
the relevant build stage.

> **Provenance:** Researched and verified on **2026-08-22** against the Expo
> **SDK 57** versioned docs (`docs.expo.dev/versions/v57.0.0/`) and live npm.
> Versions move — re-check with `npm view <pkg> version` before a fresh install.
> Per `AGENTS.md`, adding a new major dependency is a "flag first" action; this
> doc is the flag, not a green light to install everything at once.

---

## Read first — 3 decisions that shape everything

1. **A custom dev build is mandatory — Expo Go will not run this app.** Three
   core features each independently require it: **background location** (driver
   tracking), **push notifications**, and maps. Plan to use **EAS Build /
   `expo-dev-client`** from the start. Treat Expo Go as a scratchpad for
   non-native screens only.
2. **Use `react-native-maps`, not `expo-maps`.** `expo-maps` sounds like the
   first-party choice, but as of SDK 57 it is still **alpha** and only renders
   **Google Maps on Android** (iOS falls back to Apple Maps). Our design rule is
   *real Google Maps on both platforms*, so `react-native-maps` with
   `provider={PROVIDER_GOOGLE}` is the only fit today. Revisit if `expo-maps`
   reaches stable with cross-platform Google support.
3. **Don't install ahead of need.** Several libraries below are marked *defer* —
   installing them before you have 2+ backend instances (or before the payments
   stage) just adds noise. Add them at the stage listed.

---

## Mobile (`mobile/`)

Install with **`npx expo install <pkg>`** (not plain `npm i`) so versions stay
aligned with SDK 57.

| Need | Package | Ships in SDK 57? | Key caveat |
|---|---|---|---|
| Maps (real Google Maps) | `react-native-maps` | Yes (first-party doc page) | Use `provider={PROVIDER_GOOGLE}`. API keys in `app.json` needed for store builds. |
| Location (foreground + background) | `expo-location` + `expo-task-manager` | Yes | Background = **dev build required**. Define the task at JS **module top level**, not in a component. iOS needs "Always" permission; Android 14+ needs `FOREGROUND_SERVICE_LOCATION`. |
| Push notifications | `expo-notifications` | Yes | Remote push = **dev build required** (removed from Expo Go on Android). On Android 13+, create a notification channel *before* requesting the push token or the prompt won't appear. |
| Secure token storage (JWT) | `expo-secure-store` | Yes | Works in Expo Go. Treat as a **cache**, not permanent storage — Android clears it on uninstall. Always be able to re-auth via refresh token. |
| Persisted state (Zustand) | `@react-native-async-storage/async-storage` | Yes (listed third-party) | Pairs with Zustand `persist`. **Never** store tokens/PII here — it's unencrypted; that's SecureStore's job. |
| Real-time client | `socket.io-client` | No (plain npm) | **RN gotcha:** pass `transports: ['websocket']` to skip flaky long-polling. Socket drops when app is backgrounded — use it for foreground live-trip updates, not background tracking. |
| Route polylines | `@mapbox/polyline` | No (plain npm) | Decodes the encoded polyline from Google Directions/Routes API into coordinates for `<Polyline>`. Proxy the routing call through the backend to keep the API key off the device. |
| Photos (license / vehicle) | `expo-image-picker` | Yes | Set `microphonePermission: false` in the config plugin — it adds `RECORD_AUDIO` by default, which we don't need. |
| Marker clustering (optional) | `react-native-map-clustering` | No (plain npm) | For many drivers on screen. Verify on a dev build first — New-Architecture readiness unconfirmed. |

---

## Backend (`backend/`)

Currently installed: `cors`, `dotenv`, `express@5`, `helmet`, `morgan` (all fine
on Express 5). The data / real-time / auth layer is still unbuilt.

### Core set — install when you start Stage 1 (Auth)
```bash
npm i pg ioredis socket.io zod jose bcryptjs
npm i -D @types/pg @types/express @types/node vitest supertest @types/supertest
```

| Need | Package (major) | Why |
|---|---|---|
| PostgreSQL | `pg` 8.x (+ `@types/pg`) | Our mandated raw-SQL driver (no ORM). Types aren't bundled — add the `@types`. |
| Redis | `ioredis` 6 | Under the official Redis org, actively maintained. Terse `geoadd`/`geosearch` for driver matching. |
| Real-time | `socket.io` 4.8 | Server side of the WebSocket layer. |
| Validation | `zod` 4.x | Request-validation middleware. Reuse it for **env validation** too (no extra lib). |
| JWT | `jose` 6 *or* `jsonwebtoken` 9 | **Coin-flip:** `jose` = modern, zero-dep, ESM, bundled types (fits our TS/ESM setup). `jsonwebtoken` = simpler API + more tutorials (gentler for learning). Pick by what matters more. |
| Password hashing | `bcryptjs` 3 | **Chosen for our Windows dev box** — pure JS, no native build. `bcrypt` (native) is the classic "install fails on Windows" trap. OWASP-preferred upgrade later: `@node-rs/argon2` (prebuilt, no compile). |
| Testing | `vitest` 4 + `supertest` | Vitest runs `.ts` natively (no `ts-jest` config) — best fit for Express 5 + TS. |

### Paystack — no SDK, use `fetch`
There is no maintained official Node SDK. Call the REST API directly with
Node's built-in `fetch`:
- `POST https://api.paystack.co/transaction/initialize` (auth: `Bearer <secret>`)
- `GET  https://api.paystack.co/transaction/verify/:reference`
- Webhooks (later): verify the `x-paystack-signature` header as an
  **HMAC-SHA512** of the **raw** request body, keyed with the secret key.
  ⚠️ Verify this scheme against `paystack.com/docs/payments/webhooks` before building.

### Defer until actually needed (installing early = pointless bloat)
| Package | Add when |
|---|---|
| `@socket.io/redis-adapter` | You run **2+ backend instances**. Single instance doesn't need it. |
| `express-rate-limit` (+ `rate-limit-redis`) | Hardening auth endpoints. |
| `node-cron` **or** `croner` | The **Payments** stage — withdrawal-reconciliation fallback. ⚠️ Guard with a Redis lock so it doesn't double-run if scaled out. |

### Express 5 heads-up
- `helmet` / `cors` / `morgan` all work on Express 5 — no change needed.
- **Routing changed:** wildcards are now `app.get('/*splat', …)`, not `app.get('*', …)`.
- Express 5 **auto-forwards async errors** to error middleware — you do **not**
  need `express-async-handler`.
- Express ships no types — keep `@types/express` (5.x line).

---

## When to add what (mapped to the CLAUDE.md build order)

| Stage | Backend | Mobile |
|---|---|---|
| 1. Auth + Users | `pg`, `zod`, `jose`/`jsonwebtoken`, `bcryptjs` | `expo-secure-store`, `async-storage` |
| 2. Location + Matching | `ioredis` (GEOADD/GEOSEARCH) | `expo-location` + `expo-task-manager`, `react-native-maps` |
| 3. Trips + WebSocket | `socket.io` | `socket.io-client` |
| 4. Payments | Paystack via `fetch`; `node-cron`/`croner` | — |
| 5. Ratings | — | — |
| 6. Frontend polish | — | `expo-notifications`, `expo-image-picker`, `@mapbox/polyline` |

---

## Confirm at implementation time (flagged as inferred, not doc-verified)
- `react-native-maps` New-Architecture support (SDK 57 defaults to New Arch) —
  strong evidence, but test on a dev build.
- Google **Routes API vs Directions API** — confirm which is enabled in the
  Google Cloud console.
- Paystack webhook HMAC-SHA512 / `x-paystack-signature` detail — verify in a
  browser (their docs sit behind Cloudflare).
- `expo-location`'s `foregroundService` option field name — verify when wiring
  the Android foreground service.

---

## Links
- Expo SDK 57 index — https://docs.expo.dev/versions/v57.0.0/
- react-native-maps (SDK 57) — https://docs.expo.dev/versions/v57.0.0/sdk/map-view/
- expo-location — https://docs.expo.dev/versions/v57.0.0/sdk/location/
- expo-task-manager — https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/
- expo-notifications — https://docs.expo.dev/versions/v57.0.0/sdk/notifications/
- expo-secure-store — https://docs.expo.dev/versions/v57.0.0/sdk/securestore/
- Socket.IO client options — https://socket.io/docs/v4/client-options/
- Related: `docs/setup/claude-code-skills.md`, `docs/third-party/*`

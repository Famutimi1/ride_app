# Ride-Hailing App

Combined rider/driver React Native app. Node/Express modular monolith backend.
PostgreSQL + Redis + Socket.io + Paystack.

## Start here
- `AGENTS.md` — rules every contributor (human or AI) must follow
- [Implementation audit and remaining work](/Users/mac/Desktop/ride_app/docs/ride-hailing-implementation-audit.md) — current rider/driver/backend inventory, incomplete interfaces, launch priorities, and verification results (10 October 2026)
- [Gap implementation plan and progress](/Users/mac/Desktop/ride_app/docs/ride-hailing-gap-implementation-plan.md) — core-first sequence, approved decisions, completed code checks and outstanding work
- `CLAUDE.md` — Claude-specific workflow notes
- `docs/architecture/overview.md` — system design
- [Money and database ownership guide](/Users/mac/Desktop/ride_app/docs/architecture/money-and-database-ownership-guide.md) — payment tables, step-by-step money flows, code examples, and verified limitations
- [Trips, schedules, and courier ownership guide](/Users/mac/Desktop/ride_app/docs/architecture/trips-schedules-courier-ownership-guide.md) — UI-to-database walkthroughs, Redis, WebSockets, dispatch, delivery codes, returns, and troubleshooting examples
- `docs/setup/local-development.md` — how to run this locally
- [Firebase, Google Maps, signing, and EAS setup](docs/setup/firebase-google-maps-eas-guide.md) — beginner walkthrough of push credentials, client files, fingerprints, Google login, build environments, and updates

## Docs map
| Folder | What lives here |
|---|---|
| `docs/architecture/` | How the system is designed, and why |
| `docs/features/` | One file per feature — what it does, how it works, edge cases |
| `docs/third-party/` | Integration notes for Expo, Google Maps, Paystack, Redis, Socket.io |
| `docs/api/` | Endpoint reference |
| `docs/design/` | Design system, color tokens, screen inventory |
| `docs/setup/` | Environment variables, local dev setup |


# Ride App

Monorepo for the ride app: an Expo (React Native) mobile client and a Node.js + Express backend API.

## Projects

| Folder     | Stack                            | Description                   |
| ---------- | -------------------------------- | ----------------------------- |
| `mobile/`  | Expo · React Native · TypeScript | Mobile app (iOS/Android/web)  |
| `backend/` | Node.js · Express · TypeScript   | REST API                      |

## Prerequisites

- Node.js >= 18 (developed on v24)
- npm
- For mobile: the Expo Go app on your phone, or an Android/iOS emulator

## Backend

```bash
cd backend
npm install        # first time only
npm run dev        # starts on http://localhost:4000
```

Health check: `GET http://localhost:4000/api/health`

See [backend/README.md](backend/README.md) for all scripts and endpoints.

## Mobile

```bash
cd mobile
npm install        # first time only
npm start          # opens Expo; press a / i / w for android / ios / web
```

The app pings the backend health endpoint on launch to confirm connectivity.

### Connecting the app to the backend

The API base URL lives in [mobile/src/api/client.ts](mobile/src/api/client.ts):

- **Android emulator** → `http://10.0.2.2:4000` (handled automatically)
- **iOS simulator / web** → `http://localhost:4000` (handled automatically)
- **Physical device** → edit the file to your computer's LAN IP, e.g. `http://192.168.1.20:4000`
  (a phone's `localhost` points at the phone itself, not your dev machine)

## Ports

- Backend runs on **4000**. Port 3000 is intentionally avoided since it's commonly taken by other local dev servers.

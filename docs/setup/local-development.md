# Local Development Setup

## Prerequisites
- Node.js (version TBD — pin once decided)
- PostgreSQL running locally or via Docker
- Redis running locally or via Docker (or Upstash free tier)
- Expo CLI (npx expo, no global install needed for modern Expo)

## Backend setup
1. `cd backend`
2. `npm install`
3. Copy `.env.example` to `.env` and add the restricted Google server key, Redis URL, and database URL.
4. Start Redis.
5. Run migrations when the migration tooling is added.
6. Run `npm run dev` (Express and Socket.io listen on port 4000 by default).

## Frontend setup
1. `cd mobile`
2. `npm install`
3. Copy `.env.example` to `.env` and add the Android/iOS restricted map keys.
4. Run `npx expo start` for web or Expo Go-compatible flows.
5. Use a custom development build for iOS Google Maps and background location.

## Common issues
- Port 5000 is used by macOS Control Center/AirPlay on some Macs; this project defaults to 4000.
- A phone cannot call the Mac using `localhost`; the mobile API service derives Metro's LAN host during development.
- A blank Google map in a native build usually means the platform key restriction, bundle/package identifier, SHA-1, billing, or enabled Maps SDK does not match.
- Places and route search intentionally show fallback UI when `backend/.env` has no `GOOGLE_MAPS_API_KEY`.

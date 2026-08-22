# Local Development Setup

## Prerequisites
- Node.js (version TBD — pin once decided)
- PostgreSQL running locally or via Docker
- Redis running locally or via Docker (or Upstash free tier)
- Expo CLI (npx expo, no global install needed for modern Expo)

## Backend setup
1. cd backend
2. npm install
3. cp .env.example .env and fill in values (see environment-variables.md)
4. Run migrations (tool TBD)
5. npm run dev

## Frontend setup
1. cd mobile
2. npm install
3. cp .env.example .env
4. npx expo start

## Common issues
> Document real issues here as you hit them — this section is more useful once
> its based on actual friction, not guesses.

# Ride App — Backend

Node.js + Express + TypeScript API for the ride app.

## Getting started

```bash
npm install
cp .env.example .env   # already created for you with defaults
npm run dev            # start with hot reload (tsx watch)
```

The server starts on `http://localhost:4000` by default.

## Scripts

| Script              | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Start dev server with hot reload (`tsx watch`) |
| `npm run build`     | Compile TypeScript to `dist/`                |
| `npm start`         | Run the compiled server from `dist/`         |
| `npm run typecheck` | Type-check without emitting output           |

## Endpoints

| Method | Path          | Description            |
| ------ | ------------- | ---------------------- |
| GET    | `/`           | Service info           |
| GET    | `/api/health` | Health check + uptime  |

## Structure

```
backend/
├── src/
│   ├── index.ts          # Server bootstrap
│   ├── app.ts            # Express app + middleware
│   ├── config/
│   │   └── env.ts        # Typed environment config
│   └── routes/
│       └── health.ts     # /api/health route
├── .env.example
├── tsconfig.json
└── package.json
```

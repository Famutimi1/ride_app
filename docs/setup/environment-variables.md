# Environment Variables

Reference for every env var used across backend and mobile. Keep in sync with
.env.example — this file explains *why*, .env.example just lists the keys.

## Backend
| Var | Purpose |
|---|---|
| DATABASE_URL | Postgres connection string |
| REDIS_URL | Redis connection string |
| JWT_SECRET | Signs access tokens |
| JWT_REFRESH_SECRET | Signs refresh tokens (once implemented) |
| GOOGLE_MAPS_API_KEY | Server-side Maps/Places/Directions calls |
| PAYSTACK_SECRET_KEY | Server-side Paystack API calls — never expose to client |
| PORT | Express server port |

## Mobile (Expo)
| Var | Purpose |
|---|---|
| EXPO_PUBLIC_API_BASE_URL | Backend API base URL |
| EXPO_PUBLIC_GOOGLE_MAPS_KEY | Client-side Maps key — restrict by bundle ID in Google Cloud Console |

## Rule
Anything prefixed EXPO_PUBLIC_ is bundled into the client and visible to anyone —
never put a secret key there.

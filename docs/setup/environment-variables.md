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
| FARE_BASE_NGN | Base fare in naira; defaults to 800 |
| FARE_PER_KM_NGN | Distance rate in naira; defaults to 250 |
| FARE_PER_MINUTE_NGN | Time rate in naira; defaults to 35 |
| PAYSTACK_SECRET_KEY | Server-side Paystack API calls — never expose to client |
| PORT | Express server port |

## Mobile (Expo)
| Var | Purpose |
|---|---|
| EXPO_PUBLIC_API_BASE_URL | Backend API base URL |
| EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY | Android Maps SDK key, restricted by package and SHA-1 |
| EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY | iOS Maps SDK key, restricted by bundle ID |
| EXPO_PUBLIC_GOOGLE_MAPS_KEY | Temporary shared-key fallback; separate platform keys are preferred |

## Rule
Anything prefixed EXPO_PUBLIC_ is bundled into the client and visible to anyone —
never put a secret key there.

On a physical phone, the development client automatically replaces a configured
`localhost` API hostname with Metro's LAN hostname. The backend still uses the
configured port, currently `4000`.

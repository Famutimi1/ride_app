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

## Shared OTP for private testing

Set these **backend runtime** variables to let private testers use `666666`
for registration and login, including the staff/admin dashboard:

```dotenv
TEST_OTP_ENABLED=true
TEST_OTP_CODE=666666
```

This setting works with `NODE_ENV=production`. It defaults to disabled; enabling
it requires an explicitly configured six-digit code. It skips SMS delivery for
registration/login and prints the alternative generated random OTP in backend
logs. Termii is not needed for those flows while the setting is enabled.

Both codes require a pending, unexpired request for the same phone and purpose.
Attempt limits, resend limits, single-use consumption, active-account checks,
staff role checks and session scopes still apply. Login requires an existing
active account; public registration cannot create staff/admin roles. Phone changes,
payout-account verification and withdrawals still require their normal OTP.

The shared code does not prove phone ownership. Anyone who knows the code and a
registered number can sign in to that account, including a staff account. Use
this only for the agreed private testing period; the setting itself does not
restrict who can reach the deployment.

Before public launch, configure Termii, set `TEST_OTP_ENABLED=false` and remove
`TEST_OTP_CODE`, then restart/redeploy **every** backend instance. With the setting
disabled, outstanding requests also stop accepting the alternative shared code;
only their generated code remains valid. Verify that a newly requested random
code works and that the former shared code is rejected. Do not set these values
in Expo or dashboard frontend environment variables.

Transactional email variables are server-only: `EMAIL_ENABLED`, `RESEND_API_KEY`,
`RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_ADMIN_RECIPIENTS`,
`EMAIL_DASHBOARD_URL` and optional `EMAIL_LOGO_URL`. The dashboard origin also hosts
the customer `/open-app` page; `EMAIL_APP_URL` is no longer needed. Optional dashboard
settings `RAKKY_ANDROID_STORE_URL` and `RAKKY_IOS_STORE_URL` provide published store links. Sending defaults
to disabled. See [email setup](../features/email-system.md) for verified-domain,
public logo, app-link and webhook requirements.

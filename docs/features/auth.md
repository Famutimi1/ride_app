# Task Spec: Authentication System (Phone OTP + JWT + Google Sign-In)

**Target:** AI coding agent (Cursor/Claude executing against this repo)
**Depends on:** `AGENTS.md` (stack rules), existing modular monolith structure, existing PostgreSQL + Redis setup
**Replaces:** the earlier password/bcrypt auth module described in project notes. This spec is phone-first, OTP-based, and password-free — matching the UI flow the product now uses.

---

## 0. Architecture Decisions (read first, do not deviate without flagging)

1. **Primary identity = phone number, not password.** Registration/login both flow through phone + OTP. No password field exists anywhere in this system.
2. **Google Sign-In is a secondary entry path, not a replacement for phone verification.** A user can sign up/log in with Google, but if they're new, they must still verify a phone number before the account is fully active — phone is how drivers and riders communicate and how safety/SOS features work. Google just pre-fills name/email and skips typing.
3. **Token strategy:** short-lived JWT **access token** (15 min) + long-lived **refresh token** (30 days), refresh tokens are rotated on every use and stored (hashed) in Postgres so they can be revoked. This is the industry-standard pattern — access tokens are never persisted server-side, refresh tokens are.
4. **Role model:** every user is a rider by default. "Becoming a driver" is an *application* that produces a `driver_profile` row with a status, not a separate account. Role switching in the app is just a client-side view toggle, gated by `driver_profile.status === 'approved'`.
5. **OTP delivery is provider-abstracted.** Build one `OtpProvider` interface with a Termii (or Africa's Talking) implementation behind it, so swapping providers later is a one-file change — same philosophy as the design-token system already in place.
6. **Rate limiting lives in Redis**, since Redis is already in the stack for geo/matching — no new infra.

---

## 1. Database Schema

### 1.1 `users` table (new or altered)

```sql
CREATE TYPE user_role AS ENUM ('user', 'admin', 'super_admin');

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       VARCHAR(120) NOT NULL,
  phone           VARCHAR(20) UNIQUE NOT NULL,       -- E.164 format: +2348012345678
  phone_verified_at TIMESTAMPTZ,
  email           VARCHAR(160) UNIQUE,               -- nullable, populated via Google or later
  google_id       VARCHAR(64) UNIQUE,                -- nullable
  avatar_url      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  role            user_role NOT NULL DEFAULT 'user',        -- platform permission level
  active_role     VARCHAR(10) NOT NULL DEFAULT 'rider'
                  CHECK (active_role IN ('rider', 'driver')), -- which product view
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_google_id ON users(google_id);
```

Note: if a `users` table already exists with a `password_hash` column from the earlier module, write a migration that drops it — don't leave dead columns.

`role` is never self-assigned through any public endpoint — `admin`/`super_admin` rows are only ever set via a DB seed, internal script, or (later) an invite flow gated by an existing `super_admin`. `active_role` is user-toggled but always server-validated against `driver_profiles.status` before it's allowed to flip to `'driver'` (see §2.8 below) — never trust a client-sent `active_role` value.

### 1.2 `driver_profiles` table

```sql
CREATE TYPE driver_application_status AS ENUM ('none', 'pending', 'approved', 'rejected');

CREATE TABLE driver_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            driver_application_status NOT NULL DEFAULT 'none',
  vehicle_make      VARCHAR(60),
  vehicle_model     VARCHAR(60),
  vehicle_year      INT,
  vehicle_color     VARCHAR(30),
  plate_number      VARCHAR(20),
  license_doc_url   TEXT,
  vehicle_reg_doc_url TEXT,
  insurance_doc_url TEXT,
  rejection_reason  TEXT,
  submitted_at      TIMESTAMPTZ,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
```

### 1.3 `otp_codes` table

```sql
CREATE TYPE otp_purpose AS ENUM ('registration', 'login', 'phone_change');

CREATE TABLE otp_codes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         VARCHAR(20) NOT NULL,
  code_hash     VARCHAR(255) NOT NULL,     -- sha256 or bcrypt of the 6-digit code, never store plaintext
  purpose       otp_purpose NOT NULL,
  attempts      INT NOT NULL DEFAULT 0,
  max_attempts  INT NOT NULL DEFAULT 5,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_phone_purpose ON otp_codes(phone, purpose);
```

### 1.4 `refresh_tokens` table

```sql
CREATE TABLE refresh_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    VARCHAR(255) NOT NULL,     -- sha256 of the raw refresh token, never store raw
  device_info   VARCHAR(255),              -- e.g. "iPhone 14 / Expo Go" — from request headers
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  replaced_by   UUID REFERENCES refresh_tokens(id)  -- rotation chain, lets you detect reuse
);

CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_token_hash ON refresh_tokens(token_hash);
```

---

## 2. Backend Implementation

### 2.1 Folder structure additions (fits existing modular monolith)

```
/src
  /modules
    /auth
      auth.routes.js
      auth.controller.js
      auth.service.js          # registration, login, token issuance/rotation
      otp.service.js           # generate, hash, verify, rate-limit OTPs
      otp.provider.termii.js   # concrete SMS provider implementation
      otp.provider.interface.js
      google.service.js        # verify Google id_token, find-or-create user
      jwt.service.js           # sign/verify access + refresh tokens
      auth.middleware.js       # requireAuth, requireApprovedDriver, requireRole
    /driver
      driver.routes.js
      driver.controller.js
      driver.service.js        # onboarding steps, document handling, status
```

### 2.2 OTP Service (`otp.service.js`)

Responsibilities:
- `generate(phone, purpose)` → creates a random 6-digit code, hashes it (sha256 is fine — this isn't a password, it's a 6-digit code with a short TTL and attempt limit), inserts a row with `expires_at = now() + 5 minutes`, calls `OtpProvider.send(phone, code)`.
- `verify(phone, purpose, submittedCode)` → fetches the latest unconsumed row for that phone+purpose, checks `expires_at`, increments `attempts` on every call, rejects if `attempts >= max_attempts`, compares hash, marks `consumed_at` on success.
- **Rate limiting (Redis):** before generating a new OTP, check key `otp:rate:{phone}` — max 3 sends per 15 minutes, and a hard cooldown of 60 seconds between consecutive sends to the same phone. Return `429` with a `retryAfterSeconds` field if exceeded.

```js
// otp.provider.interface.js
class OtpProvider {
  async send(phone, code) { throw new Error('not implemented'); }
}
module.exports = OtpProvider;
```

```js
// otp.provider.termii.js — concrete implementation, swap for any provider later
const axios = require('axios');
class TermiiOtpProvider extends OtpProvider {
  async send(phone, code) {
    await axios.post('https://api.ng.termii.com/api/sms/send', {
      api_key: process.env.TERMII_API_KEY,
      to: phone,
      from: process.env.TERMII_SENDER_ID,
      sms: `Your verification code is ${code}. It expires in 5 minutes.`,
      type: 'plain',
      channel: 'generic',
    });
  }
}
```

### 2.3 JWT Service (`jwt.service.js`)

```js
const jwt = require('jsonwebtoken');

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, phone: user.phone },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

function signRefreshToken() {
  // opaque random token, NOT a JWT — simpler to revoke/rotate via DB lookup
  return require('crypto').randomBytes(48).toString('hex');
}

function hashToken(rawToken) {
  return require('crypto').createHash('sha256').update(rawToken).digest('hex');
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET); // throws on invalid/expired
}

module.exports = { signAccessToken, signRefreshToken, hashToken, verifyAccessToken };
```

**Why an opaque refresh token instead of a JWT refresh token:** a JWT refresh token can't be revoked without a blocklist anyway, so you gain nothing from it being a JWT — an opaque random string looked up by hash in Postgres is simpler and just as secure, and it's the pattern Auth0/Okta use.

### 2.4 Refresh Token Rotation Logic (`auth.service.js`)

This is the part most teams get wrong — implement it exactly like this:

```js
async function issueTokenPair(userId, deviceInfo, client) {
  const accessToken = jwt.signAccessToken({ id: userId });
  const rawRefreshToken = jwt.signRefreshToken();
  const tokenHash = jwt.hashToken(rawRefreshToken);

  await client.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_info, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 days')`,
    [userId, tokenHash, deviceInfo]
  );

  return { accessToken, refreshToken: rawRefreshToken };
}

async function rotateRefreshToken(rawRefreshToken, deviceInfo, client) {
  const tokenHash = jwt.hashToken(rawRefreshToken);
  const { rows } = await client.query(
    `SELECT * FROM refresh_tokens WHERE token_hash = $1`, [tokenHash]
  );
  const existing = rows[0];

  if (!existing) throw new AuthError('invalid_refresh_token');

  // REUSE DETECTION: if this token was already rotated away (replaced_by is set)
  // or revoked, someone is replaying a stolen token — kill the whole session chain.
  if (existing.revoked_at || existing.replaced_by) {
    await client.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [existing.user_id]
    );
    throw new AuthError('refresh_token_reuse_detected');
  }

  if (new Date(existing.expires_at) < new Date()) throw new AuthError('refresh_token_expired');

  const newPair = await issueTokenPair(existing.user_id, deviceInfo, client);
  const newTokenHash = jwt.hashToken(newPair.refreshToken);

  await client.query(
    `UPDATE refresh_tokens SET revoked_at = now(),
       replaced_by = (SELECT id FROM refresh_tokens WHERE token_hash = $1)
     WHERE id = $2`,
    [newTokenHash, existing.id]
  );

  return newPair;
}
```

Run this inside a Postgres transaction (`BEGIN`/`COMMIT`) — same discipline as the wallet ledger.

### 2.5 Endpoints

| Method | Path | Body | Purpose | Auth required |
|---|---|---|---|---|
| POST | `/auth/register/initiate` | `fullName, phone, accountType` | Validate phone not already registered, send OTP | No |
| POST | `/auth/register/verify` | `phone, code, accountType` | Verify OTP, create `users` row, issue tokens. No `driver_profiles` row is created here; if `accountType=driver`, the client routes to Driver Onboarding | No |
| POST | `/auth/login/initiate` | `phone` | Confirm phone exists, send OTP | No |
| POST | `/auth/login/verify` | `phone, code` | Verify OTP, issue tokens | No |
| POST | `/auth/otp/resend` | `phone, purpose` | Re-trigger send, respects rate limit | No |
| POST | `/auth/refresh` | `refreshToken` | Rotate + reissue pair | No (refresh token itself is the credential) |
| POST | `/auth/logout` | `refreshToken` | Revoke that token | Yes |
| POST | `/auth/logout-all` | — | Revoke all refresh tokens for user (e.g. "log out of all devices") | Yes |
| POST | `/auth/google` | `idToken, accountType?` | Verify with Google, find-or-create user, may return `needsPhoneVerification: true` | No |
| GET | `/auth/me` | — | Return current user, `driverStatus` (no row = `'none'`), `role`, and `activeRole` as the effective role (see §2.7) | Yes |
| PATCH | `/auth/active-role` | `role` | Set active role (`rider`/`driver`), only allowed if `role==='rider'` or driver is approved | Yes |
| POST | `/driver/onboarding/personal-info` | step 1 fields | Create the `driver_profiles` row if none exists (upsert on `user_id`, `status='none'`), then save step 1. This is the only place the row is created. | Yes |
| POST | `/driver/onboarding/vehicle-info` | step 2 fields | Save step 2 | Yes |
| POST | `/driver/onboarding/documents` | multipart upload | Save step 3, upload to S3/Cloudinary | Yes |
| POST | `/driver/onboarding/submit` | — | Set `status='pending'`, `submitted_at=now()` | Yes |
| GET | `/driver/application/status` | — | Return current status + rejection reason if any | Yes |

### 2.6 Middleware (`auth.middleware.js`)

```js
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'missing_token' });
  try {
    const payload = jwt.verifyAccessToken(header.split(' ')[1]);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }
}

function requireApprovedDriver(req, res, next) {
  // fetch driver_profiles for req.userId, check status === 'approved'
  // 403 with { error: 'driver_not_approved' } if not
}
```

### 2.7 Role helpers (`auth.service.js`)

```js
async function getDriverStatus(userId, client) {
  const { rows } = await client.query(
    'SELECT status FROM driver_profiles WHERE user_id = $1', [userId]
  );
  return rows[0]?.status ?? 'none'; // no row = never applied = 'none'
}

// PATCH /auth/active-role handler
async function switchActiveRole(userId, requestedRole, client) {
  if (requestedRole === 'rider') {
    await client.query(`UPDATE users SET active_role = 'rider' WHERE id = $1`, [userId]);
    return { activeRole: 'rider' };
  }

  if (requestedRole === 'driver') {
    const status = await getDriverStatus(userId, client);
    if (status !== 'approved') {
      throw new ApiError(403, 'driver_not_approved', { driverStatus: status });
      // frontend catches this and redirects to DriverOnboarding or ApplicationStatus
      // depending on the returned driverStatus
    }
    await client.query(`UPDATE users SET active_role = 'driver' WHERE id = $1`, [userId]);
    return { activeRole: 'driver' };
  }

  throw new ApiError(400, 'invalid_role');
}

function requireStaffRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'insufficient_permissions' });
    }
    next();
  };
}
// usage: router.get('/admin/drivers/pending', requireAuth, requireStaffRole('admin', 'super_admin'), ...)
```

**Rule: `active_role` is a UI preference, never authorization.**

- Every driver-only route (accept trip, go online, earnings) must be guarded by `requireApprovedDriver`, which checks `driver_profiles.status = 'approved'`. Never gate on `active_role === 'driver'`, because a driver suspended while in driver mode would keep access.
- `/auth/me` returns the **effective** role, computed per request:

```js
function effectiveRole(user, driverStatus) {
  return user.active_role === 'driver' && driverStatus === 'approved' ? 'driver' : 'rider';
}
```

- If a driver's status changes away from `approved` (suspended, rejected after review), also reset `users.active_role` to `'rider'` in the same transaction that changes the status.

### 2.8 Google Sign-In (backend) — `google.service.js`

Use `google-auth-library` (official Google package, don't hand-roll JWT verification):

```js
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client();

async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: [
      process.env.GOOGLE_CLIENT_ID_IOS,
      process.env.GOOGLE_CLIENT_ID_ANDROID,
      process.env.GOOGLE_CLIENT_ID_WEB, // if you ever add a web client
    ],
  });
  return ticket.getPayload(); // { sub, email, name, picture, ... }
}
```

Controller logic for `POST /auth/google`:
1. Verify token → get `sub` (Google's stable user id), `email`, `name`, `picture`.
2. Look up `users` by `google_id = sub`. Found → issue token pair, done.
3. Not found by `google_id`, but `email` matches an existing user → link `google_id` to that row, issue tokens.
4. No match at all → create a `users` row with `email`, `google_id`, `full_name` from Google, `avatar_url`, but **`phone` is still null and `phone_verified_at` is null**. Return `{ needsPhoneVerification: true, tempUserId }` instead of full tokens — frontend routes this straight into the OTP screen to collect + verify a phone number before minting a full session.

---

## 3. Frontend Implementation (React Native / Expo)

### 3.1 Secure token storage

Use `expo-secure-store` — never AsyncStorage for tokens (AsyncStorage is unencrypted).

```js
// src/lib/secureTokenStore.js
import * as SecureStore from 'expo-secure-store';

export const tokenStore = {
  async setTokens({ accessToken, refreshToken }) {
    await SecureStore.setItemAsync('accessToken', accessToken);
    await SecureStore.setItemAsync('refreshToken', refreshToken);
  },
  async getAccessToken() { return SecureStore.getItemAsync('accessToken'); },
  async getRefreshToken() { return SecureStore.getItemAsync('refreshToken'); },
  async clear() {
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
  },
};
```

### 3.2 Axios client with auto-refresh interceptor

```js
// src/lib/apiClient.js
import axios from 'axios';
import { tokenStore } from './secureTokenStore';

const api = axios.create({ baseURL: process.env.EXPO_PUBLIC_API_URL });

api.interceptors.request.use(async (config) => {
  const token = await tokenStore.getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let isRefreshing = false;
let queue = [];

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { config, response } = error;
    if (response?.status === 401 && !config._retry) {
      config._retry = true;
      if (isRefreshing) {
        return new Promise((resolve) => queue.push(() => resolve(api(config))));
      }
      isRefreshing = true;
      try {
        const refreshToken = await tokenStore.getRefreshToken();
        const { data } = await axios.post(`${process.env.EXPO_PUBLIC_API_URL}/auth/refresh`, { refreshToken });
        await tokenStore.setTokens(data);
        queue.forEach((cb) => cb());
        queue = [];
        return api(config);
      } catch (refreshError) {
        await tokenStore.clear();
        // trigger navigation to login via a navigation ref or event emitter
        throw refreshError;
      } finally {
        isRefreshing = false;
      }
    }
    throw error;
  }
);

export default api;
```

### 3.3 Zustand auth store

```js
// src/store/authStore.js
import { create } from 'zustand';
import api from '../lib/apiClient';
import { tokenStore } from '../lib/secureTokenStore';

export const useAuthStore = create((set) => ({
  user: null,
  activeRole: null,          // 'rider' | 'driver'
  driverStatus: 'none',      // 'none' | 'pending' | 'approved' | 'rejected'
  isAuthenticated: false,
  isLoading: true,

  hydrate: async () => {
    const token = await tokenStore.getAccessToken();
    if (!token) return set({ isLoading: false });
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data.user, activeRole: data.activeRole, driverStatus: data.driverStatus, isAuthenticated: true, isLoading: false });
    } catch {
      await tokenStore.clear();
      set({ isLoading: false });
    }
  },

  loginVerify: async (phone, code) => {
    const { data } = await api.post('/auth/login/verify', { phone, code });
    await tokenStore.setTokens(data.tokens);
    set({ user: data.user, activeRole: data.activeRole, driverStatus: data.driverStatus, isAuthenticated: true });
  },

  logout: async () => {
    const refreshToken = await tokenStore.getRefreshToken();
    await api.post('/auth/logout', { refreshToken });
    await tokenStore.clear();
    set({ user: null, isAuthenticated: false });
  },

  switchRole: async (role) => {
    const { data } = await api.patch('/auth/active-role', { role });
    set({ activeRole: data.activeRole });
  },
}));
```

### 3.4 Screens (map to the UI flow you specified)

| Screen | Component | Key behavior |
|---|---|---|
| Registration | `RegistrationScreen.jsx` | Form → `POST /auth/register/initiate` → navigate to OTP screen, pass `{ phone, purpose: 'registration', accountType }` as nav params |
| OTP Verification | `OtpVerificationScreen.jsx` | 6-digit input (auto-advance boxes), countdown timer (60s) before "Resend" enables, calls `/auth/register/verify` or `/auth/login/verify` depending on nav param `mode` |
| Login | `LoginScreen.jsx` | Phone input → `POST /auth/login/initiate` → OTP screen with `mode: 'login'` |
| Driver Onboarding | `DriverOnboardingScreen.jsx` | Multi-step wizard (local state for step index 1–4), each "Next" calls the matching step endpoint so partial progress is saved server-side, not just in memory |
| Driver Application Status | `ApplicationStatusScreen.jsx` | Polls or receives push/socket event on status change; shows pending/approved/rejected states with next-step CTA |
| Role Switch | inside `ProfileScreen.jsx` | Toggle control, disabled with tooltip if `driverStatus !== 'approved'` and role is 'driver' |

Conditional navigation logic (post-OTP-verify): read `accountType` from the verify response — `rider` → `RiderHomeScreen`; `driver` → check `driverStatus`; `'none'` → `DriverOnboardingScreen`, `'pending'`/`'rejected'` → `ApplicationStatusScreen`, `'approved'` → `DriverDashboardScreen`.

### 3.5 Google Sign-In (frontend)

Use `@react-native-google-signin/google-signin` (works cleanly with Expo via a dev client/EAS build — the Expo Go sandbox does **not** support native Google Sign-In, flag this to Dunsin before building).

```js
import { GoogleSignin } from '@react-native-google-signin/google-signin';

GoogleSignin.configure({
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, // required even on native for idToken
});

async function handleGoogleSignIn() {
  await GoogleSignin.hasPlayServices();
  const { idToken } = await GoogleSignin.signIn();
  const { data } = await api.post('/auth/google', { idToken });
  if (data.needsPhoneVerification) {
    navigation.navigate('OtpVerification', { mode: 'google-link', tempUserId: data.tempUserId });
  } else {
    await tokenStore.setTokens(data.tokens);
    // set auth store state, navigate to home
  }
}
```

---

## 4. Security Checklist (non-negotiable)

- [ ] OTP codes are hashed at rest, never logged in plaintext (check your logger doesn't dump request bodies in production)
- [ ] OTP rate limiting enforced in Redis, not just the DB `attempts` column
- [ ] Refresh tokens stored as hashes only; raw token never persisted
- [ ] Refresh token reuse triggers full session revocation for that user (see §2.4)
- [ ] Access tokens are short-lived (15 min) — this is what makes theft low-impact
- [ ] Phone numbers normalized to E.164 (`+234...`) before any DB write or lookup, so `08012345678` and `+2348012345678` aren't treated as different users
- [ ] Google `idToken` audience is validated against your actual client IDs (§2.8) — don't skip the `audience` check, it's what stops a token from another app being accepted
- [ ] All auth endpoints are HTTPS-only in production
- [ ] `requireApprovedDriver` middleware guards every driver-only route (trip acceptance, earnings, etc.) — role switching alone must never be sufficient to unlock driver actions
- [ ] Document uploads (license, insurance) go to private storage (S3 private bucket / Cloudinary with signed URLs), never public buckets
- [ ] `role` (`admin` / `super_admin`) is never set through a public endpoint; rows are seeded manually or via an invite gated by an existing `super_admin`
- [ ] **Before any admin dashboard ships:** admin accounts must not rely on phone OTP alone (SIM-swap risk). Require a second factor (TOTP authenticator app) or a separate email + password login with 2FA, and keep admin routes behind `requireAuth` + `requireStaffRole('admin', 'super_admin')`. Phone OTP only is acceptable during local development and MVP testing.

---

## 5. Environment Variables (add to `.env.example`)

```
JWT_ACCESS_SECRET=
JWT_ACCESS_EXPIRY=15m
REFRESH_TOKEN_EXPIRY_DAYS=30

TERMII_API_KEY=
TERMII_SENDER_ID=

GOOGLE_CLIENT_ID_IOS=
GOOGLE_CLIENT_ID_ANDROID=
GOOGLE_CLIENT_ID_WEB=

OTP_RATE_LIMIT_MAX=3
OTP_RATE_LIMIT_WINDOW_MINUTES=15
OTP_RESEND_COOLDOWN_SECONDS=60
```

---

## 6. Build Order (execute in this sequence)

1. **DB migrations** — `users` (or alter existing), `driver_profiles`, `otp_codes`, `refresh_tokens`. Drop any leftover `password_hash` column.
2. **OTP service + Termii provider** — build and test in isolation (log the code to console in dev mode instead of actually sending, behind `NODE_ENV=development`).
3. **JWT + refresh token service** — sign/verify/rotate functions, unit-testable without HTTP.
4. **Registration endpoints** (`/auth/register/initiate`, `/auth/register/verify`) — get one full signup working end-to-end via Postman/curl before touching frontend.
5. **Login endpoints** (`/auth/login/initiate`, `/auth/login/verify`) + **refresh/logout endpoints**.
6. **`requireAuth` middleware** + `/auth/me` — confirm token verification works.
7. **Google Sign-In backend** (`/auth/google`) — test with a real Google account via Postman using a token from the OAuth Playground before wiring the frontend.
8. **Driver onboarding endpoints** + `requireApprovedDriver` middleware.
9. **Role-switch endpoint**.
10. **Frontend: secure token store + axios client + Zustand auth store** — build and test the refresh-rotation flow with a deliberately short-lived access token (e.g. 30 seconds in dev) to confirm silent refresh works.
11. **Frontend screens**: Registration → OTP → Login → Driver Onboarding wizard → Application Status → Role switch in Profile.
12. **Frontend: Google Sign-In button + flow**, including the `needsPhoneVerification` branch into the OTP screen.
13. **End-to-end pass**: rider signup, driver signup + onboarding + (manually flip status to approved in DB) + role switch, Google signup (new user) → phone verification → home, Google login (existing user) → home, token refresh under expiry, logout, refresh-token-reuse triggers full logout.

---

## 7. What's explicitly out of scope for this pass (flag as Future)

- Admin dashboard for approving/rejecting driver applications (for now, flip `status` directly in DB or via a simple internal script)
- Multi-factor auth beyond OTP
- Social login providers other than Google (Apple Sign-In will be required by App Store if you ship on iOS with Google login present — flag this to Dunsin as a near-term follow-up, not this pass)
- Device/session management UI ("see all logged-in devices")

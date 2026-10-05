# Feature: Auth

## What it does
Signup/login for both riders and drivers (single users table, role field).
JWT access + refresh tokens.

## Key files
- Backend: /src/modules/auth/*
- Frontend: /src/screens/auth/*, /src/store/authStore.js

## How it works
1. Signup: name, phone, password, role (default rider) -> bcrypt hash -> user row created
2. Login: verify phone + bcrypt.compare -> issue JWT (7d expiry)
3. Protected routes use requireAuth middleware, reads Bearer token

## Edge cases / open questions
- OTP verification flow (otp_verifications table exists, wire-up pending)
- Refresh token rotation not yet implemented
- Role switching UX (rider <-> driver) — where does this live in the app?

## Status
- [x] Signup
- [x] Login
- [ ] OTP verification
- [ ] Refresh token flow
- [ ] Role switch UI

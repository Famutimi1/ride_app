# Database Schema

Source of truth: PostgreSQL. Keep this file in sync with actual migrations —
update it in the same PR that changes the schema.

## Tables
- `users`
- `driver_profiles`
- `vehicles`
- `trips`
- `payments`
- `ratings`
- `otp_verifications`
- `wallet_transactions`

## Full SQL
> Paste current CREATE TABLE statements here as they're finalized. Keep this file
> as the readable reference; actual migrations live in `/migrations` (backend repo).

## Conventions
- All money fields go through `wallet_transactions` (append-only, see `wallet-ledger.md`)
- Foreign keys reference `users(id)` — one users table for both riders and drivers
- Parameterized queries only, no exceptions

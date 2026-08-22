# Wallet / Ledger Design

## Core rule
`wallet_transactions` is append-only. Never UPDATE or DELETE a row. Corrections are
new offsetting rows.

## Why
Full audit trail, no silent data loss, matches how real financial ledgers work.

## Concurrency
Balance changes and withdrawal processing use `SELECT ... FOR UPDATE` inside an
explicit transaction — this is a database-level lock, not an application-level one.
`await` alone does not prevent race conditions between concurrent requests.

## Withdrawal flow
1. Driver requests withdrawal → row created as `pending`
2. Provider (Paystack/Flutterwave) webhook resolves final status
3. Cron reconciliation job checks anything stuck `pending` past a threshold by
   querying the provider's transfer-status API directly (don't rely on webhooks alone)

## Schema
See `database-schema.md` for the `wallet_transactions` table definition once finalized.

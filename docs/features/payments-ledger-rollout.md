# Payments and wallet rollout

The MVP payment implementation is in `backend/src/modules/payments` and `mobile/src/screens/shared/WalletSections.tsx`. Migration `003_payments_ledger.sql` creates the append-only double-entry ledger and payment tables. The existing single-entry wallet writes are retired; the migration posts opening balances and verifies them against the old totals before disabling the old write path. See `payments-ledger-gap-report.md` for the starting state.

## Before using Paystack

1. Set `PAYSTACK_SECRET_KEY` and `PAYMENT_SYNTHETIC_EMAIL_DOMAIN` in the **backend** environment. Never use the mobile environment for the secret key. The synthetic domain is needed for phone-only users when initializing Paystack checkout.
2. Point the Paystack webhook to `https://<backend-host>/webhooks/paystack`. It requires the raw-body HMAC signature. Keep `PAYSTACK_BASE_URL=https://api.paystack.co`.
3. Confirm that the Paystack account can initiate Transfers, that API transfer OTP is disabled, and that the Paystack balance has funds for requested payouts and estimated transfer fees.
4. Review `payment_settings` in the database before live use: top-up limits, withdrawal limits and fee, cash-debt limit, payout-account cooldown, and transfer-fee tiers. The migration values are placeholders.
5. Set `ALERT_WEBHOOK_URL` for payment alerts and daily finance reports. Without it, alerts appear in server logs only. Check the platform's licence/partner arrangement for stored wallet value and commission tax treatment before live launch.
6. Run `npm run migrate` in `backend`, then start the backend with Redis and Postgres available. The payment workers and scheduled reconciliation jobs start with the server.

The rider wallet and driver earnings/payout screens use `/api/wallet`, `/api/payments`, `/api/payout-accounts`, and `/api/withdrawals`. Top-ups credit only after server-side Paystack verification. Wallet trips hold the fare in escrow; cancellation releases it, and completion splits it into driver earnings and commission. Cash trips create commission debt, which gates driver availability at the configured limit. Withdrawals debit earnings before the payout job and reverse with a new ledger transaction on failure.

## Validation and remaining external checks

Backend typecheck and integration tests, mobile typecheck and lint pass. The tests cover ledger balancing, overdraft protection, concurrent debits, opposite lock orders, immutability, webhook signature checks, trip hold/settle/release, and single-winner trip completion. The migration was applied to the configured development database and old-versus-new balance totals matched to the kobo. Local HTTP smoke checks confirmed authenticated wallet access and webhook signature rejection.

Paystack end-to-end checkout, signed delivery, and a test-mode bank transfer still require a backend test secret, a reachable webhook URL, and an enabled Paystack Transfers account. Do those checks before the staged live pilot; do not treat this local test pass as a completed live-money test.

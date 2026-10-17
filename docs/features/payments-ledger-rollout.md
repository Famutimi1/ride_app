# Payments and wallet rollout

The MVP payment implementation is in `backend/src/modules/payments` and `mobile/src/screens/shared/WalletSections.tsx`. Migration `003_payments_ledger.sql` creates the append-only double-entry ledger and payment tables. The existing single-entry wallet writes are retired; the migration posts opening balances and verifies them against the old totals before disabling the old write path. See `payments-ledger-gap-report.md` for the starting state.

## Before using Paystack

1. Set `PAYSTACK_SECRET_KEY` and `PAYMENT_SYNTHETIC_EMAIL_DOMAIN` in the **backend** environment. Never use the mobile environment for the secret key. The synthetic domain is needed for phone-only users when initializing Paystack checkout. Use an owned domain before live payments; `example.com` is suitable only for test mode.
2. Set `PAYMENT_CALLBACK_URL=https://<app-host>/account/top-up` in the backend environment so Paystack returns to the top-up page. The server adds the wallet or earnings target for each checkout, and the app uses the returned reference to verify the payment. If unset, Paystack uses its dashboard callback URL.
3. Point the Paystack webhook to `https://<backend-host>/webhooks/paystack`. It requires the raw-body HMAC signature. Keep `PAYSTACK_BASE_URL=https://api.paystack.co`.
4. Confirm that the Paystack account can initiate Transfers, that API transfer OTP is disabled, and that the Paystack balance has funds for requested payouts and estimated transfer fees.
5. Review `payment_settings` in the database before live use: top-up limits, withdrawal limits and fee, cash-debt limit, payout-account cooldown, and transfer-fee tiers. The migration values are placeholders.
6. Set `ALERT_WEBHOOK_URL` for payment alerts and daily finance reports. Without it, alerts appear in server logs only. Check the platform's licence/partner arrangement for stored wallet value and commission tax treatment before live launch.
7. Run `npm run migrate` in `backend`, then start the backend with Redis and Postgres available. The payment workers and scheduled reconciliation jobs start with the server.

The rider wallet and driver earnings/payout screens use `/api/wallet`, `/api/payments`, `/api/payout-accounts`, and `/api/withdrawals`. Top-ups credit only after server-side Paystack verification. Wallet trips hold the fare in escrow; cancellation releases it, and completion splits it into driver earnings and commission. Cash trips create commission debt, which gates driver availability at the configured limit. Withdrawals debit earnings before the payout job and reverse with a new ledger transaction on failure.

## Validation and remaining external checks

Backend typecheck and integration tests, mobile typecheck, and Expo public-config validation pass. The tests cover ledger balancing, overdraft protection, concurrent debits, opposite lock orders, immutability, webhook signature checks, trip hold/settle/release, single-winner trip completion, duplicate top-up confirmations, amount mismatch, duplicate payout outcomes, and reversal after success. The migration is applied to the configured development database. A Paystack test-key checkout initialization succeeded, the public webhook rejected an unsigned request, and a signed non-payment event was stored and processed once.

The 2026-10-05 quick tunnels expired the next day and caused authentication requests to fail because `mobile/.env` still pointed at the old backend hostname. Local development now uses `EXPO_PUBLIC_API_BASE_URL=http://localhost:4000` and `PAYMENT_CALLBACK_URL=http://localhost:8081/account/top-up`. The app rewrites the localhost backend URL to Metro's LAN host on a native device. For remote browser testing or a mobile Paystack return, use a current public HTTPS host and update the callback and Paystack test webhook URL. A named, stable tunnel or deployed host is needed for a repeatable test environment.

A ₦5,000 test-mode card top-up completed on 2026-10-05 and credited the wallet exactly once. An actual Paystack `charge.success` webhook and a test bank transfer still need verification; no webhook was recorded for that charge because the test dashboard was not pointed at the current backend tunnel. Transfers must be enabled before a payout can be verified. These checks, approved commercial limits, and live credentials remain prerequisites for a live pilot; the current checks do not establish live-money readiness.

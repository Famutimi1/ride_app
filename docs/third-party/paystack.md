# Third-Party: Paystack

## Why / how we use it
Primary payment provider. Card charges (rider) + transfers (driver payouts).
We never touch raw card data — Paystack handles PCI compliance.

## Integration points
- Charge: rider pays fare on trip completion
- Transfer: driver withdrawal from wallet balance
- Webhooks: resolve charge/transfer status asynchronously (see
  docs/architecture/wallet-ledger.md for the reconciliation-cron fallback)

## Integration approach (verified 2026-08-22)
**No maintained official Node SDK.** Paystack's official `@paystack` npm scope is
frontend-only (`@paystack/inline-js`, `@paystack/checkout-js`); the server-side
`@paystack/paystack-sdk` is stale (last published 2022). **Call the REST API
directly** — Node's built-in `fetch` is enough (no dependency); add `axios` only
if you want interceptors/retries.

- Base URL `https://api.paystack.co`, header `Authorization: Bearer <PAYSTACK_SECRET_KEY>`
- Initialize a charge: `POST /transaction/initialize` → returns `authorization_url` + `reference`
- Verify a charge: `GET /transaction/verify/:reference`
- **Webhook signature:** compute an **HMAC-SHA512** of the **raw** request body
  keyed with the secret key, and compare it to the `x-paystack-signature` header.
  You must therefore capture the raw body (e.g. `express.json({ verify })`).
  ⚠️ Confirm the exact scheme against paystack.com/docs/payments/webhooks — their
  docs sit behind Cloudflare, so this is from established knowledge, not a fresh read.
- Full stack plan: docs/setup/dependencies.md

## Keys
- PAYSTACK_SECRET_KEY — backend only, never exposed to client
- PAYSTACK_PUBLIC_KEY — used in client-side Paystack SDK/inline widget if applicable

## Webhook setup (fill in once configured)
- Webhook URL: TBD
- Events subscribed to: TBD (e.g. charge.success, transfer.success, transfer.failed)
- Signature verification: must verify x-paystack-signature header — document the
  verification code location once written

## Status
- [ ] Not yet integrated — deferred until core trip flow works (see CLAUDE.md build order)

## Links
- https://paystack.com/docs/

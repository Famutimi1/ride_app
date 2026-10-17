# Financial integration implementation and release evidence

Prepared 12 October 2026. This document records implemented controls and observed evidence; it does **not** authorize live money or certify a production deployment.

## Scope and owner decision

The shared backend owns payment/ledger/provider behavior for the mobile app and separate dashboard. Existing staff roles and booking-time commission remain unchanged. The owner explicitly selected keeping manual wallet credits, refunds, ledger adjustments and gateway sweeps disabled. No operational ledger rows, historical settlements or audit entries were changed by this verification. No new table, dependency or staff account was added.

`ENABLE_ADMIN_MONEY_ACTIONS=false` gates staff money routes. The new independent `ENABLE_LIVE_PAYMENTS=false` blocks live-key provider POSTs and live top-up/withdrawal initiation, including mobile callers. Existing-payment verification and incoming outcomes continue, so disabling new money movement does not strand already accepted obligations. Test-mode fixtures remain available. A production or live-key environment rejects a non-official Paystack API origin.

## Implemented controls

- Webhook signatures are checked over bounded raw bytes before parsing. Recognized events validate their reference and mode. Receipt is acknowledged only after a durable PostgreSQL insert. Duplicate receipts are idempotent and can retrigger failed queue processing. Redis failure leaves a recoverable received record. Unsupported events are acknowledged without processing; supported receipts store only required reference/mode/event evidence, excluding customer/card/bank payloads. Existing historical payloads were not deleted.
- Transfer notifications cause an independent provider lookup. Settlement matches reference, mode, currency, amount, recipient and transfer code. Competing verification is serialized by the withdrawal row lock. Success cannot be downgraded to failure; explicit provider reversal produces offsetting entries once. Contradictory terminal observations remain visible as exceptions.
- Pending/processing/queued/received/ongoing transfers preserve reservations. OTP/blocked statuses preserve funds with an explicit operator exception. Unknown/mismatched evidence or missing fee evidence cannot mark a withdrawal paid. Return of reserved funds works even after a driver's approval is withdrawn.
- Withdrawal reservation checks both ledger capacity and current available provider float, conservatively reserving all in-transit principal/estimated fees. Unavailable/insufficient provider float does not consume the OTP or reserve more earnings. Provider access restrictions are classified as service errors and remain explicit on the withdrawal; they do not authorize a success posting.
- Transfer initiation uses a cross-process database advisory lock. Attempts persist before the provider POST. After an uncertain attempt, an explicit transfer-not-found response is required before retrying the **same** reference. A timeout, rejected recipient, malformed provider response or dependency outage never grants retry authority. The initiating process reuses its database connection during verification, avoiding a nested pool checkout.
- Success posts the provider's actual `fee_charged`. If the verify response omits it, the adapter fetches that same transfer's details; it never silently assumes zero or reads a newly changed fee schedule. Request-time fee estimates are immutable request-ledger metadata used for capacity reservations only. Provider fee refunds following reversal require separate statement evidence and are not invented.
- Charge success matches reference/mode/NGN amount, safe fee and paid timestamp. Existing succeeded intents are idempotent. Uncertain initialization and abandoned intents can recover a later confirmed payment through provider verification/reconciliation. A success notification with a still-nonterminal provider result remains retryable rather than being marked processed.
- Recovery examines oldest eligible records in bounded batches and updates attempt timing. Failed retained webhook jobs can be retried; new queue IDs use a SHA-256 key to avoid punctuation collisions. Provider GET retries have an overall deadline; POSTs are never automatically retried by the transport. Safe error categories replace raw gateway messages.
- Provider balance without an explicit valid NGN observation is an error, never an invented zero. A balance GET remains an observation, not bank/ledger reconciliation or production sign-off.

## Automated evidence

`npm run verify` uses a fresh disposable database and separate Redis process, refuses live keys/production data and exercises the compiled backend. The added tests use fixture HTTP responses and real PostgreSQL transactions, not live bank transfers.

Coverage includes signed webhook receipt, malformed/incorrect mode/signature rejection, private-payload minimization, unknown references, missed-worker/charge recovery, duplicate postings, reordered success/failure notifications, verified amount/recipient/mode/fee mismatch, pending/OTP retention, concurrent initiation, uncertain POST outcome, provider outage, same-reference retry after explicit not-found, reversal after suspension, terminal conflicts, real fee fetching, redacted proxy errors and the live-write gate. **Final result: 104 backend tests passed with zero failures/skips, backend build/application/script typechecks passed. Dashboard verification passed its production build/typecheck, nine tests and isolated session/API smoke suite.** Local final logs are `/tmp/rakky-finance-verified-final.log` and `/tmp/rakky-finance-dashboard-verify.log`.

## Existing local database investigation

Read-only checks on 12 October 2026 found 28 payment intents: 12 succeeded, 14 failed and 2 abandoned; zero withdrawals. These are observations of the local test setup, not production volumes.

All **12 succeeded intents** were independently verified using the actual Paystack test API. Each returned success in test mode, matched its stored amount and fee, and had a ledger transaction link. A separate read-only SQL check matched all 12 linked postings to their intent owner/gross credit, gateway net debit and fee expense. This demonstrates stored charge/provider agreement; it does not demonstrate external charge webhooks. The two historical webhook receipts were `test.rakkyride`, ignored, received on 5 October; neither proves charge or transfer webhook delivery.

The two cash-trip exceptions are:

- `df11c6c7-9f2b-420a-afd9-f4b951191af6`: completed 3 October at 17:19 WAT; fare 787000 kobo, commission 118050 kobo.
- `b1df5178-cabf-474e-b29c-e2930bd548f1`: completed 3 October at 18:18 WAT; fare 772600 kobo, commission 115890 kobo.

Both completed **before migration 003**, recorded at 21:42 WAT that day. Both have a legacy driver commission debit and equal platform commission credit. Their combined driver debt is **233940 kobo**, matching the observed legacy opening adjustment's negative legacy balance. They remain `payment_status=unpaid` with no modern trip settlement link. They are not zero-commission trips.

Disposition: **legacy commission evidence exists; migration/accounting review required**. Do not run ordinary settlement again: that could debit already carried driver debt a second time. The dashboard exception queue now exposes `legacy_cash_commission_entries`; missing modern settlement evidence remains visible and automated wallet-credit refunds stay ineligible. The opening adjustment is not a fabricated trip posting or proof of cash collection. A finance owner must approve any historical classification/accounting correction, including the platform revenue counterpart, with append-only evidence. No such correction was applied.

## External test workflow

Paystack's available legacy dashboard shows business `rackyriders` in test mode. The new dashboard reports access restricted to live/compliant businesses. Existing test callback/webhook settings use old temporary Cloudflare URLs that were unreachable during this check. Live compliance/permissions were not changed.

The owner approved using the installed Cloudflare tool to expose an **isolated disposable test backend**, with normal API authentication and signed webhook validation. A separate action-time confirmation is required before saving the exact test webhook destination in Paystack. Never run this against the operational database.

To reproduce an explicitly authorized run:

1. Build the backend. With actual `sk_test_` credentials in the private local environment and a local test DB administrator, run `RAKKY_ALLOW_EXTERNAL_TEST=true node_modules/.bin/tsx scripts/paystack-e2e.ts` in an interactive terminal. The script creates/drops its own generated database, starts separate Redis/backend processes and an installed Cloudflare HTTP/2 tunnel. It refuses production/live/fixture keys. It does not expose staff credentials.
2. Verify the emitted public readiness endpoint, obtain approval to temporarily save the exact test webhook URL, and record the original setting before changing it. Do not modify keys, IP whitelists, compliance or transfer OTP protections for convenience.
3. Send `checkout` to initialize one 500000-kobo TEST earnings top-up for a synthetic fixture. Complete it only on Paystack's hosted test checkout using documented test data. Card details never pass through Rakky's backend.
4. Send `evidence` to verify an actual durable `charge.success` receipt, processed status, exactly one linked top-up and a balanced ledger. A provider verify call alone cannot satisfy this.
5. Send `transfer` once to use Paystack's documented test bank fixture and the ordinary withdrawal service/queue. Capture the provider transfer record and any actual `transfer.success` webhook. Send `evidence` again to compare fees, balances, reservation and terminal ledger links. Test-mode commands cannot use real funds.
6. Restore the original Paystack test setting, then send `stop`; verify the temporary tunnel/backend/Redis and generated DB are gone. The runner expires after 30 minutes. Capture sanitized evidence before cleanup; temporary evidence files are removed. It is not permanent hosting.

Paystack documents that test transfers always return success and settlements are not processed as live settlements in test mode. Pending, failure, reversal and uncertainty therefore have controlled integration-test evidence; do not falsely claim that a test success exercised a real bank failure/reversal. See [single transfers](https://paystack.com/docs/transfers/single-transfers/), [test payments](https://paystack.com/docs/payments/test-payments/), [webhooks](https://paystack.com/docs/payments/webhooks/) and [authentication/environments](https://paystack.com/docs/api/authentication/).

## Captured external results

The exact replacement test webhook was explicitly approved and temporarily saved in the Paystack browser. Public readiness returned 200. The original test webhook was restored and the temporary tunnel/backend/Redis/database were removed afterward; keys, whitelist, compliance, 2FA and transfer OTP settings were untouched. The original URL remains unsuitable for production because it is an old unreachable temporary address.

- **Real hosted TEST charge:** built-in Paystack success simulation, 500000 kobo; reference `tu_7848225fbb494e9e919bc1b7e8ffc547`, provider transaction `6651205424`. No real card data or funds were used. One earlier isolated initialization attempt failed because Paystack rejected the synthetic `.invalid` email; the reproducible harness now uses the reserved valid `example.com` domain.
- **Authentic webhook:** `charge.success` received at `2026-10-12T17:21:22.852Z` and processed at `17:21:24.039Z`. Paystack event `6acd1712e93b40a26ed665f4` independently reported `Delivered`, HTTP 200. Earnings credit 500000, verified fee expense 17500 and gateway net 482500 kobo; one top-up posting and no ledger-integrity problems.
- **Provider duplicate resend:** official resend API accepted two entries for that same event, HTTP 202, zero failed IDs. The subsequent provider delivery was `Delivered`, HTTP 200, updated `17:27:50Z`; the database still contained one receipt and one top-up. This evidence records provider resend/last-delivery observations, not an invented HTTP arrival counter.
- **Simulated missed webhook, actual charge verification:** a separate disposable database held the same authorized test reference as pending with **zero webhook receipts**. Running reconciliation twice against actual Paystack GET verification produced one succeeded top-up, the same 17500 fee and 482500 net gateway amount, zero integrity problems. That test DB was disposed. It deliberately simulates a missing notification; it is not a claim that Paystack lost the original delivery. Reproduce with `node_modules/.bin/tsx scripts/paystack-recovery-check.ts <authorized-test-reference>`; the helper refuses production/live keys and makes no provider POSTs.
- **Transfer gate failed at the provider:** a 100000-kobo test withdrawal to Paystack's documented test bank was reserved, but initiation returned HTTP 400, `transfer_unavailable`: “You cannot initiate third party payouts as a starter business.” An independent verify returned 404 `not_found`. A controlled diagnostic retried the identical reference only after that explicit not-found and returned the same restriction. No transfer-success event/final ledger posting exists; funds stayed reserved in the disposable fixture. **Successful external transfer verification is blocked until the owner completes Paystack's business/compliance process and obtains transfer eligibility.** No protection was disabled to bypass it.

Sanitized source observations are saved in [test evidence](paystack-test-evidence-2026-10-12.json). The shared test business retains its normal simulated charge/event history; only generated local fixtures were disposed. Its aggregate provider balance includes other test activity and cannot be reconciled solely against this isolated fixture's ledger. No live bank-statement reconciliation or live settlement was performed.

## Required production release gates still open

- Permanent staging/production HTTPS callback and webhook origins, deployed candidate, private secrets/data isolation and actual provider delivery/permissions. Temporary tunnel success is insufficient for production.
- Successful external transfer/provider receipt evidence after Paystack business approval; repeat charge verification on the deployed permanent host; controlled duplicate/replay and recovery evidence clearly distinguished from authentic provider delivery.
- Provider balance ledger/statement and bank-statement reconciliation, fee treatment, in-transit timing, settlement exceptions and named finance/incident owners. Test mode does not prove bank cash or live settlements.
- Owner-approved actual commercial values and scope/limits/step-up/independent approval rules before enabling any applicable money capability. Development placeholder settings are not commercial approval.
- Provider compliance/live access and owner-controlled rollout. Any consequential live payment or security-protection change requires its own authorization/handoff; no live-money operation was executed here.
- Production alerts and recovery drills, operational observation and explicit sign-off for the exact deployment. Keep manual money and new live provider mutations disabled until the relevant gates pass.

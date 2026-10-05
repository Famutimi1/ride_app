# Task Spec: Payments & Ledger (Wallet, Commission, Cash Debt, Top-ups, Payouts)

**Target:** AI coding agent (Cursor / Claude executing against this repo)
**Depends on:** `AGENTS.md`, the live auth system (`users`, `driver_profiles`, `role`, `requireAuth`, `requireStaffRole`, `otp.service`), the trip system (`trips`, `fare_config`, `transitionTrip`), BullMQ + Redis, and the existing payments scaffold (fare calculation, append-only wallet ledger, commission logic, `SELECT ... FOR UPDATE` locking, Paystack webhook handling, withdrawal reversal via offsetting rows, withdrawal reconciliation cron).

> **Rule zero for the agent:** read the existing wallet/ledger module first and write a short gap report before changing anything: table names, whether it is single-entry or double-entry, how balances are computed, how withdrawals and reversals are stored. This spec describes the **target design**. Where the existing code already satisfies a section, keep it and say so. Where it differs (most likely: single-entry wallet rows), follow the migration step in section 15, step 1. Never run two ledgers side by side.

---

## 0. Plain-English Mental Model (read this first)

- **A ledger is a notebook where nothing is ever erased.** You only add lines. A mistake is fixed by adding an opposite line, never by editing the old one.
- **Double-entry means every money movement has two sides that match.** When ₦2,000 leaves the rider's wallet, it must arrive somewhere (an escrow account). Total debits always equal total credits. If they don't, something is broken, and the database refuses the write.
- **A wallet balance is not money in a drawer. It is "what the platform owes this person."** That is why wallets are *liability* accounts. Real money sits at Paystack (an *asset*). The platform's own earnings (commission) are *revenue*.
- **Escrow = a locked box.** When a rider books a wallet trip, the fare moves into the locked box. On completion it is split between the driver and the platform. On cancellation it goes back to the rider.
- **Idempotency = "doing it twice has the same effect as doing it once."** Networks retry, webhooks repeat, users double-tap. Every money operation carries a unique key, so a repeat is recognised and ignored.
- **Two envelopes per person:** `wallet` (ride money, funded by top-ups and refunds) and `earnings` (driver income, funded by trips, can go negative for cash commission owed). Only `earnings` can be withdrawn.

---

## 1. Architecture Decisions (do not deviate without flagging)

1. **Double-entry, append-only ledger.** Three tables: `ledger_accounts`, `ledger_transactions`, `ledger_entries`. Entries are never updated or deleted, and Postgres triggers enforce that. Corrections are new, offsetting transactions.
2. **One writer.** The only code allowed to insert ledger rows is `ledger.service.postTransaction`. Grep for any other `INSERT INTO ledger_` and remove it.
3. **Money is `BIGINT` kobo.** No floats, no decimals, anywhere (DB, API, JS, React Native). API fields are suffixed `Kobo`. Only the UI formats to naira.
4. **Concurrency is solved in Postgres.** Accounts are locked with `SELECT ... FOR UPDATE` in a fixed order (sorted by id) inside the caller's transaction. `await` in JavaScript is not protection.
5. **Idempotency on every money operation** via `ledger_transactions.idempotency_key UNIQUE` with deterministic keys (section 5.2).
6. **Never hold a DB lock across a network call.** Order is always: (a) call Paystack, (b) open DB transaction, (c) post ledger rows. For payouts, post the ledger debit first, commit, then call Paystack from a job, and let reconciliation repair any gap.
7. **Never trust the client or a single webhook.** A top-up is credited only after the server verifies the charge with Paystack's verify endpoint and checks amount, currency and reference.
8. **Split accounts per user** (`user_wallet`, `driver_earnings`) so deposited rider money cannot be cashed out. This blocks top-up → withdraw laundering and limits chargeback exposure.
9. **Payment module exposes a service interface to the trip module.** The trip module never touches ledger tables. It calls `holdTripFare`, `releaseTripHold`, `settleTrip` inside its own transaction (section 7.2).
10. **Gateway behind an interface** (`PaymentGateway`) with a Paystack implementation, the same pattern as `OtpProvider`. Swapping providers later is one file.
11. **Commission lives in `fare_config.commission_bps`** (from the trip spec). The payment module reads it; it does not own a second commission setting.
12. **Platform absorbs Paystack top-up fees for MVP** (rider is credited the full amount they paid). The fee is recorded as an expense using the fee Paystack reports, never a locally computed guess.

---

## 2. Chart of Accounts

Each row is an account in `ledger_accounts`. `normal_side` is the side that *increases* the account. A balance is stored as the "natural" balance (credits minus debits for credit-normal accounts, the reverse for debit-normal).

| Code | Type | Normal side | Meaning | Can go negative? |
|---|---|---|---|---|
| `user_wallet:<userId>` | liability | credit | Platform owes the user ride money (top-ups, refunds) | No |
| `driver_earnings:<userId>` | liability | credit | Platform owes the driver trip earnings. **Negative = driver owes platform (cash commission)** | Yes, only for approved drivers, limited by `cash_debt_limit_kobo` |
| `escrow_trips` | liability | credit | Rider fares locked for in-flight wallet trips | No |
| `payout_in_transit` | liability | credit | Withdrawals sent to Paystack, not yet confirmed | No |
| `suspense` | liability | credit | Money received that cannot yet be matched to a user (investigate) | No |
| `gateway_balance` | asset | debit | Money held at Paystack (mirrors Paystack balance) | No |
| `bank_account` | asset | debit | Platform bank account (after manual sweeps) | No |
| `revenue_commission` | revenue | credit | Platform commission on trips | No |
| `revenue_fees` | revenue | credit | Withdrawal fees (and Future cancellation fees) | No |
| `expense_gateway_fees` | expense | debit | Paystack charges and transfer fees | No |
| `expense_refunds` | expense | debit | Platform-funded refunds and goodwill credits | No |
| `expense_adjustments` | expense | debit | Counter-account for admin corrections | Yes |

**The accounting identity that must always hold:** across all accounts, total debit entries = total credit entries. Checked nightly (section 9).

---

## 3. Worked Examples (amounts in naira for readability; the DB stores kobo = naira × 100)

**A. Rider tops up ₦5,000.** Paystack fee reported: ₦175 (1.5% + ₦100).

| Account | Debit | Credit |
|---|---|---|
| `gateway_balance` | 4,825 | |
| `expense_gateway_fees` | 175 | |
| `user_wallet:rider` | | 5,000 |

**B. Wallet trip, fare ₦2,000, commission 15% (₦300).**

Hold at request: `user_wallet:rider` Dr 2,000, `escrow_trips` Cr 2,000.
Settle at completion:

| Account | Debit | Credit |
|---|---|---|
| `escrow_trips` | 2,000 | |
| `driver_earnings:driver` | | 1,700 |
| `revenue_commission` | | 300 |

Cancel instead: `escrow_trips` Dr 2,000, `user_wallet:rider` Cr 2,000.

**C. Cash trip, fare ₦2,000.** Rider hands the driver ₦2,000 in person; no cash touches the books. The driver owes the commission:

| Account | Debit | Credit |
|---|---|---|
| `driver_earnings:driver` | 300 | |
| `revenue_commission` | | 300 |

If the driver's earnings were ₦0, they are now −₦300 (they owe the platform ₦300).

**D. Driver withdraws ₦10,000 (withdrawal fee ₦0).**

Request: `driver_earnings` Dr 10,000, `payout_in_transit` Cr 10,000.
Success: `payout_in_transit` Dr 10,000, `gateway_balance` Cr 10,000; then Paystack transfer fee ₦25: `expense_gateway_fees` Dr 25, `gateway_balance` Cr 25.
Failure / reversal: `payout_in_transit` Dr 10,000, `driver_earnings` Cr 10,000.

---

## 4. Database Schema

### 4.1 Ledger core

```sql
CREATE TYPE ledger_account_type AS ENUM ('asset','liability','revenue','expense');
CREATE TYPE entry_direction     AS ENUM ('debit','credit');
CREATE TYPE ledger_tx_type AS ENUM (
  'topup','trip_hold','trip_hold_release','trip_settlement_wallet','trip_commission_cash',
  'withdrawal_request','withdrawal_success','withdrawal_reversal','withdrawal_fee_expense',
  'refund','adjustment','gateway_sweep','chargeback',
  'cancellation_fee','promo_credit','tip'            -- last three are Future; keep in the enum now
);

CREATE TABLE ledger_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(80) UNIQUE NOT NULL,
  kind           VARCHAR(20) NOT NULL,              -- 'user_wallet' | 'driver_earnings' | 'system'
  type           ledger_account_type NOT NULL,
  normal_side    entry_direction NOT NULL,
  owner_user_id  UUID REFERENCES users(id),         -- null for system accounts
  currency       CHAR(3) NOT NULL DEFAULT 'NGN',
  balance_kobo   BIGINT NOT NULL DEFAULT 0,         -- cached natural balance, updated only by postTransaction
  allow_negative BOOLEAN NOT NULL DEFAULT false,
  is_frozen      BOOLEAN NOT NULL DEFAULT false,    -- blocks debits (fraud / dispute)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (allow_negative OR balance_kobo >= 0)       -- last line of defence against overdrafts
);
CREATE UNIQUE INDEX one_wallet_per_user   ON ledger_accounts(owner_user_id) WHERE kind = 'user_wallet';
CREATE UNIQUE INDEX one_earnings_per_user ON ledger_accounts(owner_user_id) WHERE kind = 'driver_earnings';

CREATE TABLE ledger_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             ledger_tx_type NOT NULL,
  idempotency_key  VARCHAR(160) UNIQUE NOT NULL,
  request_hash     CHAR(64) NOT NULL,               -- sha256 of canonical entries; detects key reuse with different data
  reference_type   VARCHAR(30),                     -- 'trip' | 'payment_intent' | 'withdrawal' | 'admin'
  reference_id     UUID,
  description      VARCHAR(200),
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_by       UUID REFERENCES users(id),       -- null = system
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ltx_reference ON ledger_transactions(reference_type, reference_id);

CREATE TABLE ledger_entries (
  id                  BIGSERIAL PRIMARY KEY,
  transaction_id      UUID NOT NULL REFERENCES ledger_transactions(id),
  account_id          UUID NOT NULL REFERENCES ledger_accounts(id),
  direction           entry_direction NOT NULL,
  amount_kobo         BIGINT NOT NULL CHECK (amount_kobo > 0),
  balance_after_kobo  BIGINT NOT NULL,              -- natural balance of the account after this entry
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_le_account_time ON ledger_entries(account_id, id DESC);
CREATE INDEX idx_le_tx ON ledger_entries(transaction_id);
```

### 4.2 Database-enforced integrity (non-negotiable)

```sql
-- 1. Ledger rows can never be changed or removed.
CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'ledger tables are append-only'; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER no_mutate_entries BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE TRIGGER no_mutate_transactions BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

-- 2. Every transaction must balance, checked at COMMIT time.
CREATE FUNCTION assert_tx_balanced() RETURNS trigger AS $$
DECLARE d BIGINT; c BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE direction = 'debit'), 0),
         COALESCE(SUM(amount_kobo) FILTER (WHERE direction = 'credit'), 0)
    INTO d, c FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF d <> c THEN RAISE EXCEPTION 'unbalanced ledger transaction %: debit % credit %', NEW.transaction_id, d, c; END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_tx_balanced
  AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_tx_balanced();
```

Seed all system accounts from section 2 in the migration (fixed codes, no owner).

### 4.3 Payment tables

```sql
CREATE TYPE intent_status AS ENUM ('pending','succeeded','failed','abandoned','mismatch');

CREATE TABLE payment_intents (                      -- every top-up attempt
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id),
  target               VARCHAR(10) NOT NULL CHECK (target IN ('wallet','earnings')),
  amount_kobo          BIGINT NOT NULL CHECK (amount_kobo > 0),
  status               intent_status NOT NULL DEFAULT 'pending',
  provider             VARCHAR(20) NOT NULL DEFAULT 'paystack',
  provider_reference   VARCHAR(80) UNIQUE NOT NULL,
  authorization_url    TEXT,
  access_code          VARCHAR(80),
  channel              VARCHAR(30),
  fee_kobo             BIGINT,                      -- as reported by Paystack
  paid_at              TIMESTAMPTZ,
  ledger_transaction_id UUID REFERENCES ledger_transactions(id),
  failure_reason       VARCHAR(200),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_intents_user ON payment_intents(user_id, created_at DESC);
CREATE INDEX idx_intents_pending ON payment_intents(status, created_at) WHERE status = 'pending';

CREATE TABLE payout_accounts (                      -- driver bank accounts (no full account number stored)
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  bank_code       VARCHAR(10) NOT NULL,
  bank_name       VARCHAR(80) NOT NULL,
  account_last4   CHAR(4) NOT NULL,
  account_name    VARCHAR(120) NOT NULL,            -- as resolved by the bank
  recipient_code  VARCHAR(40) NOT NULL,             -- Paystack transfer recipient
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, recipient_code)
);

CREATE TYPE withdrawal_status AS ENUM ('pending','processing','success','failed','reversed');

CREATE TABLE withdrawals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id),
  payout_account_id     UUID NOT NULL REFERENCES payout_accounts(id),
  amount_kobo           BIGINT NOT NULL CHECK (amount_kobo > 0),
  fee_kobo              BIGINT NOT NULL DEFAULT 0,  -- fee charged to the driver
  status                withdrawal_status NOT NULL DEFAULT 'pending',
  provider_reference    VARCHAR(50) UNIQUE NOT NULL,-- sent to Paystack as the transfer reference
  provider_transfer_code VARCHAR(40),
  attempts              INT NOT NULL DEFAULT 0,
  failure_reason        VARCHAR(200),
  request_tx_id         UUID REFERENCES ledger_transactions(id),
  final_tx_id           UUID REFERENCES ledger_transactions(id),
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Only one in-flight withdrawal per user.
CREATE UNIQUE INDEX one_inflight_withdrawal ON withdrawals(user_id) WHERE status IN ('pending','processing');
CREATE INDEX idx_withdrawals_user ON withdrawals(user_id, requested_at DESC);

CREATE TABLE payment_webhook_events (
  id            BIGSERIAL PRIMARY KEY,
  provider      VARCHAR(20) NOT NULL,
  dedupe_key    VARCHAR(160) NOT NULL,              -- `${event}:${data.reference ?? data.transfer_code ?? data.id}`
  event_type    VARCHAR(60) NOT NULL,
  payload       JSONB NOT NULL,
  status        VARCHAR(15) NOT NULL DEFAULT 'received',  -- received | processed | failed | ignored
  error         TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  UNIQUE (provider, dedupe_key)
);

CREATE TABLE payment_settings (                     -- business tunables, editable by super_admin; single row
  id                              BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  min_topup_kobo                  BIGINT NOT NULL,
  max_topup_kobo                  BIGINT NOT NULL,
  min_withdrawal_kobo             BIGINT NOT NULL,
  max_daily_withdrawal_kobo       BIGINT NOT NULL,
  withdrawal_fee_kobo             BIGINT NOT NULL DEFAULT 0,
  cash_debt_limit_kobo            BIGINT NOT NULL,
  payout_name_match               VARCHAR(10) NOT NULL DEFAULT 'lenient',   -- strict | lenient | off
  new_payout_account_cooldown_hours INT NOT NULL DEFAULT 0,                 -- recommend 24 in production
  paystack_balance_alert_kobo     BIGINT NOT NULL,
  admin_adjustment_approval_kobo  BIGINT NOT NULL,   -- adjustments above this need super_admin
  transfer_fee_tiers              JSONB NOT NULL     -- e.g. [{"maxKobo":500000,"feeKobo":1000},{"maxKobo":5000000,"feeKobo":2500},{"maxKobo":null,"feeKobo":5000}]
);
```

Seed `payment_settings` with clearly labelled placeholder values and ask Dunsin for the real ones. The transfer fee tiers above reflect Paystack's published Nigeria transfer fees (₦10 up to ₦5,000; ₦25 from ₦5,001 to ₦50,000; ₦50 above) at the time of writing. They are data, so they can change without a deploy.

### 4.4 Changes to existing tables

```sql
ALTER TABLE trips ADD COLUMN payment_status VARCHAR(10) NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid','held','settled','released'));
ALTER TABLE trips ADD COLUMN hold_tx_id   UUID REFERENCES ledger_transactions(id);
ALTER TABLE trips ADD COLUMN settle_tx_id UUID REFERENCES ledger_transactions(id);

ALTER TYPE otp_purpose ADD VALUE IF NOT EXISTS 'withdrawal';
ALTER TYPE otp_purpose ADD VALUE IF NOT EXISTS 'payout_account';
```

---

## 5. Ledger Service (`src/modules/payments/ledger.service.js`)

### 5.1 `postTransaction`

```js
// pg returns BIGINT as strings. Parse once at startup. Safe because kobo values stay far below 2^53.
require('pg').types.setTypeParser(20, (v) => Number(v));

async function postTransaction(client, tx) {
  const { type, idempotencyKey, referenceType = null, referenceId = null,
          description = null, metadata = {}, createdBy = null, entries } = tx;

  // --- validate (no DB yet) ---
  if (!Array.isArray(entries) || entries.length < 2) throw new LedgerError('too_few_entries');
  let debit = 0, credit = 0;
  for (const e of entries) {
    if (!Number.isSafeInteger(e.amountKobo) || e.amountKobo <= 0) throw new LedgerError('bad_amount');
    if (e.direction === 'debit') debit += e.amountKobo;
    else if (e.direction === 'credit') credit += e.amountKobo;
    else throw new LedgerError('bad_direction');
  }
  if (debit !== credit) throw new LedgerError('unbalanced', { debit, credit });

  // --- idempotency: first writer wins, repeats are recognised ---
  const hash = sha256(JSON.stringify(entries.map(e => [e.accountId, e.direction, e.amountKobo])));
  const ins = await client.query(
    `INSERT INTO ledger_transactions
       (type, idempotency_key, request_hash, reference_type, reference_id, description, metadata, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [type, idempotencyKey, hash, referenceType, referenceId, description, metadata, createdBy]);

  if (ins.rowCount === 0) {
    const { rows: [prev] } = await client.query(
      `SELECT id, request_hash FROM ledger_transactions WHERE idempotency_key = $1`, [idempotencyKey]);
    if (prev.request_hash !== hash) throw new LedgerError('idempotency_key_reused_with_different_data');
    return { transactionId: prev.id, replayed: true };
  }
  const transactionId = ins.rows[0].id;

  // --- lock every touched account in a fixed order (sorted ids => no deadlocks) ---
  const ids = [...new Set(entries.map(e => e.accountId))].sort();
  const { rows } = await client.query(
    `SELECT id, normal_side, balance_kobo, allow_negative, is_frozen
       FROM ledger_accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [ids]);
  const accounts = new Map(rows.map(r => [r.id, { ...r, balance: r.balance_kobo }]));

  // --- apply entries in order ---
  for (const e of entries) {
    const acct = accounts.get(e.accountId);
    if (!acct) throw new LedgerError('unknown_account');
    const delta = e.direction === acct.normal_side ? e.amountKobo : -e.amountKobo;
    if (delta < 0 && acct.is_frozen) throw new LedgerError('account_frozen');
    acct.balance += delta;
    if (acct.balance < 0 && !acct.allow_negative)
      throw new LedgerError('insufficient_funds', { accountId: e.accountId });
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_kobo, balance_after_kobo)
       VALUES ($1,$2,$3,$4,$5)`, [transactionId, e.accountId, e.direction, e.amountKobo, acct.balance]);
  }
  for (const a of accounts.values())
    await client.query(`UPDATE ledger_accounts SET balance_kobo = $2, updated_at = now() WHERE id = $1`, [a.id, a.balance]);

  return { transactionId, replayed: false };
}
```

Rules:
- `postTransaction` **never opens its own transaction**. It takes the caller's `client`, so a trip completion and its settlement commit or roll back together.
- `LedgerError('insufficient_funds')` maps to HTTP `402 insufficient_funds` at the edge.

### 5.2 Idempotency keys (deterministic, never random)

| Operation | Key |
|---|---|
| Top-up credit | `topup:{paymentIntentId}` |
| Trip hold | `trip:{tripId}:hold` |
| Trip hold release | `trip:{tripId}:release` |
| Trip settlement (wallet or cash) | `trip:{tripId}:settle` |
| Withdrawal request | `withdrawal:{id}:request` |
| Withdrawal success | `withdrawal:{id}:success` |
| Withdrawal transfer fee expense | `withdrawal:{id}:gateway_fee` |
| Withdrawal reversal | `withdrawal:{id}:reversal` |
| Refund | `refund:{tripId}:{adminRequestKey}` |
| Admin adjustment | `adjustment:{adminRequestKey}` (client-supplied UUID) |
| Gateway sweep | `sweep:{adminRequestKey}` |

### 5.3 Account helpers

- `getOrCreateWalletAccount(client, userId)` and `getOrCreateEarningsAccount(client, userId)`: `INSERT ... ON CONFLICT DO NOTHING`, then `SELECT`. Lazily created on first need, so auth is not coupled to payments.
- `driver_earnings` is created with `allow_negative = true` **only** for users with an approved `driver_profiles` row. Set it in the same transaction that approves the driver.
- `getBalances(userId)` returns `{ walletKobo, earningsKobo, withdrawableKobo: max(0, earnings), owedKobo: max(0, -earnings) }`.
- `getSystemAccountId(code)` caches system account ids in memory at startup.

---

## 6. Payment Gateway Abstraction

```js
// payments/gateway/PaymentGateway.js
class PaymentGateway {
  async initializeCharge({ email, amountKobo, reference, metadata, callbackUrl }) {}  // -> { authorizationUrl, accessCode }
  async verifyCharge(reference) {}                    // -> { status, amountKobo, currency, feeKobo, channel, paidAt }
  async listBanks() {}                                // cache in Redis 24h
  async resolveAccount({ accountNumber, bankCode }) {}// -> { accountName }
  async createRecipient({ name, accountNumber, bankCode }) {} // -> { recipientCode }
  async initiateTransfer({ amountKobo, recipientCode, reference, reason }) {}  // -> { status, transferCode }
  async verifyTransfer(reference) {}                  // -> { status, transferCode, failureReason }
  async getBalance() {}                               // -> { balanceKobo }
  verifyWebhookSignature(rawBody, signatureHeader) {} // -> boolean
}
```

`PaystackGateway` implementation notes (confirm each endpoint against current Paystack docs while building):

| Need | Paystack endpoint |
|---|---|
| Start a top-up | `POST /transaction/initialize` (`email`, `amount` in kobo, `reference`, `metadata`) |
| Confirm a top-up | `GET /transaction/verify/:reference` |
| Bank list | `GET /bank?country=nigeria` |
| Resolve account name | `GET /bank/resolve?account_number=&bank_code=` |
| Create payout recipient | `POST /transferrecipient` (`type: "nuban"`, `name`, `account_number`, `bank_code`, `currency: "NGN"`) |
| Send payout | `POST /transfer` (`source: "balance"`, `amount`, `recipient`, `reference`, `reason`) |
| Check payout | `GET /transfer/verify/:reference` |
| Paystack balance | `GET /balance` |

Implementation rules:
- **Paystack requires an `email` on every charge, but auth is phone-first and many users have none.** Use the user's real email if present, otherwise a synthetic one: `u_{userId}@{PAYMENT_SYNTHETIC_EMAIL_DOMAIN}`. Receipts are then not emailed, which is fine.
- Axios client with a 10s timeout, secret key from env only, and log redaction (never log the `Authorization` header or full payloads containing account numbers).
- Retry only idempotent calls (GETs) with backoff. `POST /transfer` is safe to retry **only because the reference is unique**; on a duplicate-reference error, call `verifyTransfer(reference)` instead of failing.
- Transfer references: lowercase, letters/digits/`-`/`_`, 16–50 characters (confirm in docs). Use `wd_` + the withdrawal id without dashes.
- Paystack dashboard prerequisites (operational, not code): Transfers enabled on the live account, "confirm transfers with OTP" turned **off** for API payouts (otherwise transfers stall in an OTP state), webhook URL set, and, if available on the account, settlement schedule set to **manual** so the Paystack balance keeps funds available for payouts. Verify each on the dashboard before go-live.

---

## 7. Flows

### 7.1 Top-up (rider wallet, or driver paying off cash debt)

```
1. POST /payments/topups { amountKobo, target }
   - validate min/max from payment_settings; target 'earnings' only for approved drivers
   - INSERT payment_intents (pending, provider_reference = 'tu_' + uuid-no-dashes)
   - gateway.initializeCharge(...)  -> save authorizationUrl/accessCode
   - return { reference, authorizationUrl }
2. App opens authorizationUrl in an in-app browser. User pays.
3. Paystack webhook 'charge.success' (and/or app polls GET /payments/topups/:reference)
   -> applySuccessfulTopup(reference)   [idempotent, shared by webhook, polling and reconciler]
4. Wallet balance updates; socket event 'wallet:updated' pushes the new balance to user:{id}.
```

```js
async function applySuccessfulTopup(reference) {
  const charge = await gateway.verifyCharge(reference);        // network call BEFORE the DB transaction
  if (charge.status !== 'success') return { applied: false };

  return withTransaction(async (client) => {
    const { rows: [intent] } = await client.query(
      `SELECT * FROM payment_intents WHERE provider_reference = $1 FOR UPDATE`, [reference]);
    if (!intent) { await alertOps('unknown_topup_reference', { reference }); return { applied: false }; }
    if (intent.status === 'succeeded') return { applied: false, replayed: true };

    if (charge.currency !== 'NGN' || charge.amountKobo !== intent.amount_kobo) {
      await client.query(`UPDATE payment_intents SET status='mismatch', updated_at=now() WHERE id=$1`, [intent.id]);
      await alertOps('topup_amount_mismatch', { reference });   // manual review, no credit
      return { applied: false };
    }

    const userAcct = intent.target === 'wallet'
      ? await getOrCreateWalletAccount(client, intent.user_id)
      : await getOrCreateEarningsAccount(client, intent.user_id);
    const gross = intent.amount_kobo, fee = charge.feeKobo, net = gross - fee;

    const { transactionId } = await postTransaction(client, {
      type: 'topup', idempotencyKey: `topup:${intent.id}`,
      referenceType: 'payment_intent', referenceId: intent.id,
      entries: [
        { accountId: SYS.gateway_balance,       direction: 'debit',  amountKobo: net },
        ...(fee > 0 ? [{ accountId: SYS.expense_gateway_fees, direction: 'debit', amountKobo: fee }] : []),
        { accountId: userAcct.id,               direction: 'credit', amountKobo: gross },
      ],
    });
    await client.query(
      `UPDATE payment_intents SET status='succeeded', fee_kobo=$2, channel=$3, paid_at=$4,
         ledger_transaction_id=$5, updated_at=now() WHERE id=$1`,
      [intent.id, fee, charge.channel, charge.paidAt, transactionId]);
    return { applied: true };
  });
}
```

Abandoned top-ups: the reconciler (section 9) marks intents `abandoned` after 24h if Paystack reports no payment.

### 7.2 Trip payments (the interface the trip module calls)

Three functions in `payments/tripPayments.service.js`. All take the caller's `client` and the trip row (already locked by the trip module), and all are idempotent through `trips.payment_status` plus ledger keys.

```js
// Called inside POST /trips transaction when payment_method = 'wallet'
async function holdTripFare(client, trip) {
  if (trip.payment_method !== 'wallet') return;
  const wallet = await getOrCreateWalletAccount(client, trip.rider_id);
  const { transactionId } = await postTransaction(client, {
    type: 'trip_hold', idempotencyKey: `trip:${trip.id}:hold`,
    referenceType: 'trip', referenceId: trip.id,
    entries: [
      { accountId: wallet.id,      direction: 'debit',  amountKobo: trip.fare_kobo },
      { accountId: SYS.escrow_trips, direction: 'credit', amountKobo: trip.fare_kobo },
    ],
  });                                              // throws insufficient_funds -> 402 to the rider
  await client.query(`UPDATE trips SET payment_status='held', hold_tx_id=$2 WHERE id=$1`, [trip.id, transactionId]);
}

// Called on cancelled / no_drivers_found
async function releaseTripHold(client, trip) {
  if (trip.payment_status !== 'held') return;      // cash trips and already-released trips: no-op
  const wallet = await getOrCreateWalletAccount(client, trip.rider_id);
  await postTransaction(client, {
    type: 'trip_hold_release', idempotencyKey: `trip:${trip.id}:release`,
    referenceType: 'trip', referenceId: trip.id,
    entries: [
      { accountId: SYS.escrow_trips, direction: 'debit',  amountKobo: trip.fare_kobo },
      { accountId: wallet.id,        direction: 'credit', amountKobo: trip.fare_kobo },
    ],
  });
  await client.query(`UPDATE trips SET payment_status='released' WHERE id=$1`, [trip.id]);
}

// Called on in_progress -> completed, inside the SAME transaction as transitionTrip
async function settleTrip(client, trip, { commission, driverEarning }) {
  const earnings = await getOrCreateEarningsAccount(client, trip.driver_id);
  let entries, type;
  if (trip.payment_method === 'wallet') {
    if (trip.payment_status !== 'held') throw new ApiError(409, 'trip_fare_not_held');
    type = 'trip_settlement_wallet';
    entries = [
      { accountId: SYS.escrow_trips,       direction: 'debit',  amountKobo: trip.fare_kobo },
      { accountId: earnings.id,            direction: 'credit', amountKobo: driverEarning },
      { accountId: SYS.revenue_commission, direction: 'credit', amountKobo: commission },
    ];
  } else if (trip.payment_method === 'cash') {
    type = 'trip_commission_cash';
    entries = [
      { accountId: earnings.id,            direction: 'debit',  amountKobo: commission },
      { accountId: SYS.revenue_commission, direction: 'credit', amountKobo: commission },
    ];
  } else throw new ApiError(400, 'payment_method_not_supported');   // 'card' is Future

  const { transactionId } = await postTransaction(client, {
    type, idempotencyKey: `trip:${trip.id}:settle`, referenceType: 'trip', referenceId: trip.id, entries,
  });
  await client.query(`UPDATE trips SET payment_status='settled', settle_tx_id=$2 WHERE id=$1`, [trip.id, transactionId]);
}
```

Changes the agent must make in the **trip module** (small, listed so nothing is missed):
- `POST /trips`: for `payment_method = 'wallet'`, call `holdTripFare` inside the creation transaction. This replaces the "check balance" step in the trip spec §3.4. Cash trips skip it.
- Every transition into `cancelled` or `no_drivers_found`: call `releaseTripHold` in the same transaction.
- `completeTrip`: replace the settlement stub with `settleTrip` (trip spec §3.7). Commission still comes from `splitFare(fare_kobo, fare_config.commission_bps)`.
- The unique key `trip:{id}:settle` plus `payment_status` makes a double `complete` call harmless.

A trip must never end with `payment_status = 'held'` in a terminal state. The reconciler checks this (section 9).

### 7.3 Cash commission and driver debt

- Cash trips push `driver_earnings` down by the commission. Wallet trips push it up. Over time it nets out.
- **Gate:** `assertDriverCanGoOnline(userId)` throws `403 cash_debt_limit_exceeded` (with `owedKobo`) when `earnings balance < -cash_debt_limit_kobo`. Call it from the existing go-online path. Also call it before the dispatch module offers a trip, so a driver who crosses the limit mid-shift stops receiving offers.
- **Clearing debt:** the driver tops up with `target = 'earnings'` via Paystack (flow 7.1), or earns it off through wallet-paid trips. A driver cannot withdraw while `earnings <= 0`.
- UI warns at 80% of the limit (client-side, from `/wallet`).

### 7.4 Withdrawals (driver payouts)

**Adding a bank account (once):**
1. `GET /payments/banks` (cached bank list).
2. `POST /payout-accounts/resolve` `{ accountNumber, bankCode }` → returns the bank-registered name for the user to confirm.
3. `POST /payout-accounts` requires a **step-up OTP** (`otp_purpose = 'payout_account'`) and the same inputs. Check name match per `payout_name_match`: `lenient` requires at least one name token of the resolved account name to appear in `users.full_name` (case-insensitive); `strict` requires all tokens of the user's name; `off` skips it. Then `gateway.createRecipient(...)`, store only `recipient_code`, `account_last4`, `bank_*`, and `account_name`. Do not store the full account number.

**Requesting a withdrawal:** `POST /withdrawals { payoutAccountId, amountKobo }` with step-up OTP (`otp_purpose = 'withdrawal'`).

Checks, in order: caller is an approved driver and `users.is_active`; payout account belongs to caller and is active and past `new_payout_account_cooldown_hours`; `amount >= min_withdrawal_kobo`; today's total (sum of non-failed withdrawals since 00:00 Africa/Lagos) plus this amount `<= max_daily_withdrawal_kobo`; no in-flight withdrawal (unique index backs this up); `earnings balance >= amount + fee`; earnings account not frozen.

```js
await withTransaction(async (client) => {
  const earnings = await getOrCreateEarningsAccount(client, userId);
  const wd = await insertWithdrawal(client, { /* status 'pending', provider_reference: 'wd_' + id-no-dashes */ });
  const { transactionId } = await postTransaction(client, {
    type: 'withdrawal_request', idempotencyKey: `withdrawal:${wd.id}:request`,
    referenceType: 'withdrawal', referenceId: wd.id,
    entries: [
      { accountId: earnings.id,           direction: 'debit',  amountKobo: amount + fee },
      { accountId: SYS.payout_in_transit, direction: 'credit', amountKobo: amount },
      ...(fee > 0 ? [{ accountId: SYS.revenue_fees, direction: 'credit', amountKobo: fee }] : []),
    ],
  });
  await setRequestTx(client, wd.id, transactionId);
});
await payoutQueue.add('initiate', { withdrawalId });   // enqueue AFTER commit
```

**Payout worker (`payout:initiate`):** load the withdrawal; if status is not `pending`, stop. Call `gateway.initiateTransfer` with `provider_reference`, then:

| Paystack result | Action |
|---|---|
| Accepted (`pending` / `success`) | Set `processing`, store `provider_transfer_code`. Final state comes from the webhook |
| Status `otp` | Config error (OTP confirmation is on). Alert ops, leave `pending`, do not reverse |
| Insufficient Paystack balance | Alert ops, retry with backoff (max 5 attempts). After the last attempt, reverse (below) |
| Definite rejection (invalid recipient, 4xx other than balance) | Reverse immediately |
| Timeout / network error / 5xx | Leave `pending`, no reversal. The reconciler queries `verifyTransfer(reference)` |

**Outcome handlers (idempotent; called by webhook and reconciler):**

| Event | Ledger | Withdrawal status |
|---|---|---|
| `transfer.success` | Dr `payout_in_transit` / Cr `gateway_balance` for `amount` (key `:success`); then Dr `expense_gateway_fees` / Cr `gateway_balance` for the tier fee (key `:gateway_fee`) | `success` |
| `transfer.failed`, or definite rejection | Dr `payout_in_transit` / Cr `driver_earnings` for `amount + fee` (and Dr `revenue_fees` for `fee` if a fee was charged) (key `:reversal`) | `failed` |
| `transfer.reversed` while `processing` | Same as failed | `reversed` |
| `transfer.reversed` after `success` | Dr `gateway_balance` / Cr `driver_earnings` for `amount + fee` (returned money; the Paystack fee stays an expense) (key `:reversal`) | `reversed` |

Take a `FOR UPDATE` lock on the withdrawal row first and only act when the current status allows the transition. Reversal is always an **offsetting ledger transaction**, never an edit.

### 7.5 Refunds, adjustments, chargebacks (admin)

All admin endpoints require `requireAuth` + `requireStaffRole('admin','super_admin')` and write to an `admin_audit_log` (who, what, why, request id, ledger tx id). Every request requires a `reason` and a client-generated `requestKey` (UUID) used in the idempotency key.

| Action | Endpoint | Ledger entries |
|---|---|---|
| Refund a trip to rider wallet | `POST /admin/payments/refunds` `{ tripId, amountKobo, reason, requestKey }` | Dr `expense_refunds` / Cr `user_wallet:rider`. Clawing back from the driver is a separate, explicit adjustment |
| Manual credit/debit | `POST /admin/payments/adjustments` `{ userId, account: 'wallet'\|'earnings', direction, amountKobo, reason, requestKey }` | credit: Dr `expense_adjustments` / Cr user account. debit: Dr user account / Cr `expense_adjustments`. Amounts over `admin_adjustment_approval_kobo` require `super_admin` |
| Freeze / unfreeze an account | `POST /admin/payments/accounts/:userId/freeze` | Sets `ledger_accounts.is_frozen` (no ledger entry, audit-logged) |
| Sweep Paystack funds to bank | `POST /admin/payments/sweeps` (`super_admin`) | Dr `bank_account` / Cr `gateway_balance` |
| Inspect a user | `GET /admin/payments/users/:userId` | Balances, last 100 entries, intents, withdrawals |

**Chargebacks / disputes:** on Paystack `charge.dispute.create`, MVP behaviour is: freeze the affected user's wallet, store the event, alert ops. Resolution is a manual admin adjustment. (Paystack charges a per-chargeback fee; record it as `expense_gateway_fees` when it is billed.)

---

## 8. Webhook Endpoint (`POST /webhooks/paystack`)

```js
// Mount BEFORE express.json(), or the signature check will fail (it needs the exact raw bytes).
app.post('/webhooks/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!gateway.verifyWebhookSignature(req.body, req.headers['x-paystack-signature'])) return res.sendStatus(401);

  const event = JSON.parse(req.body.toString('utf8'));
  const dedupeKey = `${event.event}:${event.data.reference ?? event.data.transfer_code ?? event.data.id}`;

  const { rowCount } = await db.query(
    `INSERT INTO payment_webhook_events (provider, dedupe_key, event_type, payload)
     VALUES ('paystack', $1, $2, $3) ON CONFLICT (provider, dedupe_key) DO NOTHING`,
    [dedupeKey, event.event, event]);

  res.sendStatus(200);                                   // acknowledge fast; Paystack retries on non-2xx
  if (rowCount) await webhookQueue.add('process', { dedupeKey });   // process off the request path
});
```

Signature check: HMAC-SHA512 of the raw body using the secret key, compared with the `x-paystack-signature` header using `crypto.timingSafeEqual` (check lengths first, because it throws on a length mismatch).

Handled events: `charge.success` → `applySuccessfulTopup`; `transfer.success`, `transfer.failed`, `transfer.reversed` → withdrawal handlers; `charge.dispute.create` → freeze + alert. Everything else is stored with status `ignored`. A processing failure marks the event `failed`, keeps the error, and the job retries with backoff. The reconciler is the second safety net if a webhook never arrives.

---

## 9. Reconciliation & Monitoring (BullMQ repeatable jobs)

| Job | Schedule | What it does |
|---|---|---|
| `topup-reconciler` | every 10 min | For `pending` intents older than 10 min: `verifyCharge`; success → `applySuccessfulTopup`; confirmed unpaid after 24h → `abandoned` |
| `withdrawal-reconciler` | every 5 min | `pending` with no transfer code older than 2 min → re-enqueue `payout:initiate`. `processing` older than 15 min → `verifyTransfer(reference)` and apply the same outcome handlers. (Extend the existing cron.) |
| `ledger-integrity` | nightly | (1) every transaction balances, (2) for every account, sum of entries equals the cached `balance_kobo`, (3) globally total debits = total credits, (4) `balance_after_kobo` of each account's last entry equals its cached balance. Any failure pages ops immediately |
| `gateway-balance-check` | hourly | Compare `gateway.getBalance()` with ledger `gateway_balance`. Tolerate small drift from in-flight settlement; alert when beyond tolerance, and alert when the Paystack balance is below `paystack_balance_alert_kobo` (payouts would fail) |
| `stuck-escrow-check` | every 15 min | Trips in a terminal state with `payment_status = 'held'`, or `escrow_trips` balance not equal to the sum of fares of active wallet trips. Alert; never auto-fix silently |
| `daily-finance-report` | daily 00:30 Africa/Lagos | Top-ups, GMV, commission, withdrawals paid and failed, Paystack fees, cash debt outstanding (sum of negative `driver_earnings`), suspense balance. Posted to the ops channel |

Observability: structured logs with `ledgerTxId`, `userId`, `idempotencyKey` (never tokens, account numbers or raw webhook secrets). Counters for webhook failures, reversals, mismatches and idempotent replays. Alerts go to `ALERT_WEBHOOK_URL` (Slack or email).

---

## 10. API Endpoints

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/wallet` | Auth | `{ walletKobo, earningsKobo, withdrawableKobo, owedKobo, cashDebtLimitKobo, canGoOnline }` |
| GET | `/wallet/transactions?account=wallet\|earnings&cursor=` | Auth | Statement from `ledger_entries` joined to `ledger_transactions`, with human labels and `balanceAfterKobo`, cursor-paginated |
| POST | `/payments/topups` | Auth | Start a top-up |
| GET | `/payments/topups/:reference` | Owner | Status; if still pending, server calls `applySuccessfulTopup` (verifies with Paystack) |
| GET | `/payments/banks` | Driver | Cached Nigerian bank list |
| POST | `/payout-accounts/resolve` | Approved driver | Resolve account name (rate-limited) |
| POST | `/payout-accounts` | Approved driver | Add bank account (step-up OTP) |
| GET | `/payout-accounts` | Approved driver | List (last4, bank, name) |
| DELETE | `/payout-accounts/:id` | Approved driver | Soft-deactivate |
| POST | `/withdrawals` | Approved driver | Request payout (step-up OTP) |
| GET | `/withdrawals`, `/withdrawals/:id` | Owner | History and status |
| GET | `/driver/earnings/summary?range=today\|week\|month` | Approved driver | Trips, gross fares, commission paid, net earnings, cash vs wallet split |
| POST | `/webhooks/paystack` | Paystack | Section 8 |
| `*` | `/admin/payments/*` | Admin | Section 7.5 |

Step-up OTP: reuse `otp.service` with the new purposes. The request carries `otpCode`, verified inside the handler before any money moves. Rate-limit OTP sends per the auth spec.

Rate limits (Redis): top-up creation 10/hour/user, account resolve 10/hour/user, withdrawal request 5/day/user.

Realtime: after any ledger change that affects a user, emit `wallet:updated { walletKobo, earningsKobo }` to the existing `user:{id}` socket room. The client still treats `GET /wallet` as the truth.

---

## 11. Frontend (React Native / Expo)

### 11.1 Rules
- All money fields from the API are integer kobo. One helper `formatNaira(kobo)` produces `₦1,250` (hide `.00`). No floating-point arithmetic on money in the app.
- Use the existing semantic design tokens only (earnings-in, earnings-out, warning, danger). Never raw hex. Driver wallet colour semantics must be preserved: money coming in uses the earnings-in token, money going out and cash debt use the earnings-out / danger tokens.
- `walletStore` (Zustand): `{ walletKobo, earningsKobo, withdrawableKobo, owedKobo, canGoOnline }`, with `refresh()` called on app start, foreground, `wallet:updated` socket events, and after returning from the Paystack browser.

### 11.2 Rider screens

| Screen | Behaviour |
|---|---|
| Wallet | Balance card, "Top up" button, recent transactions with + / − colouring, "View all" |
| Top up | Amount chips (for example ₦1,000 / ₦2,000 / ₦5,000 / other) with min/max validation, opens `authorizationUrl` via `expo-web-browser`, then shows a "Confirming payment" state that polls `GET /payments/topups/:reference` (every 3s, up to 60s) and ends on success, failed, or "still processing, we'll update your wallet" |
| Payment method (inside Ride options) | Cash / Wallet. Wallet shows balance; if balance < fare, show "Top up ₦X to pay with wallet" and disable the option |
| Transaction detail / receipt | Fare, payment method, date, trip link |

### 11.3 Driver screens

| Screen | Behaviour |
|---|---|
| Earnings | Today / week / month summary, trips list, net earnings, cash vs wallet split |
| Cash commission banner | Shown when `owedKobo > 0`: "You owe ₦X in commission" with a "Pay now" button (top-up with `target = 'earnings'`). At 80% of the limit it escalates to a warning; at 100% a blocking message explains why they cannot go online |
| Withdraw | Withdrawable balance, bank account picker, amount input with min/max/fee preview, confirm → OTP step-up → submit |
| Add bank account | Bank picker → account number → auto-resolve and display the account name for confirmation → OTP step-up → save |
| Withdrawal history / detail | Status timeline (Requested → Processing → Paid, or Failed → Refunded to earnings) |

---

## 12. Security & Compliance Checklist (non-negotiable)

- [ ] Only `postTransaction` writes ledger tables; DB triggers block UPDATE/DELETE on `ledger_entries` and `ledger_transactions`, and a deferred trigger enforces balanced transactions
- [ ] Every money operation uses a deterministic idempotency key; reusing a key with different data raises an error
- [ ] Webhook signature verified on the raw body with a timing-safe compare; unsigned or invalid requests change no state
- [ ] A top-up is credited only after server-side `verifyCharge` confirms status, amount, currency and reference
- [ ] The client never sends an amount that gets credited, a fare, a fee, or a "payment succeeded" flag
- [ ] No DB transaction or row lock is held open across a call to Paystack
- [ ] Paystack secret key is server-only, never logged, never in the app bundle
- [ ] Withdrawals and new bank accounts require step-up OTP; withdrawals need an approved driver; one in-flight withdrawal per user; daily limit enforced
- [ ] Payout account name is checked against the user's name per `payout_name_match`; full bank account numbers are not stored
- [ ] Withdrawals can only draw from `driver_earnings`, never `user_wallet`
- [ ] Admin actions require `admin`/`super_admin`, a reason, and an `admin_audit_log` row; large adjustments need `super_admin`
- [ ] Per-user rate limits on top-ups, account resolve and withdrawals
- [ ] `ledger-integrity` and `gateway-balance-check` jobs run and alert; nobody can "fix" a balance by editing `balance_kobo` by hand
- [ ] Personal and bank data handled per NDPR (minimisation, access controls, retention policy)
- [ ] **Regulatory check before launch:** holding customer money in an in-app wallet may fall under Central Bank of Nigeria rules for payment/e-money services. Confirm with a Nigerian fintech lawyer whether you need a licence or should run the wallet through a licensed partner. Also confirm VAT/tax treatment of commission with an accountant. This spec is engineering design, not legal or tax advice

---

## 13. Configuration

**Environment (secrets and infrastructure only):**
```
PAYSTACK_SECRET_KEY=
PAYSTACK_BASE_URL=https://api.paystack.co
PAYMENT_SYNTHETIC_EMAIL_DOMAIN=
ALERT_WEBHOOK_URL=
```

**Database (`payment_settings`, editable by `super_admin`, changes audit-logged):** min/max top-up, min withdrawal, daily withdrawal cap, withdrawal fee, cash debt limit, payout name-match mode, new-account cooldown hours, Paystack balance alert threshold, admin adjustment approval threshold, transfer fee tiers.

Commission percentage stays in `fare_config.commission_bps`.

---

## 14. MVP vs Future

| MVP | Future |
|---|---|
| Double-entry append-only ledger with DB-enforced integrity | Statement exports (PDF/CSV), monthly statements |
| Wallet top-up via Paystack (card, bank transfer, USSD through Paystack checkout) | Dedicated virtual account per user for bank-transfer top-ups; saved-card one-tap top-up |
| Wallet and cash trips, escrow hold/release/settle | Card-on-trip payment (charge a saved Paystack authorization, hold in escrow) |
| Commission per trip, driver cash-debt tracking and go-online gate | Tiered commission, weekly commission caps, incentives and bonuses |
| Driver withdrawals to Nigerian bank accounts with step-up OTP and reversal handling | Instant-payout fee options, scheduled/automatic payouts, payout holding period for new drivers |
| Admin refunds, adjustments, freeze, gateway sweep | Four-eyes approval workflow for adjustments, dispute management UI |
| Reconciliation jobs and daily finance report | Automated accounting export, auto-resolution of mismatches |
| Platform absorbs top-up fees | Option to pass fees to the user |
| | Cancellation fees, tips, promo codes and referral credits, rider-to-driver transfers, earnings → wallet transfer |
| | Fraud scoring and device fingerprinting, multi-currency |

---

## 15. Build Order (execute in this sequence)

1. **Gap report and migration plan.** Read the existing wallet/ledger module. Write down what exists and how it differs from this spec. If the existing ledger is single-entry, plan a one-time migration: create the new tables, create accounts for existing users, post one `adjustment`-type opening-balance transaction per user (Dr `expense_adjustments` / Cr user account, with a clear description), verify totals match the old ledger to the kobo, then retire the old write path. Do not ship until the totals match.
2. **Migrations:** ledger tables, triggers, system account seed, payment tables, `payment_settings` seed, trip and `otp_purpose` alterations.
3. **`postTransaction` + account helpers**, with the concurrency tests in section 15.1 passing before anything else is built on top.
4. **Wallet read endpoints** (`/wallet`, `/wallet/transactions`).
5. **Gateway interface + Paystack implementation + webhook endpoint + event store + processing queue.** Test signature handling with a bad and a good signature.
6. **Top-up flow + `topup-reconciler`.** Test with Paystack test keys and a public tunnel for the webhook.
7. **Trip integration:** `holdTripFare`, `releaseTripHold`, `settleTrip`, the trip-module changes in section 7.2, and the `assertDriverCanGoOnline` gate.
8. **Banks, account resolve, payout accounts, step-up OTP purposes.**
9. **Withdrawals:** request, payout worker, outcome handlers, `withdrawal-reconciler`.
10. **Admin endpoints and audit log.**
11. **Integrity and monitoring jobs, alerts, daily report.**
12. **Frontend:** `walletStore`, API layer, rider wallet and top-up, payment method selector wiring, driver earnings, debt banner, bank account and withdrawal flows.
13. **End-to-end pass in Paystack test mode**, then a staged live pilot with small real amounts before opening to users.

### 15.1 Tests that must pass

- `postTransaction` rejects unbalanced entries, non-positive or non-integer amounts, and overdrafts on non-negative accounts.
- Same idempotency key twice → one transaction; same key with different data → error.
- **Concurrency:** 50 parallel ₦100 debits against a ₦1,000 wallet → exactly 10 succeed, balance ends at ₦0, never negative.
- **Deadlock safety:** parallel transactions touching the same accounts in different orders complete without deadlock errors.
- Mutating a ledger row directly in SQL fails (trigger). An unbalanced insert fails at commit.
- Webhook: invalid signature → 401 and no state change; the same valid event delivered 5 times → exactly one credit; webhook arrives before the app polls and vice versa → still one credit.
- Top-up with mismatched amount → status `mismatch`, no credit, alert raised.
- Wallet trip: hold → settle produces driver earning + commission summing exactly to the fare; hold → cancel restores the rider's balance exactly once; `complete` called twice → one settlement.
- Cash trip: driver earnings reduced by commission; going past the debt limit blocks go-online and offers.
- Withdrawal success, failure, reversal-while-processing, reversal-after-success, timeout-then-reconcile, and duplicate webhook delivery all end with ledger totals correct and no double movement.
- A user with `earnings <= 0` or an unapproved driver cannot withdraw; top-up money cannot be withdrawn.
- `ledger-integrity` job reports a deliberately corrupted cached balance in a test database.
- Property-style test: after a random mix of top-ups, trips, cancellations and withdrawals, total debits equal total credits and every cached balance equals the sum of its entries.

---

## 16. Open Questions (agent: surface these, do not guess)

1. What is the exact shape of the existing ledger (single- or double-entry, table names, balance computation)? Provide the gap report and migration plan from step 1.
2. Is the Paystack **live** account enabled for Transfers, with OTP confirmation disabled for API transfers and webhooks pointed at this server? Is manual settlement available on the account?
3. Real values for `payment_settings`: min/max top-up, min withdrawal, daily cap, withdrawal fee (free or charged), cash debt limit, new-account cooldown.
4. Real commission percentage (`fare_config.commission_bps`), and does the platform want to charge a withdrawal fee?
5. Regulatory path for holding user funds in a wallet (own licence vs licensed partner), and VAT/tax handling on commission. Needs a lawyer and an accountant.
6. Should drivers be allowed to move earnings into their rider wallet to pay for rides? (Not in MVP; confirm.)

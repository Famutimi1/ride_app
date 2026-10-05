CREATE TYPE ledger_account_type AS ENUM ('asset','liability','revenue','expense');
CREATE TYPE entry_direction AS ENUM ('debit','credit');
CREATE TYPE ledger_tx_type AS ENUM ('topup','trip_hold','trip_hold_release','trip_settlement_wallet','trip_commission_cash','withdrawal_request','withdrawal_success','withdrawal_reversal','withdrawal_fee_expense','refund','adjustment','gateway_sweep','chargeback','cancellation_fee','promo_credit','tip');
CREATE TYPE intent_status AS ENUM ('pending','succeeded','failed','abandoned','mismatch');
CREATE TYPE withdrawal_status AS ENUM ('pending','processing','success','failed','reversed');

CREATE TABLE ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(80) UNIQUE NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('user_wallet','driver_earnings','system')),
  type ledger_account_type NOT NULL, normal_side entry_direction NOT NULL,
  owner_user_id UUID REFERENCES users(id), currency CHAR(3) NOT NULL DEFAULT 'NGN',
  balance_kobo BIGINT NOT NULL DEFAULT 0, allow_negative BOOLEAN NOT NULL DEFAULT false,
  is_frozen BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (allow_negative OR balance_kobo >= 0),
  CHECK ((kind='system' AND owner_user_id IS NULL) OR (kind<>'system' AND owner_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX one_wallet_per_user ON ledger_accounts(owner_user_id) WHERE kind='user_wallet';
CREATE UNIQUE INDEX one_earnings_per_user ON ledger_accounts(owner_user_id) WHERE kind='driver_earnings';
CREATE TABLE ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), type ledger_tx_type NOT NULL,
  idempotency_key VARCHAR(160) UNIQUE NOT NULL, request_hash CHAR(64) NOT NULL,
  reference_type VARCHAR(30), reference_id UUID, description VARCHAR(200),
  metadata JSONB NOT NULL DEFAULT '{}', created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ltx_reference ON ledger_transactions(reference_type,reference_id);
CREATE TABLE ledger_entries (
  id BIGSERIAL PRIMARY KEY, transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
  account_id UUID NOT NULL REFERENCES ledger_accounts(id), direction entry_direction NOT NULL,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo>0), balance_after_kobo BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_le_account_time ON ledger_entries(account_id,id DESC);
CREATE INDEX idx_le_tx ON ledger_entries(transaction_id);

CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ledger tables are append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER no_mutate_entries BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE TRIGGER no_mutate_transactions BEFORE UPDATE OR DELETE ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE FUNCTION assert_tx_balanced() RETURNS trigger AS $$
DECLARE d BIGINT; c BIGINT; tx_id UUID;
BEGIN
  IF TG_TABLE_NAME='ledger_transactions' THEN tx_id:=NEW.id; ELSE tx_id:=NEW.transaction_id; END IF;
  SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE direction='debit'),0),COALESCE(SUM(amount_kobo) FILTER (WHERE direction='credit'),0)
    INTO d,c FROM ledger_entries WHERE transaction_id=tx_id;
  IF d=0 OR d<>c THEN RAISE EXCEPTION 'unbalanced ledger transaction %: debit % credit %',tx_id,d,c; END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_tx_balanced AFTER INSERT ON ledger_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_tx_balanced();
CREATE CONSTRAINT TRIGGER trg_entry_balanced AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_tx_balanced();

INSERT INTO ledger_accounts(code,kind,type,normal_side,allow_negative) VALUES
 ('escrow_trips','system','liability','credit',false),('payout_in_transit','system','liability','credit',false),
 ('suspense','system','liability','credit',false),('gateway_balance','system','asset','debit',false),
 ('bank_account','system','asset','debit',false),('revenue_commission','system','revenue','credit',false),
 ('revenue_fees','system','revenue','credit',false),('expense_gateway_fees','system','expense','debit',false),
 ('expense_refunds','system','expense','debit',false),('expense_adjustments','system','expense','debit',true);

CREATE TABLE payment_intents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id),
 target VARCHAR(10) NOT NULL CHECK(target IN ('wallet','earnings')),
 amount_kobo BIGINT NOT NULL CHECK(amount_kobo>0), status intent_status NOT NULL DEFAULT 'pending',
 provider VARCHAR(20) NOT NULL DEFAULT 'paystack', provider_reference VARCHAR(80) UNIQUE NOT NULL,
 authorization_url TEXT, access_code VARCHAR(80), channel VARCHAR(30),fee_kobo BIGINT,
 paid_at TIMESTAMPTZ,ledger_transaction_id UUID REFERENCES ledger_transactions(id),
 failure_reason VARCHAR(200),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_intents_user ON payment_intents(user_id,created_at DESC);
CREATE INDEX idx_intents_pending ON payment_intents(status,created_at) WHERE status='pending';
CREATE TABLE payout_accounts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL REFERENCES users(id),
 bank_code VARCHAR(10) NOT NULL,bank_name VARCHAR(80) NOT NULL,account_last4 CHAR(4) NOT NULL,
 account_name VARCHAR(120) NOT NULL,recipient_code VARCHAR(40) NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id,recipient_code)
);
CREATE TABLE withdrawals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL REFERENCES users(id),
 payout_account_id UUID NOT NULL REFERENCES payout_accounts(id),amount_kobo BIGINT NOT NULL CHECK(amount_kobo>0),
 fee_kobo BIGINT NOT NULL DEFAULT 0,status withdrawal_status NOT NULL DEFAULT 'pending',
 provider_reference VARCHAR(50) UNIQUE NOT NULL,provider_transfer_code VARCHAR(40),
 attempts INT NOT NULL DEFAULT 0,failure_reason VARCHAR(200),
 request_tx_id UUID REFERENCES ledger_transactions(id),final_tx_id UUID REFERENCES ledger_transactions(id),
 requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),completed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_inflight_withdrawal ON withdrawals(user_id) WHERE status IN ('pending','processing');
CREATE INDEX idx_withdrawals_user ON withdrawals(user_id,requested_at DESC);
CREATE TABLE payment_webhook_events (
 id BIGSERIAL PRIMARY KEY,provider VARCHAR(20) NOT NULL,dedupe_key VARCHAR(160) NOT NULL,
 event_type VARCHAR(60) NOT NULL,payload JSONB NOT NULL,status VARCHAR(15) NOT NULL DEFAULT 'received',
 error TEXT,received_at TIMESTAMPTZ NOT NULL DEFAULT now(),processed_at TIMESTAMPTZ,
 UNIQUE(provider,dedupe_key)
);
CREATE TABLE payment_settings (
 id BOOLEAN PRIMARY KEY DEFAULT true CHECK(id),min_topup_kobo BIGINT NOT NULL,max_topup_kobo BIGINT NOT NULL,
 min_withdrawal_kobo BIGINT NOT NULL,max_daily_withdrawal_kobo BIGINT NOT NULL,
 withdrawal_fee_kobo BIGINT NOT NULL DEFAULT 0,cash_debt_limit_kobo BIGINT NOT NULL,
 payout_name_match VARCHAR(10) NOT NULL DEFAULT 'lenient' CHECK(payout_name_match IN ('strict','lenient','off')),
 new_payout_account_cooldown_hours INT NOT NULL DEFAULT 0,paystack_balance_alert_kobo BIGINT NOT NULL,
 admin_adjustment_approval_kobo BIGINT NOT NULL,transfer_fee_tiers JSONB NOT NULL
);
-- Development placeholders. Replace with approved commercial limits before live use.
INSERT INTO payment_settings VALUES(true,10000,100000000,100000,50000000,0,500000,'lenient',0,1000000,1000000,
 '[{"maxKobo":500000,"feeKobo":1000},{"maxKobo":5000000,"feeKobo":2500},{"maxKobo":null,"feeKobo":5000}]');
CREATE TABLE admin_audit_log (
 id BIGSERIAL PRIMARY KEY,actor_id UUID NOT NULL REFERENCES users(id),action VARCHAR(60) NOT NULL,
 target_user_id UUID REFERENCES users(id),request_key UUID,reason TEXT NOT NULL,
 ledger_transaction_id UUID REFERENCES ledger_transactions(id),metadata JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE trips ADD COLUMN payment_status VARCHAR(10) NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','held','settled','released'));
ALTER TABLE trips ADD COLUMN hold_tx_id UUID REFERENCES ledger_transactions(id);
ALTER TABLE trips ADD COLUMN settle_tx_id UUID REFERENCES ledger_transactions(id);
ALTER TYPE otp_purpose ADD VALUE IF NOT EXISTS 'withdrawal';
ALTER TYPE otp_purpose ADD VALUE IF NOT EXISTS 'payout_account';

-- One-time opening balances, including negative approved-driver cash debt.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM wallet_transactions WHERE user_id IS NOT NULL AND entry_type NOT IN ('trip_fare_debit','driver_earning_credit','driver_cash_commission_debit'))
 THEN RAISE EXCEPTION 'unknown legacy wallet entry type; review before migration'; END IF;
 IF EXISTS(SELECT 1 FROM (
   SELECT user_id,SUM(amount_kobo) balance FROM wallet_transactions WHERE entry_type IN ('driver_earning_credit','driver_cash_commission_debit') GROUP BY user_id
 ) b LEFT JOIN driver_profiles d ON d.user_id=b.user_id AND d.status='approved' WHERE b.balance<0 AND d.user_id IS NULL)
 THEN RAISE EXCEPTION 'legacy negative balance belongs to an unapproved driver; review before migration'; END IF;
END $$;
INSERT INTO ledger_accounts(code,kind,type,normal_side,owner_user_id,allow_negative)
 SELECT b.kind||':'||b.user_id,b.kind,'liability','credit',b.user_id,
        b.kind='driver_earnings' AND d.status='approved'
 FROM (SELECT user_id,CASE WHEN entry_type IN ('driver_earning_credit','driver_cash_commission_debit') THEN 'driver_earnings' ELSE 'user_wallet' END kind,
              SUM(amount_kobo) balance FROM wallet_transactions WHERE user_id IS NOT NULL
       GROUP BY user_id,CASE WHEN entry_type IN ('driver_earning_credit','driver_cash_commission_debit') THEN 'driver_earnings' ELSE 'user_wallet' END) b
 LEFT JOIN driver_profiles d ON d.user_id=b.user_id WHERE b.balance<>0;
DO $$ DECLARE legacy RECORD; acct UUID; adjustment UUID; tx UUID; amount BIGINT;
BEGIN
 SELECT id INTO adjustment FROM ledger_accounts WHERE code='expense_adjustments';
 FOR legacy IN SELECT user_id,CASE WHEN entry_type IN ('driver_earning_credit','driver_cash_commission_debit') THEN 'driver_earnings' ELSE 'user_wallet' END kind,
                      SUM(amount_kobo) balance FROM wallet_transactions WHERE user_id IS NOT NULL
     GROUP BY user_id,CASE WHEN entry_type IN ('driver_earning_credit','driver_cash_commission_debit') THEN 'driver_earnings' ELSE 'user_wallet' END
     HAVING SUM(amount_kobo)<>0 LOOP
   SELECT id INTO acct FROM ledger_accounts WHERE code=legacy.kind||':'||legacy.user_id;
   amount:=abs(legacy.balance);
   INSERT INTO ledger_transactions(type,idempotency_key,request_hash,reference_type,reference_id,description,metadata)
   VALUES('adjustment','legacy:opening:'||legacy.kind||':'||legacy.user_id,encode(digest('legacy:opening:'||legacy.kind||':'||legacy.user_id||':'||legacy.balance,'sha256'),'hex'),'admin',legacy.user_id,'One-time legacy opening balance',jsonb_build_object('legacyBalanceKobo',legacy.balance,'kind',legacy.kind)) RETURNING id INTO tx;
   IF legacy.balance>0 THEN
     UPDATE ledger_accounts SET balance_kobo=amount WHERE id=acct;
     UPDATE ledger_accounts SET balance_kobo=balance_kobo+amount WHERE id=adjustment;
     INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_kobo,balance_after_kobo)
       VALUES(tx,adjustment,'debit',amount,(SELECT balance_kobo FROM ledger_accounts WHERE id=adjustment)),(tx,acct,'credit',amount,amount);
   ELSE
     UPDATE ledger_accounts SET balance_kobo=-amount WHERE id=acct;
     UPDATE ledger_accounts SET balance_kobo=balance_kobo-amount WHERE id=adjustment;
     INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_kobo,balance_after_kobo)
       VALUES(tx,acct,'debit',amount,-amount),(tx,adjustment,'credit',amount,(SELECT balance_kobo FROM ledger_accounts WHERE id=adjustment));
   END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM (
   SELECT user_id,CASE WHEN entry_type IN ('driver_earning_credit','driver_cash_commission_debit') THEN 'driver_earnings' ELSE 'user_wallet' END kind,SUM(amount_kobo) balance
   FROM wallet_transactions WHERE user_id IS NOT NULL GROUP BY user_id,CASE WHEN entry_type IN ('driver_earning_credit','driver_cash_commission_debit') THEN 'driver_earnings' ELSE 'user_wallet' END
 ) b LEFT JOIN ledger_accounts a ON a.owner_user_id=b.user_id AND a.kind=b.kind
   WHERE b.balance IS DISTINCT FROM COALESCE(a.balance_kobo,0)) THEN RAISE EXCEPTION 'legacy balance migration mismatch'; END IF;
END $$;
CREATE TRIGGER wallet_transactions_retired BEFORE INSERT ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

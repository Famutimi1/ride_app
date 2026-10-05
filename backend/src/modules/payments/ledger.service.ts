import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { db } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';

export type Direction = 'debit' | 'credit';
export interface LedgerEntryInput { accountId: string; direction: Direction; amountKobo: number }
export interface LedgerTransactionInput {
  type: string; idempotencyKey: string; referenceType?: string; referenceId?: string;
  description?: string; metadata?: Record<string, unknown>; createdBy?: string;
  entries: LedgerEntryInput[];
}
interface AccountRow { id: string; normal_side: Direction; balance_kobo: string; allow_negative: boolean; is_frozen: boolean }

export async function postTransaction(client: PoolClient, input: LedgerTransactionInput): Promise<{ transactionId: string; replayed: boolean }> {
  if (input.entries.length < 2) throw new ApiError(400, 'too_few_entries');
  let debit = 0, credit = 0;
  for (const entry of input.entries) {
    if (!Number.isSafeInteger(entry.amountKobo) || entry.amountKobo <= 0) throw new ApiError(400, 'bad_amount');
    if (entry.direction === 'debit') debit += entry.amountKobo;
    else if (entry.direction === 'credit') credit += entry.amountKobo;
    else throw new ApiError(400, 'bad_direction');
  }
  if (!Number.isSafeInteger(debit) || debit !== credit) throw new ApiError(400, 'unbalanced_ledger_transaction');
  const hash = createHash('sha256').update(JSON.stringify(input.entries.map((e) => [e.accountId, e.direction, e.amountKobo]))).digest('hex');
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions(type,idempotency_key,request_hash,reference_type,reference_id,description,metadata,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
    [input.type,input.idempotencyKey,hash,input.referenceType??null,input.referenceId??null,input.description??null,input.metadata??{},input.createdBy??null],
  );
  if (!inserted.rows[0]) {
    const previous = (await client.query<{id:string;request_hash:string}>('SELECT id,request_hash FROM ledger_transactions WHERE idempotency_key=$1',[input.idempotencyKey])).rows[0];
    if (!previous || previous.request_hash !== hash) throw new ApiError(409, 'idempotency_key_reused_with_different_data');
    return { transactionId: previous.id, replayed: true };
  }
  const transactionId = inserted.rows[0].id;
  const accountIds = [...new Set(input.entries.map((e) => e.accountId))].sort();
  const locked = await client.query<AccountRow>('SELECT id,normal_side,balance_kobo,allow_negative,is_frozen FROM ledger_accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[accountIds]);
  if (locked.rows.length !== accountIds.length) throw new ApiError(400, 'unknown_ledger_account');
  const accounts = new Map(locked.rows.map((row) => [row.id, { ...row, balance: Number(row.balance_kobo) }]));
  for (const entry of input.entries) {
    const account = accounts.get(entry.accountId)!;
    const delta = entry.direction === account.normal_side ? entry.amountKobo : -entry.amountKobo;
    if (delta < 0 && account.is_frozen) throw new ApiError(409, 'account_frozen');
    const next = account.balance + delta;
    if (!Number.isSafeInteger(next)) throw new ApiError(400, 'amount_out_of_range');
    if (next < 0 && !account.allow_negative) throw new ApiError(402, 'insufficient_funds');
    account.balance = next;
    await client.query('INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_kobo,balance_after_kobo) VALUES($1,$2,$3,$4,$5)',[transactionId,entry.accountId,entry.direction,entry.amountKobo,next]);
  }
  for (const account of accounts.values()) await client.query('UPDATE ledger_accounts SET balance_kobo=$2,updated_at=now() WHERE id=$1',[account.id,account.balance]);
  return { transactionId, replayed: false };
}

export async function getSystemAccountId(client: PoolClient, code: string): Promise<string> {
  const row = (await client.query<{id:string}>('SELECT id FROM ledger_accounts WHERE code=$1 AND kind=$2',[code,'system'])).rows[0];
  if (!row) throw new Error(`missing system ledger account: ${code}`);
  return row.id;
}
export async function getOrCreateWalletAccount(client: PoolClient, userId: string): Promise<string> {
  await client.query(`INSERT INTO ledger_accounts(code,kind,type,normal_side,owner_user_id)
    VALUES($1,'user_wallet','liability','credit',$2) ON CONFLICT DO NOTHING`,[`user_wallet:${userId}`,userId]);
  const row = (await client.query<{id:string}>('SELECT id FROM ledger_accounts WHERE owner_user_id=$1 AND kind=$2',[userId,'user_wallet'])).rows[0];
  if (!row) throw new Error('wallet_account_creation_failed');
  return row.id;
}
export async function getOrCreateEarningsAccount(client: PoolClient, userId: string): Promise<string> {
  const approved = (await client.query('SELECT 1 FROM driver_profiles WHERE user_id=$1 AND status=$2',[userId,'approved'])).rowCount;
  if (!approved) throw new ApiError(403, 'driver_not_approved');
  await client.query(`INSERT INTO ledger_accounts(code,kind,type,normal_side,owner_user_id,allow_negative)
    VALUES($1,'driver_earnings','liability','credit',$2,true) ON CONFLICT DO NOTHING`,[`driver_earnings:${userId}`,userId]);
  const row = (await client.query<{id:string}>('SELECT id FROM ledger_accounts WHERE owner_user_id=$1 AND kind=$2',[userId,'driver_earnings'])).rows[0];
  if (!row) throw new Error('earnings_account_creation_failed');
  return row.id;
}
export async function getBalances(userId: string) {
  const { rows } = await db.query<{kind:string;balance_kobo:string}>(
    'SELECT kind,balance_kobo FROM ledger_accounts WHERE owner_user_id=$1',[userId]);
  const walletKobo = Number(rows.find((r) => r.kind === 'user_wallet')?.balance_kobo ?? 0);
  const earningsKobo = Number(rows.find((r) => r.kind === 'driver_earnings')?.balance_kobo ?? 0);
  const limit = Number((await db.query<{cash_debt_limit_kobo:string}>('SELECT cash_debt_limit_kobo FROM payment_settings WHERE id=true')).rows[0]?.cash_debt_limit_kobo ?? 0);
  return { walletKobo, earningsKobo, withdrawableKobo: Math.max(0,earningsKobo), owedKobo: Math.max(0,-earningsKobo), cashDebtLimitKobo: limit, canGoOnline: earningsKobo > -limit };
}

export async function assertDriverCanGoOnline(userId: string): Promise<void> {
  const balance = await getBalances(userId);
  if (!balance.canGoOnline) throw new ApiError(403, 'cash_debt_limit_exceeded', { owedKobo: balance.owedKobo });
}

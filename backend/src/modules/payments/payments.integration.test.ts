import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import { Pool, type PoolClient } from 'pg';

dotenv.config();
const databaseUrl=process.env.DATABASE_URL;
const schema=`payments_test_${process.pid}_${Date.now()}`;

async function transaction<T>(pool:Pool,work:(client:PoolClient)=>Promise<T>) {
  const client=await pool.connect();
  try { await client.query('BEGIN');const value=await work(client);await client.query('COMMIT');return value; }
  catch(error) { await client.query('ROLLBACK');throw error; }
  finally { client.release(); }
}

test('top-ups and payouts remain balanced across retries and reversals',{skip:!databaseUrl},async()=>{
  const admin=new Pool({connectionString:databaseUrl});
  const scopedUrl=new URL(databaseUrl!);
  scopedUrl.searchParams.set('options',`-c search_path=${schema},public`);
  const pool=new Pool({connectionString:scopedUrl.toString()});
  let appPool:Pool|undefined;
  let restoreVerify:(()=>void)|undefined;
  let stopPaymentWorkers:(()=>Promise<void>)|undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    for(const file of ['001_auth.sql','002_trip_system.sql','003_payments_ledger.sql','015_notifications.sql', '017_email_outbox.sql', '018_email_settings.sql'])
      await pool.query(await readFile(resolve(process.cwd(),'migrations',file),'utf8'));

    // Import the service only after its global pool points at the isolated schema.
    process.env.DATABASE_URL=scopedUrl.toString();
    const [{db},{gateway},{applySuccessfulTopup,getTopup},{applyWithdrawalOutcome},{getOrCreateEarningsAccount,getSystemAccountId,postTransaction}]=await Promise.all([
      import('../../shared/config/db.js'),import('./gateway.js'),import('./topups.service.js'),import('./withdrawals.service.js'),import('./ledger.service.js'),
    ]);
    ({stopPaymentWorkers}=await import('./paymentQueue.js'));
    appPool=db;
    const userId=(await db.query<{id:string}>("INSERT INTO users(full_name,phone) VALUES('Payment Test','+2348000000101') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO driver_profiles(user_id,status) VALUES($1,'approved')",[userId]);
    const topup=(await db.query<{id:string}>("INSERT INTO payment_intents(user_id,target,amount_kobo,provider_reference) VALUES($1,'wallet',100000,'test_topup_1') RETURNING id",[userId])).rows[0];
    const originalVerify=gateway.verifyCharge,originalTransfer=gateway.verifyTransfer;
    let transferStatus='success';
    gateway.verifyTransfer=async(reference)=>({status:transferStatus,reference,domain:'test',amountKobo:50000,currency:'NGN',recipientCode:'RCP_test',transferCode:'TRF_test',feeKobo:1000});
    gateway.verifyCharge=async(reference)=>({status:'success',reference,domain:'test',amountKobo:100000,currency:'NGN',feeKobo:3000,channel:'card',paidAt:new Date().toISOString()});
    restoreVerify=()=>{gateway.verifyCharge=originalVerify;gateway.verifyTransfer=originalTransfer;};

    const results=await Promise.all(Array.from({length:5},()=>applySuccessfulTopup('test_topup_1')));
    assert.equal(results.filter((result)=>result.applied).length,1);
    assert.equal((await getTopup(userId,'test_topup_1')).status,'succeeded');
    assert.equal((await db.query('SELECT id FROM ledger_transactions WHERE idempotency_key=$1',[`topup:${topup.id}`])).rowCount,1);
    assert.equal(Number((await db.query<{balance_kobo:string}>("SELECT balance_kobo FROM ledger_accounts WHERE code=$1",[`user_wallet:${userId}`])).rows[0].balance_kobo),100000);
    assert.equal(Number((await db.query<{balance_kobo:string}>("SELECT balance_kobo FROM ledger_accounts WHERE code='gateway_balance'")).rows[0].balance_kobo),97000);
    await assert.rejects(getTopup('00000000-0000-0000-0000-000000000000','test_topup_1'),/topup_not_found/);

    await db.query("INSERT INTO payment_intents(user_id,target,amount_kobo,provider_reference) VALUES($1,'wallet',200000,'test_topup_mismatch')",[userId]);
    assert.equal((await applySuccessfulTopup('test_topup_mismatch')).status,'mismatch');
    assert.equal(Number((await db.query<{balance_kobo:string}>("SELECT balance_kobo FROM ledger_accounts WHERE code=$1",[`user_wallet:${userId}`])).rows[0].balance_kobo),100000);

    const {earnings,transit}=await transaction(db,async(client)=>({
      earnings:await getOrCreateEarningsAccount(client,userId),transit:await getSystemAccountId(client,'payout_in_transit'),
    }));
    await transaction(db,async(client)=>postTransaction(client,{type:'adjustment',idempotencyKey:'test_driver_funding',entries:[
      {accountId:await getSystemAccountId(client,'expense_adjustments'),direction:'debit',amountKobo:80000},
      {accountId:earnings,direction:'credit',amountKobo:80000},
    ]}));
    const payoutId=(await db.query<{id:string}>("INSERT INTO payout_accounts(user_id,bank_code,bank_name,account_last4,account_name,recipient_code) VALUES($1,'044','Test Bank','1234','Payment Test','RCP_test') RETURNING id",[userId])).rows[0].id;
    const withdrawal=(await db.query<{id:string}>("INSERT INTO withdrawals(user_id,payout_account_id,amount_kobo,provider_reference) VALUES($1,$2,50000,'test_withdrawal_1') RETURNING id",[userId,payoutId])).rows[0];
    await transaction(db,async(client)=>postTransaction(client,{type:'withdrawal_request',idempotencyKey:`withdrawal:${withdrawal.id}:request`,entries:[
      {accountId:earnings,direction:'debit',amountKobo:50000},{accountId:transit,direction:'credit',amountKobo:50000},
    ]}));
    await Promise.all(Array.from({length:3},()=>applyWithdrawalOutcome('test_withdrawal_1')));
    assert.equal(Number((await db.query<{balance_kobo:string}>('SELECT balance_kobo FROM ledger_accounts WHERE id=$1',[transit])).rows[0].balance_kobo),0);
    assert.equal((await db.query('SELECT id FROM ledger_transactions WHERE idempotency_key=$1',[`withdrawal:${withdrawal.id}:success`])).rowCount,1);
    transferStatus='reversed';
    await Promise.all(Array.from({length:3},()=>applyWithdrawalOutcome('test_withdrawal_1')));
    assert.equal(Number((await db.query<{balance_kobo:string}>('SELECT balance_kobo FROM ledger_accounts WHERE id=$1',[earnings])).rows[0].balance_kobo),80000);
    assert.equal((await db.query('SELECT id FROM ledger_transactions WHERE idempotency_key=$1',[`withdrawal:${withdrawal.id}:reversal`])).rowCount,1);
    assert.equal((await db.query<{status:string}>('SELECT status FROM withdrawals WHERE id=$1',[withdrawal.id])).rows[0].status,'reversed');

    const unbalanced=await db.query(`SELECT transaction_id FROM ledger_entries GROUP BY transaction_id
      HAVING SUM(amount_kobo) FILTER(WHERE direction='debit')<>SUM(amount_kobo) FILTER(WHERE direction='credit')`);
    assert.equal(unbalanced.rowCount,0);
  } finally {
    restoreVerify?.();
    await stopPaymentWorkers?.();
    await appPool?.end();
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

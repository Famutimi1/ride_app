import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { Pool } from 'pg';

const databaseUrl=process.env.DATABASE_URL;
const schema=`finance_recovery_${process.pid}_${Date.now()}`;
test('financial recovery uses verified provider evidence and durable exactly-once postings',{skip:!databaseUrl,timeout:45000},async(t)=>{
 const admin=new Pool({connectionString:databaseUrl});const url=new URL(databaseUrl!);url.searchParams.set('options',`-c search_path=${schema},public`);
 const scoped=new Pool({connectionString:url.toString()});let server:Server|undefined;
 await admin.query(`CREATE SCHEMA ${schema}`);
 try {
  for(const file of ['001_auth.sql','002_trip_system.sql','003_payments_ledger.sql','015_notifications.sql', '017_email_outbox.sql', '018_email_settings.sql'])await scoped.query(await readFile(resolve('migrations',file),'utf8'));
  process.env.DATABASE_URL=url.toString();
  const {db,inTransaction}=await import('../../shared/config/db.js');
  const {gateway,PaystackRequestError}=await import('./gateway.js');
  const {getOrCreateEarningsAccount,getSystemAccountId,postTransaction}=await import('./ledger.service.js');
  const {applyWithdrawalOutcome,initiatePayout,requestWithdrawal}=await import('./withdrawals.service.js');
  const {reconcileTopups,reconcileWithdrawals,checkLedgerIntegrity}=await import('./reconciliation.service.js');
  const {processWebhook}=await import('./webhook.service.js');
  const {stopPaymentWorkers}=await import('./paymentQueue.js');
  const originalCharge=gateway.verifyCharge,originalTransfer=gateway.verifyTransfer,originalInitiate=gateway.initiateTransfer,originalBalance=gateway.getBalance;
  let phase='pending',amount=50000,recipient='RCP_recovery',domain='test',fee:number|null=1234;
  let unavailable=false,notFound=false,posts=0;
  gateway.verifyTransfer=async(reference)=>{
    if(unavailable)throw new PaystackRequestError(0,'unavailable');
    if(notFound)throw new PaystackRequestError(404,'not_found');
    return {status:phase,reference,domain,amountKobo:amount,currency:'NGN',recipientCode:recipient,transferCode:'TRF_'+reference,feeKobo:fee};
  };
  gateway.verifyCharge=async(reference)=>({status:'success',reference,domain:'test',amountKobo:100000,currency:'NGN',feeKobo:3000,channel:'card',paidAt:new Date().toISOString()});
  const fixture=async()=>inTransaction(async(client)=>{
    const user=(await client.query<{id:string}>("INSERT INTO users(full_name,phone) VALUES('Recovery fixture',$1) RETURNING id",['+234'+String(Math.floor(Math.random()*10000000000)).padStart(10,'0')])).rows[0].id;
    await client.query("INSERT INTO driver_profiles(user_id,status) VALUES($1,'approved')",[user]);
    const earnings=await getOrCreateEarningsAccount(client,user);
    await postTransaction(client,{type:'adjustment',idempotencyKey:'fund:'+user,entries:[{accountId:await getSystemAccountId(client,'expense_adjustments'),direction:'debit',amountKobo:100000},{accountId:earnings,direction:'credit',amountKobo:100000}]});
    const payout=(await client.query<{id:string}>("INSERT INTO payout_accounts(user_id,bank_code,bank_name,account_last4,account_name,recipient_code) VALUES($1,'044','Fixture bank','1234','Fixture','RCP_recovery') RETURNING id",[user])).rows[0].id;
    const reference='wd_'+randomUUID().replace(/-/g,'');
    const id=(await client.query<{id:string}>("INSERT INTO withdrawals(user_id,payout_account_id,amount_kobo,fee_kobo,provider_reference) VALUES($1,$2,50000,500,$3) RETURNING id",[user,payout,reference])).rows[0].id;
    const request=await postTransaction(client,{type:'withdrawal_request',idempotencyKey:`withdrawal:${id}:request`,referenceType:'withdrawal',referenceId:id,metadata:{gatewayFeeEstimateKobo:1000},entries:[{accountId:earnings,direction:'debit',amountKobo:50500},{accountId:await getSystemAccountId(client,'payout_in_transit'),direction:'credit',amountKobo:50000},{accountId:await getSystemAccountId(client,'revenue_fees'),direction:'credit',amountKobo:500}]});
    await client.query('UPDATE withdrawals SET request_tx_id=$2 WHERE id=$1',[id,request.transactionId]);
    return {id,user,reference,earnings};
  });
  const balance=async(id:string)=>Number((await db.query<{balance_kobo:string}>('SELECT balance_kobo FROM ledger_accounts WHERE id=$1',[id])).rows[0].balance_kobo);
  try {
    await inTransaction(async(client)=>postTransaction(client,{type:'adjustment',idempotencyKey:'gateway-fixture',entries:[{accountId:await getSystemAccountId(client,'gateway_balance'),direction:'debit',amountKobo:10000000},{accountId:await getSystemAccountId(client,'expense_adjustments'),direction:'credit',amountKobo:10000000}]}));
    const {createApp}=await import('../../app.js');server=createApp().listen(0,'127.0.0.1');await new Promise<void>(done=>server!.once('listening',done));
    const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send=async(payload:unknown,valid=true)=>{
      const body=JSON.stringify(payload),signature=createHmac('sha512',process.env.PAYSTACK_SECRET_KEY!).update(body).digest('hex');
      return fetch(origin+'/webhooks/paystack',{method:'POST',headers:{'Content-Type':'application/json','x-paystack-signature':valid?signature:'0'.repeat(128)},body});
    };
    await t.test('signed HTTP receipt validates structure/domain and strips private payload fields',async()=>{
      assert.equal((await send(null)).status,400);
      assert.equal((await send({event:'charge.success',data:{domain:'live',reference:'bad_mode'}})).status,400);
      assert.equal((await send({event:'charge.success',data:{domain:'test',reference:'fixture'}},false)).status,401);
      const payload={event:'charge.success',data:{domain:'test',reference:'unknown_external_fixture',customer:{email:'fixture@example.invalid'},authorization:{secret:'fixture'}}};
      assert.equal((await send(payload)).status,200);assert.equal((await send(payload)).status,200);
      const rows=await db.query('SELECT payload FROM payment_webhook_events WHERE dedupe_key=$1',['charge.success:unknown_external_fixture']);
      assert.equal(rows.rowCount,1);assert.deepEqual(rows.rows[0].payload,{event:'charge.success',data:{reference:'unknown_external_fixture',domain:'test'}});
      await processWebhook('charge.success:unknown_external_fixture');
      assert.equal((await db.query("SELECT status FROM payment_webhook_events WHERE dedupe_key='charge.success:unknown_external_fixture'")).rows[0].status,'ignored');
    });
    await t.test('missed webhook and uncertain checkout initialization recover one top-up',async()=>{
      const user=(await fixture()).user;
      const reference='tu_'+randomUUID().replace(/-/g,'');
      await db.query("INSERT INTO payment_intents(user_id,target,amount_kobo,provider_reference,status,created_at,updated_at,failure_reason) VALUES($1,'wallet',100000,$2,'failed',now()-interval '1 hour',now()-interval '1 hour','initialization_failed')",[user,reference]);
      await Promise.all([reconcileTopups(),reconcileTopups()]);
      assert.equal((await db.query('SELECT status,failure_reason FROM payment_intents WHERE provider_reference=$1',[reference])).rows[0].status,'succeeded');
      assert.equal((await db.query("SELECT count(*)::text n FROM ledger_transactions WHERE type='topup'")).rows[0].n,'1');
      assert.equal((await send({event:'charge.success',data:{domain:'test',reference}})).status,200);
      await Promise.all(Array.from({length:4},()=>processWebhook('charge.success:'+reference)));
      assert.equal((await db.query("SELECT count(*)::text n FROM ledger_transactions WHERE type='topup'")).rows[0].n,'1');
    });
    await t.test('provider pending retains reservation; reordered success/failed events use current evidence',async()=>{
      const w=await fixture();
      assert.equal((await applyWithdrawalOutcome(w.reference)).status,'processing');assert.equal(await balance(w.earnings),49500);
      phase='success';
      const event={event:'transfer.failed',data:{domain:'test',reference:w.reference}};
      assert.equal((await send(event)).status,200);
      await Promise.all(Array.from({length:3},()=>processWebhook('transfer.failed:'+w.reference)));
      assert.equal((await db.query('SELECT status FROM withdrawals WHERE id=$1',[w.id])).rows[0].status,'success');
      assert.equal((await db.query("SELECT amount_kobo::text FROM ledger_entries e JOIN ledger_transactions l ON l.id=e.transaction_id WHERE l.idempotency_key=$1 AND e.direction='debit'",[`withdrawal:${w.id}:gateway_fee`])).rows[0].amount_kobo,'1234');
      phase='failed';await assert.rejects(applyWithdrawalOutcome(w.reference),/transfer_terminal_conflict/);assert.equal(await balance(w.earnings),49500);
      await db.query("UPDATE driver_profiles SET status='rejected' WHERE user_id=$1",[w.user]);
      phase='reversed';await Promise.all(Array.from({length:3},()=>applyWithdrawalOutcome(w.reference)));
      assert.equal(await balance(w.earnings),100000);
      assert.equal((await db.query('SELECT count(*)::text n FROM ledger_transactions WHERE idempotency_key=$1',[`withdrawal:${w.id}:reversal`])).rows[0].n,'1');
      phase='success';await assert.rejects(applyWithdrawalOutcome(w.reference),/transfer_terminal_conflict/);assert.equal(await balance(w.earnings),100000);
    });
    await t.test('mismatched amount, recipient, mode and absent fee cannot settle',async()=>{
      const w=await fixture();phase='success';
      amount=50001;await assert.rejects(applyWithdrawalOutcome(w.reference),/transfer_verification_mismatch/);amount=50000;
      recipient='RCP_wrong';await assert.rejects(applyWithdrawalOutcome(w.reference),/transfer_verification_mismatch/);recipient='RCP_recovery';
      domain='live';await assert.rejects(applyWithdrawalOutcome(w.reference),/transfer_verification_mismatch/);domain='test';
      fee=null;await assert.rejects(applyWithdrawalOutcome(w.reference),/transfer_fee_evidence_missing/);fee=1234;
      assert.equal(await balance(w.earnings),49500);assert.equal((await db.query('SELECT final_tx_id FROM withdrawals WHERE id=$1',[w.id])).rows[0].final_tx_id,null);
      phase='failed';await applyWithdrawalOutcome(w.reference);assert.equal(await balance(w.earnings),100000);
    });
    await t.test('uncertain initiation, concurrent jobs and verification outage never send a second transfer',async()=>{
      const w=await fixture();phase='pending';posts=0;
      let release!:()=>void;const wait=new Promise<void>(done=>{release=done;});let entered!:()=>void;const started=new Promise<void>(done=>{entered=done;});
      gateway.initiateTransfer=async()=>{posts++;entered();await wait;throw new PaystackRequestError(0,'unavailable');};
      const first=initiatePayout(w.id);await started;await initiatePayout(w.id);release();await assert.rejects(first,/paystack_unavailable/);
      assert.equal((await db.query('SELECT attempts FROM withdrawals WHERE id=$1',[w.id])).rows[0].attempts,1);
      unavailable=true;await assert.rejects(initiatePayout(w.id),/paystack_unavailable/);assert.equal(posts,1);
      await db.query("UPDATE withdrawals SET updated_at=now()-interval '20 minutes' WHERE id=$1",[w.id]);await reconcileWithdrawals();assert.equal(posts,1);
      unavailable=false;await initiatePayout(w.id);assert.equal(posts,1);
      phase='success';await applyWithdrawalOutcome(w.reference);
    });
    await t.test('insufficient or unavailable provider float cannot reserve more earnings or consume OTP',async()=>{
      const w=await fixture();const phone=(await db.query<{phone:string}>('SELECT phone FROM users WHERE id=$1',[w.user])).rows[0].phone;
      await db.query('UPDATE payment_settings SET min_withdrawal_kobo=10000 WHERE id=true');
      const payout=(await db.query<{payout_account_id:string}>('SELECT payout_account_id FROM withdrawals WHERE id=$1',[w.id])).rows[0].payout_account_id;
      const otp='123456';const code=(await db.query<{id:string}>("INSERT INTO otp_codes(phone,code_hash,purpose,expires_at) VALUES($1,$2,'withdrawal',now()+interval '5 minutes') RETURNING id",[phone,createHash('sha256').update(otp).digest('hex')])).rows[0].id;
      gateway.getBalance=async()=>0;
      await assert.rejects(requestWithdrawal(w.user,payout,20000,otp),/provider_payout_funds_unavailable/);
      gateway.getBalance=async()=>{throw new PaystackRequestError(0,'unavailable');};
      await assert.rejects(requestWithdrawal(w.user,payout,20000,otp),/paystack_unavailable/);
      assert.equal(await balance(w.earnings),49500);assert.equal((await db.query('SELECT consumed_at FROM otp_codes WHERE id=$1',[code])).rows[0].consumed_at,null);
      gateway.getBalance=originalBalance;
    });
    await t.test('provider access restrictions remain explicit and cannot mark reserved funds paid',async()=>{
      const w=await fixture();gateway.initiateTransfer=async()=>{throw new PaystackRequestError(400,'access_denied');};
      await assert.rejects(initiatePayout(w.id),/paystack_access_denied/);
      const row=(await db.query('SELECT status,failure_reason,final_tx_id FROM withdrawals WHERE id=$1',[w.id])).rows[0];
      assert.equal(row.status,'pending');assert.equal(row.failure_reason,'provider_transfer_access_denied');assert.equal(row.final_tx_id,null);assert.equal(await balance(w.earnings),49500);
    });
    await t.test('confirmed provider not-found retries the identical reference; OTP stays reserved',async()=>{
      const w=await fixture();await db.query('UPDATE withdrawals SET attempts=1 WHERE id=$1',[w.id]);notFound=true;posts=0;
      gateway.initiateTransfer=async(input)=>{posts++;assert.equal(input.reference,w.reference);notFound=false;phase='otp';return {status:'otp',transferCode:'TRF_'+w.reference};};
      await initiatePayout(w.id);await initiatePayout(w.id);assert.equal(posts,1);
      const row=(await db.query('SELECT status,failure_reason FROM withdrawals WHERE id=$1',[w.id])).rows[0];assert.equal(row.status,'processing');assert.equal(row.failure_reason,'provider_transfer_otp');assert.equal(await balance(w.earnings),49500);
      phase='failed';await applyWithdrawalOutcome(w.reference);assert.equal(await balance(w.earnings),100000);
    });
    assert.deepEqual(await checkLedgerIntegrity(),[]);
  } finally {
    gateway.verifyCharge=originalCharge;gateway.verifyTransfer=originalTransfer;gateway.initiateTransfer=originalInitiate;gateway.getBalance=originalBalance;
    if(server)await new Promise<void>(done=>server!.close(()=>done()));
    await stopPaymentWorkers();const {stopTripWorkers}=await import('../trips/tripQueue.js');await stopTripWorkers();const {redis}=await import('../../shared/config/redis.js');await redis?.quit();await db.end();
  }
 } finally {await scoped.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});

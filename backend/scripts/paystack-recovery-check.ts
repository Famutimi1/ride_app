/** Real TEST charge, simulated missing notification, entirely disposable database.
 * Provider calls are GET-only; never changes an operational ledger. */
import dotenv from 'dotenv';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Client} from 'pg';
dotenv.config({quiet:true});
async function main(){
 if(process.env.NODE_ENV==='production'||!process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')||process.env.PAYSTACK_SECRET_KEY.includes('fixture'))throw new Error('Actual test-mode provider configuration only.');
 const reference=process.argv[2];if(!/^tu_[a-f0-9]{32}$/.test(reference??''))throw new Error('An explicitly authorized test charge reference is required.');
 const adminUrl=new URL(process.env.TEST_DATABASE_ADMIN_URL??process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1','[::1]'].includes(adminUrl.hostname))throw new Error('Local test database administrator only.');
 const name=`rakky_paystack_recovery_${randomBytes(8).toString('hex')}`,url=new URL(adminUrl);url.pathname='/'+name;url.searchParams.delete('options');
 const admin=new Client({connectionString:adminUrl.toString()});let created=false;let close:(()=>Promise<void>)|undefined;
 try{
  await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
  const seed=new Client({connectionString:url.toString()});await seed.connect();try{for(const file of ['001_auth.sql','002_trip_system.sql','003_payments_ledger.sql'])await seed.query(await readFile(resolve('migrations',file),'utf8'));}finally{await seed.end();}
  Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:url.toString(),REDIS_URL:'',PAYSTACK_BASE_URL:'https://api.paystack.co',ENABLE_LIVE_PAYMENTS:'false',ENABLE_ADMIN_MONEY_ACTIONS:'false',ALERT_WEBHOOK_URL:''});
  const {db}=await import('../src/shared/config/db.js');close=()=>db.end();
  const {reconcileTopups,checkLedgerIntegrity}=await import('../src/modules/payments/reconciliation.service.js');
  const user=(await db.query<{id:string}>("INSERT INTO users(full_name) VALUES('Isolated missing-webhook fixture') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO payment_intents(user_id,target,amount_kobo,provider_reference,created_at,updated_at) VALUES($1,'wallet',500000,$2,now()-interval '1 hour',now()-interval '1 hour')",[user,reference]);
  await reconcileTopups();await reconcileTopups();
  const intent=(await db.query('SELECT status,amount_kobo::text,fee_kobo::text,ledger_transaction_id FROM payment_intents WHERE provider_reference=$1',[reference])).rows[0];
  const counts=(await db.query("SELECT (SELECT count(*)::text FROM ledger_transactions WHERE type='topup') postings,(SELECT count(*)::text FROM payment_webhook_events) receipts")).rows[0];
  const balances=(await db.query("SELECT kind,code,balance_kobo::text FROM ledger_accounts WHERE code IN ('gateway_balance','expense_gateway_fees') OR owner_user_id=$1",[user])).rows;
  const problems=await checkLedgerIntegrity();
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),mode:'test',providerVerification:'actual',missingNotification:'simulated_in_separate_disposable_database',intent,counts,balances,integrity:problems}));
  if(intent.status!=='succeeded'||counts.postings!=='1'||counts.receipts!=='0'||problems.length)throw new Error('Recovery evidence failed.');
 }finally{await close?.();if(created){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[name]);await admin.query(`DROP DATABASE "${name}"`);}await admin.end();console.log('Disposed the missing-webhook verification database.');}
}
main().catch(()=>{console.error('Test charge recovery verification failed; no operational database is used.');process.exitCode=1;});

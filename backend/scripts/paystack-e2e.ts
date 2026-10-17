/** Explicitly authorized external TEST-mode exercise. Never uses the app database.
 * Starts a separate disposable DB/Redis/backend and installed Cloudflare tunnel.
 * No live keys, real contacts/accounts, staff credentials or production data.
 */
import dotenv from 'dotenv';
import {spawn,type ChildProcess} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import type {AddressInfo} from 'node:net';
import {createInterface} from 'node:readline';
import {Client} from 'pg';

dotenv.config({quiet:true});
const sleep=(ms:number)=>new Promise<void>(done=>setTimeout(done,ms));
const port=async()=>{const s=createServer();await new Promise<void>(done=>s.listen(0,'127.0.0.1',done));const p=(s.address() as AddressInfo).port;await new Promise<void>(done=>s.close(()=>done()));return p;};
const stop=async(child:ChildProcess|undefined)=>{if(!child||child.exitCode!==null||child.signalCode!==null)return;const ended=new Promise<void>(done=>child.once('exit',()=>done()));child.kill('SIGTERM');await ended;};
async function main(){
 if(process.env.NODE_ENV==='production'||!process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')||process.env.PAYSTACK_SECRET_KEY.includes('fixture'))throw new Error('External E2E requires actual test-mode Paystack credentials and non-production mode.');
 if(process.env.RAKKY_ALLOW_EXTERNAL_TEST!=='true')throw new Error('Set RAKKY_ALLOW_EXTERNAL_TEST=true only after the owner authorizes this temporary public test.');
 const adminUrl=new URL(process.env.TEST_DATABASE_ADMIN_URL??process.env.DATABASE_URL??'');
 if(!['localhost','127.0.0.1','[::1]'].includes(adminUrl.hostname))throw new Error('Only a local test database administrator is allowed.');
 const name=`rakky_paystack_e2e_${randomBytes(8).toString('hex')}`;
 const url=new URL(adminUrl);url.pathname='/'+name;url.searchParams.delete('options');
 const admin=new Client({connectionString:adminUrl.toString()});let created=false;
 const directory=await mkdtemp(join(tmpdir(),'rakky-paystack-e2e-'));
 let redisChild:ChildProcess|undefined,backend:ChildProcess|undefined,tunnel:ChildProcess|undefined;
 let cleanupServices:(()=>Promise<void>)|undefined;
 const cli=createInterface({input:process.stdin});const commands=cli[Symbol.asyncIterator]();let closing=false;
 const end=()=>{closing=true;cli.close();};process.once('SIGINT',end);process.once('SIGTERM',end);
 const expiry=setTimeout(end,30*60*1000);expiry.unref();
 try{
  await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
  const seed=new Client({connectionString:url.toString()});await seed.connect();
  try {for(const file of (await readdir(resolve('migrations'))).filter(x=>/^\d+.*\.sql$/.test(x)).sort()) {await seed.query('BEGIN');try{await seed.query(await readFile(resolve('migrations',file),'utf8'));await seed.query('COMMIT');}catch(error){await seed.query('ROLLBACK');throw error;}}}finally{await seed.end();}
  const redisPort=await port(),apiPort=await port();
  const runtime={...process.env,NODE_ENV:'test',DATABASE_URL:url.toString(),REDIS_URL:`redis://127.0.0.1:${redisPort}`,PORT:String(apiPort),PAYSTACK_BASE_URL:'https://api.paystack.co',JWT_ACCESS_SECRET:randomBytes(32).toString('hex'),ENABLE_ADMIN_MONEY_ACTIONS:'false',ENABLE_LIVE_PAYMENTS:'false',TERMII_API_KEY:'',ALERT_WEBHOOK_URL:'',TRIP_QUEUE_PREFIX:'e2e',GOOGLE_CLIENT_ID_WEB:'',GOOGLE_CLIENT_ID_IOS:'',GOOGLE_CLIENT_ID_ANDROID:''};
  Object.assign(process.env,runtime);
  redisChild=spawn('redis-server',['--bind','127.0.0.1','--port',String(redisPort),'--save','','--appendonly','no','--dir',directory],{stdio:'ignore'});
  await sleep(300);
  backend=spawn(process.execPath,['dist/index.js'],{env:runtime,stdio:['ignore','pipe','pipe']});
  const local=`http://127.0.0.1:${apiPort}`;
  let ready=false;for(let i=0;i<60&&!closing;i++){try{ready=(await fetch(local+'/api/health/ready',{signal:AbortSignal.timeout(1000)})).status===200;if(ready)break;}catch{}if(backend.exitCode!==null)throw new Error('Isolated backend failed startup.');await sleep(250);}
  if(!ready)throw new Error('Isolated backend did not become ready.');
  let publicOrigin='';
  tunnel=spawn('cloudflared',['tunnel','--url',local,'--no-autoupdate','--protocol','http2'],{stdio:['ignore','pipe','pipe']});
  const scan=(data:Buffer)=>{const found=data.toString().match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/);if(found)publicOrigin=found[0];if(data.toString().includes('Registered tunnel connection'))console.log(JSON.stringify({state:'tunnel_connected'}));};
  tunnel.stdout?.on('data',scan);tunnel.stderr?.on('data',scan);
  for(let i=0;i<120&&!publicOrigin&&!closing;i++){if(tunnel.exitCode!==null)throw new Error('Approved temporary tunnel failed.');await sleep(250);}
  if(!publicOrigin)throw new Error('Temporary webhook origin was not issued.');
  // Parent services use the same isolated configuration. No fixture identity is exposed.
  const {db}=await import('../src/shared/config/db.js');
  const {env}=await import('../src/config/env.js');
  const {gateway}=await import('../src/modules/payments/gateway.js');
  const {createTopup}=await import('../src/modules/payments/topups.service.js');
  const {requestWithdrawal}=await import('../src/modules/payments/withdrawals.service.js');
  const {checkLedgerIntegrity}=await import('../src/modules/payments/reconciliation.service.js');
  cleanupServices=async()=>{const {stopPaymentWorkers}=await import('../src/modules/payments/paymentQueue.js');await stopPaymentWorkers();const {redis}=await import('../src/shared/config/redis.js');await redis?.quit();await db.end();};
  const phone='+2348000000999';
  const user=(await db.query<{id:string}>("INSERT INTO users(full_name,email,phone,phone_verified_at) VALUES('Paystack isolated test','rakky-paystack-test@example.com',$1,now()) RETURNING id",[phone])).rows[0].id;
  await db.query("INSERT INTO driver_profiles(user_id,status) VALUES($1,'approved')",[user]);
  console.log(JSON.stringify({state:'ready',publicOrigin,webhookUrl:publicOrigin+'/webhooks/paystack',mode:'test',isolated:true,manualMoneyEnabled:false,temporaryDatabase:name}));
  let checkout:Awaited<ReturnType<typeof createTopup>>|undefined,withdrawal:Awaited<ReturnType<typeof requestWithdrawal>>|undefined;
  for await(const line of commands){
   try{
    const command=line.trim();
    if(command==='stop')break;
    if(command==='checkout'){
     // Override only the isolated callback, not any operational environment file.
     (env as {PAYMENT_CALLBACK_URL:string}).PAYMENT_CALLBACK_URL=publicOrigin+'/';
     checkout??=await createTopup(user,500000,'earnings');console.log(JSON.stringify({state:'checkout',...checkout}));
    }else if(command==='transfer'){
     if(!checkout||(await db.query('SELECT status FROM payment_intents WHERE provider_reference=$1',[checkout.reference])).rows[0]?.status!=='succeeded')throw new Error('Wait for the actual charge-success webhook before the test transfer.');
     if(!withdrawal){
      const recipient=await gateway.createRecipient({name:'Paystack test fixture',accountNumber:'0000000000',bankCode:'057'});
      const payout=(await db.query<{id:string}>("INSERT INTO payout_accounts(user_id,bank_code,bank_name,account_last4,account_name,recipient_code) VALUES($1,'057','Paystack documented test bank','0000','Paystack test fixture',$2) RETURNING id",[user,recipient.recipientCode])).rows[0].id;
      const otp='123456';await db.query("INSERT INTO otp_codes(phone,code_hash,purpose,expires_at) VALUES($1,$2,'withdrawal',now()+interval '5 minutes')",[phone,createHash('sha256').update(otp).digest('hex')]);
      withdrawal=await requestWithdrawal(user,payout,100000,otp);
     }
     console.log(JSON.stringify({state:'test_transfer',...withdrawal}));
    }else if(command==='evidence'){
     const intents=(await db.query('SELECT provider_reference AS reference,status,amount_kobo::text,fee_kobo::text,ledger_transaction_id FROM payment_intents')).rows;
     const withdrawals=(await db.query('SELECT provider_reference AS reference,status,attempts,failure_reason,request_tx_id,final_tx_id FROM withdrawals')).rows;
     const events=(await db.query('SELECT event_type,status,received_at,processed_at FROM payment_webhook_events ORDER BY received_at')).rows;
     const accounts=(await db.query("SELECT code,balance_kobo::text FROM ledger_accounts WHERE code IN ('gateway_balance','payout_in_transit','expense_gateway_fees','revenue_fees') OR owner_user_id=$1",[user])).rows;
     const evidence={checkedAt:new Date().toISOString(),mode:'test',external:true,isolated:true,intents,withdrawals,events,accounts,integrity:await checkLedgerIntegrity()};
     await writeFile(join(directory,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify(evidence));
    }else console.log(JSON.stringify({commands:['checkout','transfer','evidence','stop']}));
   }catch(error){console.log(JSON.stringify({state:'command_failed',category:error instanceof Error?error.message:'failed'}));}
  }
 }finally{
  clearTimeout(expiry);cli.close();process.removeListener('SIGINT',end);process.removeListener('SIGTERM',end);
  await stop(tunnel);await stop(backend);await cleanupServices?.();await stop(redisChild);
  if(created){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[name]);await admin.query(`DROP DATABASE "${name}"`);}await admin.end();await rm(directory,{recursive:true,force:true});
  console.log(JSON.stringify({state:'cleaned',temporaryDatabaseDropped:created,tunnelClosed:true}));
 }
}
main().catch(()=>{console.error('External test setup failed; inspect authorized local setup without exposing secrets.');process.exitCode=1;});

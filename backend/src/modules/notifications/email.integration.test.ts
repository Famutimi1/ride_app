import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { Pool } from 'pg';
import type { EmailRow } from './email.types';

test('transactional email uses committed events, safe retries and authenticated administration', {skip:process.env.RAKKY_TEST_ISOLATED!=='true'},async t=>{
  const originalDatabase=process.env.DATABASE_URL!;
  const owner=new Pool({connectionString:originalDatabase});
  const schema=`email_test_${process.pid}_${Date.now()}`;
  await owner.query(`CREATE SCHEMA ${schema}`);
  const scoped=new URL(originalDatabase);scoped.searchParams.set('options',`-c search_path=${schema},public`);
  process.env.DATABASE_URL=scoped.toString();
  Object.assign(process.env,{EMAIL_ENABLED:'true',EMAIL_FROM:'Rakky Ride <no-reply@example.test>',EMAIL_REPLY_TO:'support@example.test',EMAIL_ADMIN_RECIPIENTS:'admin@example.test,owner@example.test',
    RESEND_API_KEY:'re_fixture_not_real',RESEND_WEBHOOK_SECRET:`whsec_${Buffer.from('fixture-webhook-key').toString('base64')}`,EMAIL_DASHBOARD_URL:'https://dashboard.example.test'});
  const {db,inTransaction}=await import('../../shared/config/db.js');
  const {redis}=await import('../../shared/config/redis.js');
  let server:ReturnType<import('express').Express['listen']>|undefined;
  const privateUsers:string[]=[];
  try{
    for(const file of (await readdir(resolve('migrations'))).filter(name=>/^\d+_.*\.sql$/.test(name)).sort())await db.query(await readFile(resolve('migrations',file),'utf8'));
    const emails=await import('./email.service.js');
    const admin=await import('./emailAdmin.service.js');
    const {processEmail}=await import('./emailQueue.js');
    const {env}=await import('../../config/env.js');
    const auth=await import('../auth/auth.service.js');
    const {signPhoneVerificationToken,signAccessToken}=await import('../auth/jwt.service.js');
    const {createApp}=await import('../../app.js');
    const requests:Array<{id:string;body:Record<string,unknown>}>=[];
    let sendMode:'success'|'rate_limit'|'timeout'|'denied'='success';
    t.mock.method(globalThis,'fetch',async (url:unknown,options?:RequestInit)=>{
      assert.equal(String(url),'https://api.resend.com/emails','No non-fixture network calls are allowed');
      const id=new Headers(options?.headers).get('Idempotency-Key')!;
      requests.push({id,body:JSON.parse(String(options?.body))});
      if(sendMode==='timeout')throw new Error('connection lost; private data must not be logged');
      if(sendMode==='rate_limit')return new Response('{}',{status:429});
      if(sendMode==='denied')return new Response('{"message":"private recipient"}',{status:403});
      return new Response(JSON.stringify({id:randomUUID()}),{status:200,headers:{'Content-Type':'application/json'}});
    });
    let phoneIndex=0;
    const code='418629';
    const otp=async(phone:string,purpose='registration')=>db.query("INSERT INTO otp_codes(phone,purpose,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')",[phone,purpose,createHash('sha256').update(code).digest('hex')]);
    const register=async(accountType:'rider'|'driver',email?:string)=>{
      const phone=`+2348099${String(++phoneIndex).padStart(6,'0')}`;
      await otp(phone);
      return auth.verifyRegistration({fullName:'Email fixture',phone,code,accountType,email},'fixture');
    };
    const rowsFor=async(userId:string)=>(await db.query<EmailRow>('SELECT * FROM email_outbox WHERE user_id=$1 ORDER BY audience,created_at',[userId])).rows;
    const seed=async(email:string|null=null,role='user')=>(await db.query<{id:string;full_name:string;email:string|null}>('INSERT INTO users(full_name,email,role) VALUES($1,$2,$3) RETURNING id,full_name,email',['Fixture user',email,role])).rows[0];
    const customerEmail=async(userId:string,key=randomUUID())=>{
      await inTransaction(client=>emails.queueCustomerEmail(client,userId,key,'welcome_rider',{}));
      return (await db.query<EmailRow>('SELECT * FROM email_outbox WHERE user_id=$1 AND event_key=$2',[userId,key])).rows[0];
    };
    let riderId='';
    await t.test('phone signup without email still alerts each admin; optional email gets role-specific welcome',async()=>{
      const rider=await register('rider');riderId=rider.user.id;
      const rows=await rowsFor(riderId);
      assert.equal(rows.length,3);
      assert.equal(rows.filter(row=>row.audience==='admin'&&row.status==='queued').length,2);
      assert.equal(rows.find(row=>row.audience==='customer')?.status,'waiting_email');
      const driver=await register('driver','DRIVER@example.test');
      assert.equal(driver.user.email,'driver@example.test');
      assert.equal((await rowsFor(driver.user.id)).find(row=>row.audience==='customer')?.template,'welcome_driver');
      const before=(await rowsFor(driver.user.id)).length;
      await inTransaction(client=>emails.queueSignupEmails(client,{id:driver.user.id,full_name:driver.user.name,email:driver.user.email},'driver'));
      assert.equal((await rowsFor(driver.user.id)).length,before);
      await assert.rejects(register('rider','invalid'),{code:'invalid_email'});
    });
    await t.test('Google phone verification uses the verified account email; later logins do not send welcome again',async()=>{
      const user=await seed('google@example.test');
      await db.query('UPDATE users SET google_id=$2 WHERE id=$1',[user.id,'verified-google-subject']);
      assert.equal((await rowsFor(user.id)).length,0);
      const phone=`+2348099${String(++phoneIndex).padStart(6,'0')}`;await otp(phone);
      await auth.verifyRegistration({phone,code,accountType:'driver',phoneVerificationToken:signPhoneVerificationToken(user.id),email:'attacker@example.test'},'fixture');
      const welcome=(await rowsFor(user.id)).find(row=>row.audience==='customer')!;
      assert.equal(welcome.recipient,'google@example.test');assert.equal(welcome.template,'welcome_driver');
      await otp(phone,'login');await auth.verifyLogin(phone,code,'fixture');
      assert.equal((await rowsFor(user.id)).length,3);
    });
    await t.test('transaction rollback leaves no email; adding an address resolves the saved welcome once',async()=>{
      const key=randomUUID();
      await assert.rejects(inTransaction(async client=>{await emails.queueCustomerEmail(client,riderId,key,'welcome_rider',{});throw new Error('rollback fixture');}));
      assert.equal((await db.query('SELECT id FROM email_outbox WHERE event_key=$1',[key])).rowCount,0);
      await inTransaction(client=>auth.updateProfile(riderId,{email:'added@example.test'},client));
      const welcome=(await rowsFor(riderId)).find(row=>row.audience==='customer')!;
      assert.equal(welcome.recipient,'added@example.test');assert.equal(welcome.status,'queued');
      await inTransaction(client=>auth.updateProfile(riderId,{email:'added@example.test'},client));
      assert.equal((await rowsFor(riderId)).length,3);
    });
    await t.test('concurrent workers claim once, freeze branded content, and distinguish acceptance from delivery',async()=>{
      const row=await customerEmail(riderId);const before=requests.length;
      await Promise.all([processEmail(row.id),processEmail(row.id)]);
      assert.equal(requests.length-before,1);
      const saved=(await db.query<EmailRow>('SELECT * FROM email_outbox WHERE id=$1',[row.id])).rows[0];
      assert.equal(saved.status,'accepted');assert.equal(saved.delivered_at,null);
      assert.ok(saved.request?.html.includes('/brand/rakky-ride-logo.png'));
      assert.ok(saved.request?.html.includes('https://dashboard.example.test/open-app?path=%2Fhome'));
      assert.equal(requests.at(-1)?.id,`rakky-email/${row.id}`);
    });
    await t.test('temporary provider failures reuse identical request content and idempotency key',async()=>{
      const row=await customerEmail(riderId);sendMode='rate_limit';await processEmail(row.id);
      assert.equal((await db.query('SELECT status,last_error FROM email_outbox WHERE id=$1',[row.id])).rows[0].status,'queued');
      const first=requests.at(-1)!;
      await db.query('UPDATE email_outbox SET next_attempt_at=now() WHERE id=$1',[row.id]);sendMode='success';await processEmail(row.id);
      assert.deepEqual(requests.at(-1),first);
      sendMode='denied';const denied=await customerEmail(riderId);await processEmail(denied.id);
      const failure=(await db.query('SELECT status,retryable,last_error FROM email_outbox WHERE id=$1',[denied.id])).rows[0];
      assert.deepEqual(failure,{status:'failed',retryable:false,last_error:'resend_http_403'});sendMode='success';
    });
    await t.test('ambiguous delivery and the retry-window boundary never trigger blind retransmission',async()=>{
      const row=await customerEmail(riderId);sendMode='timeout';await processEmail(row.id);
      await db.query("UPDATE email_outbox SET first_attempt_at=now()-interval '24 hours',next_attempt_at=now() WHERE id=$1",[row.id]);
      const before=requests.length;await processEmail(row.id);assert.equal(requests.length,before);
      assert.equal((await db.query('SELECT status FROM email_outbox WHERE id=$1',[row.id])).rows[0].status,'uncertain');
      sendMode='success';
    });
    await t.test('disabled sender, changed recipients, inactive accounts and suppression cannot be bypassed',async()=>{
      const user=await seed('guard@example.test');const row=await customerEmail(user.id);
      const mutable=env as unknown as {EMAIL_ENABLED:boolean};mutable.EMAIL_ENABLED=false;
      const before=requests.length;await processEmail(row.id);assert.equal(requests.length,before);mutable.EMAIL_ENABLED=true;
      await db.query('UPDATE users SET email=$2 WHERE id=$1',[user.id,'changed@example.test']);await processEmail(row.id);
      assert.equal((await db.query('SELECT status FROM email_outbox WHERE id=$1',[row.id])).rows[0].status,'skipped');
      const blocked=await customerEmail(user.id);await db.query("UPDATE email_outbox SET status='bounced' WHERE id=$1",[blocked.id]);
      const suppressed=await customerEmail(user.id);await processEmail(suppressed.id);
      assert.equal((await db.query('SELECT status FROM email_outbox WHERE id=$1',[suppressed.id])).rows[0].status,'suppressed');
      const inactive=await seed('inactive@example.test');const pending=await customerEmail(inactive.id);await db.query('UPDATE users SET is_active=false WHERE id=$1',[inactive.id]);await processEmail(pending.id);
      assert.equal((await db.query('SELECT status FROM email_outbox WHERE id=$1',[pending.id])).rows[0].status,'skipped');
    });
    await t.test('driver submission and mixed service review queue accurate mail without internal notes or replay duplicates',async()=>{
      const driver=await seed('application@example.test');privateUsers.push(driver.id);
      const staff=await seed('reviewer@example.test','super_admin');
      const services=await import('../matching/serviceEligibility.js');
      const driverService=await import('../driver/driver.service.js');
      const reviews=await import('../driver/admin.service.js');
      await inTransaction(client=>driverService.savePersonalInfo(driver.id,{fullName:'Driver fixture',email:driver.email,address:'Lekki fixture address'},client));
      await inTransaction(client=>driverService.saveVehicleInfo(driver.id,{make:'Toyota',model:'Corolla',color:'Silver',registrationNumber:'FIXTURE',year:2020},client));
      const bytes=Buffer.from('%PDF-1.4\n% Test evidence\n');const file={buffer:bytes,mimetype:'application/pdf',size:bytes.length} as Express.Multer.File;
      await inTransaction(client=>driverService.saveDocuments(driver.id,{license:[file],vehicleRegistration:[file],insurance:[file]},client));
      await inTransaction(client=>services.submitServiceApplication(driver.id,{services:['ride','courier'],vehicleCategory:'car',consentAccepted:true,consentVersion:services.SERVICE_CONSENT_VERSION,expectedVersion:0},client));
      await inTransaction(client=>driverService.submitApplication(driver.id,client));
      await inTransaction(client=>driverService.submitApplication(driver.id,client));
      assert.equal((await rowsFor(driver.id)).length,3,'repeat submission does not duplicate mail');
      const expectedVersion=(await db.query('SELECT updated_at::text AS version FROM driver_profiles WHERE user_id=$1',[driver.id])).rows[0].version;
      const input={decision:'approved',services:{ride:'approved',courier:'rejected'},vehicleCategory:'car',reason:'Private staff-only explanation',requestKey:randomUUID(),expectedVersion};
      await reviews.reviewAdminApplication(staff.id,driver.id,input);await reviews.reviewAdminApplication(staff.id,driver.id,input);
      const messages=(await rowsFor(driver.id)).filter(row=>row.template==='application_reviewed');assert.equal(messages.length,1);
      assert.deepEqual(messages[0].payload.services,[{name:'Passenger rides',status:'approved'},{name:'Courier deliveries',status:'rejected'}]);
      assert.ok(!JSON.stringify(messages[0].payload).includes(input.reason));
    });
    await t.test('selected wallet, receipt and support events mirror safely while private notes and live updates do not',async()=>{
      const {createNotificationRecord}=await import('./notifications.service.js');
      for(const type of ['topup_succeeded','withdrawal_requested','withdrawal_succeeded','withdrawal_failed','refund_posted','trip_completed','support_open','ride_offer','driver_arrived']){
        await inTransaction(client=>createNotificationRecord(client,{userId:riderId,type,eventKey:`test-event:${type}`,category:type.startsWith('support')?'support':'wallet_updates',title:'Private detail',body:'Private financial amount or staff note',data:{referenceId:'fixture-reference'}}));
      }
      const mirrored=(await rowsFor(riderId)).filter(row=>row.event_key.startsWith('activity:test-event:'));
      assert.equal(mirrored.length,7);assert.ok(mirrored.every(row=>!JSON.stringify(row.payload).includes('Private')));
    });
    await t.test('saved switches skip disabled types and queued mail without replaying a backlog',async()=>{
      const preferences=await import('./emailSettings.service.js');
      const ownerUser=await seed('preferences-owner@example.test','super_admin');
      const otherOwner=await seed('preferences-other@example.test','super_admin');
      const user=await seed('preferences-customer@example.test');
      const original=await preferences.getEmailSettings();
      const update=(enabled:boolean,rules:typeof original.rules,expectedVersion:number,actorId=ownerUser.id)=>preferences.saveEmailSettings(actorId,{enabled,rules,expectedVersion,reason:'Change test email preferences',requestKey:randomUUID()});
      try{
        assert.equal(original.enabled,true);assert.equal(Object.keys(original.rules).length,12);
        const pending=await customerEmail(user.id);
        const priorAttempt=await customerEmail(user.id);
        await db.query("UPDATE email_outbox SET first_attempt_at=now() WHERE id=$1",[priorAttempt.id]);
        const failed=await customerEmail(user.id);
        await db.query("UPDATE email_outbox SET status='failed',retryable=true,last_error='resend_http_429' WHERE id=$1",[failed.id]);
        const retryVersion=(await db.query('SELECT updated_at::text AS version FROM email_outbox WHERE id=$1',[failed.id])).rows[0].version;
        const input={enabled:true,rules:{...original.rules,welcome_rider:false},expectedVersion:original.version,reason:'Temporarily stop rider welcome mail',requestKey:randomUUID()};
        const saved=await preferences.saveEmailSettings(ownerUser.id,input);
        const replay=await preferences.saveEmailSettings(ownerUser.id,input);
        assert.equal(replay.auditId,saved.auditId);assert.equal(replay.settings.version,saved.settings.version);
        const statuses=(await rowsFor(user.id)).map(row=>({id:row.id,status:row.status}));
        assert.equal(statuses.find(row=>row.id===pending.id)?.status,'skipped');
        assert.equal(statuses.find(row=>row.id===priorAttempt.id)?.status,'uncertain');
        assert.equal((await customerEmail(user.id)).status,'skipped');
        await assert.rejects(admin.retryAdminEmail(ownerUser.id,failed.id,{expectedVersion:retryVersion,reason:'Attempt retry while type is disabled',requestKey:randomUUID()}),{code:'email_type_disabled'});
        const allowedKey=randomUUID();
        await inTransaction(client=>emails.queueCustomerEmail(client,user.id,allowedKey,'welcome_driver',{}));
        const allowed=(await db.query<EmailRow>('SELECT * FROM email_outbox WHERE event_key=$1',[allowedKey])).rows[0];
        const before=requests.length;await processEmail(allowed.id);assert.equal(requests.length,before+1);
        await update(true,original.rules,saved.settings.version);
        const beforeBacklog=requests.length;await processEmail(pending.id);assert.equal(requests.length,beforeBacklog);
        const current=await preferences.getEmailSettings();
        await update(false,current.rules,current.version);
        assert.equal((await customerEmail(user.id)).status,'skipped');
        await assert.rejects(admin.testAdminEmail(ownerUser.id,{reason:'Test sending while master switch is off',requestKey:randomUUID()}),{code:'email_disabled_in_preferences'});
        const paused=await preferences.getEmailSettings();
        const concurrent=await Promise.allSettled([
          update(true,paused.rules,paused.version),
          update(true,{...paused.rules,admin_signup:false},paused.version,otherOwner.id),
        ]);
        assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
        const rejected=concurrent.find(result=>result.status==='rejected');
        assert.equal(rejected?.status==='rejected'?rejected.reason.code:null,'email_settings_changed');
      }finally{
        const current=await preferences.getEmailSettings();await update(original.enabled,original.rules,current.version);
      }
    });
    // Restore native fetch for HTTP requests to the locally hosted application;
    // provider requests in the HTTP tests below are never dispatched.
    t.mock.restoreAll();
    server=createApp().listen(0,'127.0.0.1');await new Promise<void>(done=>server!.once('listening',done));
    const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const signedWebhook=async(event:object,invalid=false)=>{
      const body=JSON.stringify(event),id=`msg_${randomUUID()}`,timestamp=String(Math.floor(Date.now()/1000));
      const signature=createHmac('sha256',Buffer.from(env.RESEND_WEBHOOK_SECRET.slice(6),'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');
      return fetch(`${base}/webhooks/resend`,{method:'POST',headers:{'Content-Type':'application/json','svix-id':id,'svix-timestamp':timestamp,'svix-signature':invalid?'v1,invalid':`v1,${signature}`},body});
    };
    await t.test('signed callbacks resolve pre-response races, reject forgery and prevent terminal-state regression',async()=>{
      const row=await customerEmail(riderId);const providerId=randomUUID();
      await db.query("UPDATE email_outbox SET status='sending',request=$2,first_attempt_at=now(),lease_token=$3,lease_until=now()+interval '2 minutes' WHERE id=$1",[row.id,{fixture:true},randomUUID()]);
      const event={type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:providerId,to:[row.recipient],tags:{outbox_id:row.id}}};
      assert.equal((await signedWebhook(event,true)).status,400);
      assert.equal((await signedWebhook(event)).status,200);
      assert.equal((await signedWebhook(event)).status,200,'duplicate application is idempotent');
      assert.equal((await db.query('SELECT status FROM email_outbox WHERE id=$1',[row.id])).rows[0].status,'delivered');
      await signedWebhook({...event,type:'email.sent',created_at:new Date(Date.now()+1000).toISOString()});
      assert.equal((await db.query('SELECT status FROM email_outbox WHERE id=$1',[row.id])).rows[0].status,'delivered');
      await signedWebhook({...event,type:'email.complained'});await signedWebhook(event);
      assert.equal((await db.query('SELECT status FROM email_outbox WHERE id=$1',[row.id])).rows[0].status,'complained');
    });
    await t.test('staff APIs enforce scope, validate filters, mask recipients and audit retries/test sends',async()=>{
      const ownerUser=await seed('test-owner@example.test','super_admin');const staffUser=await seed('test-staff@example.test','admin');
      await db.query("INSERT INTO refresh_tokens(user_id,session_id,token_hash,session_scope,expires_at) SELECT id,id,id::text,'staff',now()+interval '12 hours' FROM users WHERE id IN ($1,$2)",[ownerUser.id,staffUser.id]);
      const token=(user:{id:string},scope:'staff'|'app')=>signAccessToken(user,scope,scope==='staff'?{id:user.id,startedAt:new Date()}:undefined);
      const get=(path:string,bearer?:string)=>fetch(`${base}/api/admin/emails${path}`,{headers:bearer?{Authorization:`Bearer ${bearer}`}:{}});
      const post=(path:string,bearer:string,body:object)=>fetch(`${base}/api/admin/emails${path}`,{method:'POST',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const ownerToken=token(ownerUser,'staff'),staffToken=token(staffUser,'staff');
      const patchPreferences=(bearer:string,body:object)=>fetch(`${base}/api/admin/emails/preferences`,{method:'PATCH',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const preferences=await (await get('/preferences',staffToken)).json() as {enabled:boolean;rules:Record<string,boolean>;version:number};
      const preferenceInput={enabled:preferences.enabled,rules:preferences.rules,expectedVersion:preferences.version,requestKey:randomUUID(),reason:'Verify saved preference access boundaries'};
      assert.equal((await patchPreferences(staffToken,preferenceInput)).status,403);
      assert.equal((await patchPreferences(token(ownerUser,'app'),preferenceInput)).status,403);
      assert.equal((await patchPreferences(ownerToken,{...preferenceInput,rules:{bad:true}})).status,400);
      assert.equal((await patchPreferences(ownerToken,{...preferenceInput,enabled:'false'})).status,400);
      assert.equal((await patchPreferences(ownerToken,{...preferenceInput,unexpected:true})).status,400);
      assert.equal((await patchPreferences(ownerToken,preferenceInput)).status,200);
      assert.equal((await get('')).status,401);assert.equal((await get('',token(ownerUser,'app'))).status,403);
      assert.equal((await get('?status=unknown',staffToken)).status,400);assert.equal((await get('?from=2026-02-31',staffToken)).status,400);
      const list=await (await get('',staffToken)).json() as {items:Array<{recipient:string}>};
      assert.ok(list.items.every(row=>!row.recipient.includes('@example.test')));
      const config=await (await get('/configuration',staffToken)).text();assert.ok(!config.includes(env.RESEND_API_KEY));assert.ok(!config.includes(env.RESEND_WEBHOOK_SECRET));
      const retry=await customerEmail(riderId);await db.query("UPDATE email_outbox SET status='failed',retryable=true,last_error='resend_http_429' WHERE id=$1",[retry.id]);
      const version=(await db.query('SELECT updated_at::text AS version FROM email_outbox WHERE id=$1',[retry.id])).rows[0].version;
      const input={expectedVersion:version,requestKey:randomUUID(),reason:'Retry a known rate-limit failure'};
      assert.equal((await post(`/${retry.id}/retry`,staffToken,input)).status,200);assert.equal((await post(`/${retry.id}/retry`,staffToken,input)).status,200);
      assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE action='email_retry' AND object_id=$1",[retry.id])).rows[0].count,1);
      assert.equal((await post('/test',staffToken,{reason:'Send configuration test',requestKey:randomUUID()})).status,403);
      assert.equal((await post('/test',ownerToken,{reason:'Send configuration test',requestKey:randomUUID(),recipient:'customer@example.test'})).status,400);
      for(let i=0;i<3;i++)assert.equal((await post('/test',ownerToken,{reason:'Verify configuration with admin recipients',requestKey:randomUUID()})).status,200);
      assert.equal((await post('/test',ownerToken,{reason:'Verify configuration with admin recipients',requestKey:randomUUID()})).status,429);
      assert.equal((await get(`/templates`,staffToken)).status,200);
    });
    await t.test('BullMQ recovers committed blocked mail, late admin configuration and an expired worker lease',async()=>{
      const {startEmailWorkers,stopEmailWorkers,emailQueueHealth}=await import('./emailQueue.js');
      const mutable=env as unknown as {EMAIL_ENABLED:boolean;EMAIL_ADMIN_RECIPIENTS:string[]};
      const recipients=mutable.EMAIL_ADMIN_RECIPIENTS;
      mutable.EMAIL_ENABLED=false;mutable.EMAIL_ADMIN_RECIPIENTS=[];
      const user=await seed('recovery@example.test');
      await inTransaction(client=>emails.queueSignupEmails(client,user,'rider'));
      const pending=await rowsFor(user.id);
      assert.ok(pending.some(row=>row.status==='waiting_admin'));assert.ok(pending.some(row=>row.status==='blocked'));
      mutable.EMAIL_ENABLED=true;mutable.EMAIL_ADMIN_RECIPIENTS=recipients;
      const stale=await customerEmail(user.id);
      const {renderEmail}=await import('./emailTemplates.js');
      const frozen={from:env.EMAIL_FROM,to:[user.email],...renderEmail('welcome_rider',{name:user.full_name}),tags:[{name:'outbox_id',value:stale.id}]};
      await db.query("UPDATE email_outbox SET status='sending',first_attempt_at=now()-interval '5 minutes',request=$2,lease_token=$3,lease_until=now()-interval '1 second' WHERE id=$1",[stale.id,frozen,randomUUID()]);
      const sent:Array<Record<string,unknown>>=[];
      t.mock.method(globalThis,'fetch',async(url:unknown,options?:RequestInit)=>{
        assert.equal(String(url),'https://api.resend.com/emails');sent.push(JSON.parse(String(options?.body)));
        return new Response(JSON.stringify({id:randomUUID()}),{status:200});
      });
      try{
        await startEmailWorkers();
        const deadline=Date.now()+5000;
        let saved:EmailRow[]=[];
        do{saved=await rowsFor(user.id);if(saved.filter(row=>row.status==='accepted').length===4)break;await new Promise(done=>setTimeout(done,25));}while(Date.now()<deadline);
        assert.equal(saved.filter(row=>row.status==='accepted').length,4);
        assert.ok(saved.some(row=>row.status==='skipped'&&row.last_error==='admin_recipients_resolved'));
        const recovered=sent.find(request=>(request.tags as Array<{name:string;value:string}>).some(tag=>tag.name==='outbox_id'&&tag.value===stale.id));
        assert.deepEqual(recovered,frozen);
        assert.equal((await emailQueueHealth()).state,'reachable');
      }finally{await stopEmailWorkers();t.mock.restoreAll();}
    });
  }finally{
    if(server)await new Promise<void>((done,reject)=>server!.close(error=>error?reject(error):done()));
    await (await import('../trips/tripQueue.js')).stopTripWorkers();
    await (await import('../payments/paymentQueue.js')).stopPaymentWorkers();
    await (await import('./notificationQueue.js')).stopNotificationWorkers();
    await (await import('./emailQueue.js')).stopEmailWorkers();
    t.mock.restoreAll();
    await redis?.quit();await db.end();await owner.query(`DROP SCHEMA ${schema} CASCADE`);await owner.end();
    await Promise.all(privateUsers.map(id=>rm(resolve('.private-uploads/driver-documents',id),{recursive:true,force:true})));
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes,createECDH} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {AddressInfo} from 'node:net';
import {Pool} from 'pg';
import express from 'express';
import webpush from 'web-push';

test('saved chat and browser push enforce identity, retries, browser ownership and revocation',{skip:!process.env.RAKKY_TEST_ISOLATED},async t=>{
  const schema=`browser_features_${process.pid}_${Date.now()}`,owner=new Pool({connectionString:process.env.DATABASE_URL});await owner.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
  const {db}=await import('../../shared/config/db.js'),originalQuery=db.query,originalConnect=db.connect;db.query=pool.query.bind(pool) as typeof db.query;db.connect=pool.connect.bind(pool) as typeof db.connect;
  let server:ReturnType<typeof express.application.listen>|undefined;
  try{
    for(const name of (await readdir(resolve('migrations'))).filter(n=>/^\d+_.*\.sql$/.test(n)).sort())await pool.query(await readFile(resolve('migrations',name),'utf8'));
    const users=(await pool.query<{id:string}>("INSERT INTO users(full_name) VALUES('Rider'),('Driver'),('Other user') RETURNING id")).rows;
    const sessions=[randomUUID(),randomUUID(),randomUUID()];for(const [i,user] of users.entries())await pool.query("INSERT INTO refresh_tokens(user_id,session_id,token_hash,session_scope,expires_at) VALUES($1,$2,$3,'app',now()+interval '1 day')",[user.id,sessions[i],randomBytes(48).toString('hex')]);
    const {signAccessToken}=await import('./jwt.service.js'),tokens=users.map((u,i)=>signAccessToken(u,'app',{id:sessions[i],startedAt:new Date()}));
    const {tripsRouter}=await import('../trips/trips.routes.js'),{notificationsRouter}=await import('../notifications/notifications.routes.js');
    const {paymentsRouter}=await import('../payments/payments.routes.js');const app=express();app.use(express.json());app.use('/payments',paymentsRouter);app.use('/trips',tripsRouter);app.use('/notifications',notificationsRouter);app.use((e:{status?:number;code?:string},_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(e.status??500).json({error:e.code??'internal_error'});});
    server=app.listen(0,'127.0.0.1');await new Promise<void>(done=>server!.once('listening',done));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request=(path:string,index=0,body?:object,method=body?'POST':'GET')=>fetch(base+path,{method,headers:{...(index>=0?{Authorization:`Bearer ${tokens[index]}`} :{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const trip=(await pool.query<{id:string}>("INSERT INTO trips(rider_id,driver_id,status,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key) VALUES($1,$2,'driver_assigned','cash',6.4,3.4,'Fixture pickup',6.5,3.5,'Fixture destination',1000,300,100000,'browser-feature-fixture') RETURNING id",[users[0].id,users[1].id])).rows[0].id;
    await t.test('withdrawal policy is authenticated, approval guarded and contains reviewable fees only',async()=>{
      assert.equal((await request('/payments/withdrawal-policy',-1)).status,401);assert.equal((await request('/payments/withdrawal-policy')).status,403);await pool.query("INSERT INTO driver_profiles(user_id,status) VALUES($1,'approved')",[users[1].id]);const response=await request('/payments/withdrawal-policy',1);assert.equal(response.status,200);const policy=await response.json();assert.deepEqual(Object.keys(policy).sort(),['maxDailyWithdrawalKobo','minWithdrawalKobo','newAccountCooldownHours','withdrawalFeeKobo']);assert.ok(Number.isSafeInteger(policy.withdrawalFeeKobo));
    });
    await t.test('messages survive reload, reject outsiders and deduplicate concurrent retries',async()=>{
      assert.equal((await request(`/trips/${trip}/messages`,-1)).status,401);assert.equal((await request(`/trips/${trip}/messages`,2)).status,404);
      const input={id:randomUUID(),text:'I am at the pickup entrance.',senderId:users[1].id,senderRole:'driver',sentAt:1};
      const replies=await Promise.all([request(`/trips/${trip}/messages`,0,input),request(`/trips/${trip}/messages`,0,input)]);for(const reply of replies)assert.ok([200,201].includes(reply.status),await reply.clone().text());
      const saved=await replies[0].json();assert.equal(saved.message.senderId,users[0].id);assert.equal(saved.message.senderRole,'rider');assert.ok(saved.message.sentAt>Date.now()-10000);
      assert.equal((await request(`/trips/${trip}/messages`,0,{...input,text:'A different message'})).status,409);
      assert.equal((await request(`/trips/${trip}/messages`,2,{id:randomUUID(),text:'Unauthorized'})).status,404);
      const history=await (await request(`/trips/${trip}/messages`,1)).json();assert.equal(history.messages.length,1);assert.equal(history.messages[0].recordId,saved.message.recordId);
      await pool.query("INSERT INTO trip_messages(trip_id,sender_id,sender_role,client_message_id,body) SELECT $1,$2,'driver','history-'||n,'Earlier message '||n FROM generate_series(1,55) AS n",[trip,users[1].id]);
      const latest=await (await request(`/trips/${trip}/messages`)).json();assert.equal(latest.messages.length,50);assert.ok(latest.nextBefore);
      const older=await (await request(`/trips/${trip}/messages?before=${latest.nextBefore}`)).json();assert.equal(older.messages.length,6);assert.equal(older.nextBefore,null);
      await pool.query("UPDATE trips SET status='completed' WHERE id=$1",[trip]);assert.equal((await request(`/trips/${trip}/messages`,0,{id:randomUUID(),text:'Too late to send'})).status,409);assert.equal((await request(`/trips/${trip}/messages`)).status,200);
    });
    const {env}=await import('../../config/env.js'),vapid=webpush.generateVAPIDKeys();Object.assign(env,{WEB_PUSH_PUBLIC_KEY:vapid.publicKey,WEB_PUSH_PRIVATE_KEY:vapid.privateKey,WEB_PUSH_SUBJECT:'mailto:test@example.test'});
    const service=await import('../notifications/webPush.service.js');
    const browserCurve=createECDH('prime256v1');browserCurve.generateKeys();const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/isolated-fixture',keys:{p256dh:browserCurve.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
    let registeredId='';
    await t.test('browser registration is account/session bound and rejects unsafe endpoints',async()=>{
      assert.equal((await request('/notifications/browser/config',-1)).status,401);const config=await (await request('/notifications/browser/config')).json();assert.equal(config.publicKey,vapid.publicKey);assert.equal(JSON.stringify(config).includes(vapid.privateKey),false);
      for(const endpoint of ['https://127.0.0.1/private','http://fcm.googleapis.com/x','https://fcm.googleapis.com:444/x','https://user:pass@fcm.googleapis.com/x','https://fcm.googleapis.com.evil.test/x'])assert.equal((await request('/notifications/browser/subscriptions',0,{...subscription,endpoint})).status,400);
      const registered=await request('/notifications/browser/subscriptions',0,subscription);assert.equal(registered.status,200,await registered.clone().text());const data=await registered.json();registeredId=data.id;assert.equal(data.enabled,true);assert.equal(JSON.stringify(data).includes(subscription.keys.auth),false);
      assert.equal((await (await request('/notifications/browser/status',0,{endpoint:subscription.endpoint})).json()).enabled,true);assert.equal((await (await request('/notifications/browser/status',2,{endpoint:subscription.endpoint})).json()).enabled,false);
      await request(`/notifications/browser/subscriptions/${registeredId}`,2,undefined,'DELETE');assert.equal((await (await request('/notifications/browser/status',0,{endpoint:subscription.endpoint})).json()).enabled,true);
    });
    await t.test('delivery respects preferences, has private payloads, skips successful retries and removes expired subscriptions',async()=>{
      const {createNotificationRecord}=await import('../notifications/notifications.service.js');let count=0,payload='';let statusCode=201;
      t.mock.method(service.browserPushProvider,'send',async(_subscription:unknown,body:string)=>{count++;payload=body;if(statusCode!==201)throw {statusCode};return {statusCode:201,headers:{},body:''};});
      const create=async(key:string)=>{const client=await pool.connect();try{return await createNotificationRecord(client,{userId:users[0].id,type:'trip_test',category:'trip_updates',eventKey:key,title:'Private trip test',body:'Sensitive addresses must not leave the account',data:{tripId:trip,audience:'rider'}});}finally{client.release();}};
      const notification=await create('browser:delivery');await service.processBrowserNotification(notification.record.id);assert.equal(count,1);assert.equal(payload.includes('Sensitive'),false);assert.equal(JSON.parse(payload).url,`/ride/trips/${trip}`);await service.processBrowserNotification(notification.record.id);assert.equal(count,1);
      const driverNotice=await create('browser:driver');await pool.query("UPDATE notifications SET data=jsonb_set(data,'{audience}','\"driver\"'::jsonb) WHERE id=$1",[driverNotice.record.id]);await service.processBrowserNotification(driverNotice.record.id);assert.equal(JSON.parse(payload).url,`/drive/trips/${trip}`);count=1;
      await pool.query('INSERT INTO notification_preferences(user_id,push_enabled) VALUES($1,false) ON CONFLICT(user_id) DO UPDATE SET push_enabled=false',[users[0].id]);const disabled=await create('browser:disabled');await service.processBrowserNotification(disabled.record.id);assert.equal(count,1);await pool.query('UPDATE notification_preferences SET push_enabled=true WHERE user_id=$1',[users[0].id]);
      statusCode=410;const gone=await create('browser:gone');await service.processBrowserNotification(gone.record.id);assert.equal(count,2);assert.equal((await (await request('/notifications/browser/status',0,{endpoint:subscription.endpoint})).json()).enabled,false);
      await request('/notifications/browser/subscriptions',0,subscription);statusCode=503;const failed=await create('browser:retry');await assert.rejects(service.processBrowserNotification(failed.record.id),/browser_push_delivery_retry/);statusCode=201;await service.processBrowserNotification(failed.record.id);assert.equal(count,4);
      await pool.query('UPDATE refresh_tokens SET revoked_at=now() WHERE session_id=$1',[sessions[0]]);const revoked=await create('browser:revoked');await service.processBrowserNotification(revoked.record.id);assert.equal(count,4);
    });
    await t.test('an endpoint changes ownership safely when another account enables this browser',async()=>{
      const response=await request('/notifications/browser/subscriptions',2,subscription);assert.equal(response.status,200);const result=await response.json();assert.equal(result.id,registeredId);assert.equal((await (await request('/notifications/browser/status',2,{endpoint:subscription.endpoint})).json()).enabled,true);await request(`/notifications/browser/subscriptions/${registeredId}`,2,undefined,'DELETE');assert.equal((await (await request('/notifications/browser/status',2,{endpoint:subscription.endpoint})).json()).enabled,false);
    });
  }finally{
    t.mock.restoreAll();server?.closeAllConnections();await new Promise<void>(done=>server?server.close(()=>done()):done());db.query=originalQuery;db.connect=originalConnect;await pool.end();await owner.query(`DROP SCHEMA ${schema} CASCADE`);await owner.end();const {redis}=await import('../../shared/config/redis.js');await redis?.quit();await db.end();const {stopTripWorkers}=await import('../trips/tripQueue.js');await stopTripWorkers();const {stopPaymentWorkers}=await import('../payments/paymentQueue.js');await stopPaymentWorkers();
  }
});

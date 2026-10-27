import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,readdir,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { CallInvite } from './callPush.providers';

test('native call registrations and push delivery preserve session, privacy and lifecycle boundaries',{skip:!process.env.RAKKY_TEST_ISOLATED},async t=>{
  const schema=`native_calls_${process.pid}_${Date.now()}`,directory=await mkdtemp(join(tmpdir(),'rakky-native-call-'));
  const owner=new Pool({connectionString:process.env.DATABASE_URL});await owner.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
  const {db}=await import('../../shared/config/db.js');const original={query:db.query,connect:db.connect};
  db.query=pool.query.bind(pool) as typeof db.query;db.connect=pool.connect.bind(pool) as typeof db.connect;
  const {env}=await import('../../config/env.js');
  const previous={COMMUNICATION_NATIVE_CALLS_ENABLED:env.COMMUNICATION_NATIVE_CALLS_ENABLED,CALL_PUSH_TOKEN_KEY:env.CALL_PUSH_TOKEN_KEY,
    CALL_FCM_PROJECT_ID:env.CALL_FCM_PROJECT_ID,CALL_FCM_CREDENTIALS_FILE:env.CALL_FCM_CREDENTIALS_FILE,
    COMMUNICATION_AUDIO_ENABLED:env.COMMUNICATION_AUDIO_ENABLED,TURN_URLS:env.TURN_URLS,TURN_SHARED_SECRET:env.TURN_SHARED_SECRET};
  const {ensureRedis,redis}=await import('../../shared/config/redis.js');await ensureRedis();
  try{
    for(const file of (await readdir('migrations')).filter(f=>/^\d+_.*\.sql$/.test(f)).sort())await pool.query(await readFile(`migrations/${file}`,'utf8'));
    const credentials=join(directory,'fixture-credentials.json');await writeFile(credentials,'{}');
    Object.assign(env,{COMMUNICATION_NATIVE_CALLS_ENABLED:true,CALL_PUSH_TOKEN_KEY:randomBytes(32).toString('base64'),CALL_FCM_PROJECT_ID:'rakky-fixture',CALL_FCM_CREDENTIALS_FILE:credentials,
      COMMUNICATION_AUDIO_ENABLED:true,TURN_URLS:['turn:turn.example.test:3478?transport=udp'],TURN_SHARED_SECRET:'isolated-secret-'.repeat(3)});
    const users=(await pool.query<{id:string}>("INSERT INTO users(full_name) VALUES('Rider'),('Driver'),('Another account') RETURNING id")).rows.map(row=>row.id);
    const sessions=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
    for(let i=0;i<sessions.length;i++)await pool.query("INSERT INTO refresh_tokens(user_id,session_id,token_hash,session_scope,expires_at) VALUES($1,$2,$3,'app',now()+interval '1 day')",[users[i===3?1:i],sessions[i],randomUUID()]);
    const trip=(await pool.query<{id:string}>(`INSERT INTO trips(rider_id,driver_id,status,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key)
      VALUES($1,$2,'driver_assigned','cash',6.4,3.4,'Pickup',6.5,3.5,'Destination',1000,300,100000,$3) RETURNING id`,[users[0],users[1],randomUUID()])).rows[0].id;
    const devices=await import('./callDevices.service.js'),push=await import('./callPush.service.js'),calls=await import('./call.service.js');
    const {callPushProvider}=await import('./callPush.providers.js');
    const tokenA='fcm-fixture-token-a-'.repeat(4),tokenB='fcm-fixture-token-b-'.repeat(4);
    const input=(token=tokenA,installationId='device-one')=>({provider:'fcm',token,installationId,appVersion:'1.0.0',protocol:1});
    const invites:CallInvite[]=[];
    t.mock.method(callPushProvider,'send',async(_provider:unknown,_token:unknown,invite:CallInvite)=>{invites.push(invite);return {ok:true};});
    const start=async()=>{await redis!.del(`call:start:${users[0]}`);return calls.initiateCall(users[0],sessions[0],trip,{requestId:randomUUID()});};
    const end=async(id:string)=>{const call=await calls.getCall(users[0],sessions[0],id);return calls.commandCall(users[0],sessions[0],id,'end',{version:call.version});};
    let a:string,b:string;
    await t.test('tokens are encrypted, authenticated and kept separate from existing Expo registrations',async()=>{
      a=(await devices.registerCallDevice(users[1],sessions[1],input())).deviceId;
      b=(await devices.registerCallDevice(users[1],sessions[3],input(tokenB,'device-two'))).deviceId;
      const stored=(await pool.query('SELECT * FROM push_devices WHERE id=$1',[a])).rows[0];
      assert.equal(stored.expo_push_token,null);assert.equal(stored.session_id,sessions[1]);assert.equal(stored.call_token_ciphertext.includes(tokenA),false);
      assert.equal(devices.decryptCallPushToken(stored.call_token_ciphertext),tokenA);
      const damaged=stored.call_token_ciphertext.slice(0,-5)+'AAAAA';assert.throws(()=>devices.decryptCallPushToken(damaged));
      const {registerDevice}=await import('../notifications/notifications.service.js');
      await registerDevice(users[1],{expoPushToken:'ExponentPushToken[native-compatibility-fixture]',platform:'android',deviceIdentifier:'device-one',appVersion:'1.0.0'});
      assert.equal((await pool.query('SELECT id FROM push_devices WHERE user_id=$1 AND device_identifier=$2',[users[1],'device-one'])).rowCount,2);
      await assert.rejects(devices.registerCallDevice(users[1],sessions[1],{...input(),token:'bad\nvalue'}),/invalid_call_device/);
    });
    await t.test('call insertion rolls back if durable invite creation fails',async()=>{
      const count=(await pool.query('SELECT count(*) FROM call_sessions')).rows[0].count;
      await pool.query(`CREATE FUNCTION fail_call_push_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_delivery_failure'; END $$;
        CREATE TRIGGER fail_call_push_fixture BEFORE INSERT ON call_push_deliveries FOR EACH ROW EXECUTE FUNCTION fail_call_push_fixture()`);
      try{await assert.rejects(start(),/fixture_delivery_failure/);assert.equal((await pool.query('SELECT count(*) FROM call_sessions')).rows[0].count,count);assert.equal((await pool.query('SELECT * FROM active_call_participants')).rowCount,0);}
      finally{await pool.query('DROP TRIGGER fail_call_push_fixture ON call_push_deliveries; DROP FUNCTION fail_call_push_fixture()');}
    });
    await t.test('concurrent workers send one invite per device; tickets disclose only minimal status',async()=>{
      const call=await start();assert.equal((await pool.query('SELECT * FROM call_push_deliveries WHERE call_id=$1',[call.id])).rowCount,2);
      const result=await Promise.all([push.processCallPushDeliveries(),push.processCallPushDeliveries()]);assert.equal(result.reduce((sum,r)=>sum+r.sent,0),2);
      const invite=invites.find(value=>value.registrationId===a)!;assert.equal(invite.callId,call.id);
      assert.equal(JSON.stringify(invite).includes('phone'),false);assert.equal(JSON.stringify(invite).includes('sdp'),false);assert.equal(JSON.stringify(invite).includes('secret'),false);
      assert.equal((await push.inviteStatus({ticket:invite.ticket})).authorized,true);
      const {verifyAccessToken}=await import('../auth/jwt.service.js');assert.throws(()=>verifyAccessToken(invite.ticket),/invalid_token|invalid_access_token_type/);
      await assert.rejects(push.inviteStatus({ticket:invite.ticket+'invalid'}),/invalid_call_invite/);
      await end(call.id);assert.equal((await push.inviteStatus({ticket:invite.ticket})).authorized,false);
    });
    await t.test('a native decline is narrowly scoped and cannot terminate an accepted call',async()=>{
      const call=await start();const ticket=push.createInviteTicket(call.id,a,(await pool.query('SELECT deadline_at FROM call_sessions WHERE id=$1',[call.id])).rows[0].deadline_at);
      assert.equal((await push.declineNativeInvite({ticket})).dismissed,true);assert.equal((await calls.getCall(users[0],sessions[0],call.id)).status,'declined');
      assert.equal((await push.declineNativeInvite({ticket})).dismissed,false);
      const accepted=await start();const acceptedTicket=push.createInviteTicket(accepted.id,a,new Date(accepted.deadlineAt));
      await calls.commandCall(users[1],sessions[1],accepted.id,'accept',{version:1});
      assert.equal((await push.declineNativeInvite({ticket:acceptedTicket})).dismissed,false);
      assert.equal((await calls.getCall(users[0],sessions[0],accepted.id)).status,'connecting');await end(accepted.id);
    });
    await t.test('closure/expiry and session revocation suppress queued invites',async()=>{
      const expired=await start();await pool.query("UPDATE call_sessions SET deadline_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
      const before=invites.length;await push.processCallPushDeliveries();assert.equal(invites.length,before);await calls.expireCalls();
      const call=await start();await pool.query('UPDATE refresh_tokens SET revoked_at=now() WHERE session_id=ANY($1::uuid[])',[[sessions[1],sessions[3]]]);
      assert.equal((await push.processCallPushDeliveries()).sent,0);await end(call.id);
      await pool.query('UPDATE refresh_tokens SET revoked_at=NULL WHERE session_id=ANY($1::uuid[])',[[sessions[1],sessions[3]]]);
    });
    await t.test('transient provider failure recovers through expired leases without another call',async()=>{
      const call=await start();const real=callPushProvider.send;
      callPushProvider.send=async()=>({ok:false,retry:true,code:'provider_unavailable'});
      try{assert.ok((await push.processCallPushDeliveries()).failed>0);}finally{callPushProvider.send=real;}
      await pool.query("UPDATE call_push_deliveries SET available_at=now(),lease_until=now()-interval '1 second' WHERE status='pending'");
      assert.equal((await push.processCallPushDeliveries()).sent,2);await end(call.id);
    });
    await t.test('the global push preference suppresses native call wakeups without touching active media',async()=>{
      const call=await start();const before=invites.length;
      await pool.query('INSERT INTO notification_preferences(user_id,push_enabled) VALUES($1,false) ON CONFLICT(user_id) DO UPDATE SET push_enabled=false',[users[1]]);
      await push.processCallPushDeliveries();assert.equal(invites.length,before);
      await pool.query('UPDATE notification_preferences SET push_enabled=true WHERE user_id=$1',[users[1]]);await end(call.id);
    });
    await t.test('token/account rotation invalidates old installation eligibility without affecting Expo push',async()=>{
      const old=a;
      const rotated=await devices.registerCallDevice(users[1],sessions[1],input('rotated-fcm-token-'.repeat(4)));
      assert.notEqual(rotated.deviceId,old);assert.equal((await pool.query('SELECT id FROM push_devices WHERE id=$1',[old])).rowCount,0);
      const transferred=await devices.registerCallDevice(users[2],sessions[2],input('rotated-fcm-token-'.repeat(4)));
      const row=(await pool.query('SELECT user_id,session_id FROM push_devices WHERE id=$1',[transferred.deviceId])).rows[0];
      assert.equal(row.user_id,users[2]);assert.equal(row.session_id,sessions[2]);
      assert.equal((await pool.query("SELECT id FROM push_devices WHERE user_id=$1 AND provider='expo'",[users[1]])).rowCount,1);
      await devices.revokeCallDevice(users[2],sessions[2],transferred.deviceId);
    });
    await t.test('invalid provider tokens are disabled; feature rollback suppresses future delivery',async()=>{
      const call=await start();const real=callPushProvider.send;callPushProvider.send=async()=>({ok:false,invalid:true,code:'device_unregistered'});
      try{await push.processCallPushDeliveries();}finally{callPushProvider.send=real;}
      assert.equal((await pool.query('SELECT enabled FROM push_devices WHERE id=$1',[b])).rows[0].enabled,false);await end(call.id);
      await devices.registerCallDevice(users[1],sessions[3],input(tokenB,'device-two'));
      const next=await start();Object.assign(env,{COMMUNICATION_NATIVE_CALLS_ENABLED:false});const before=invites.length;
      await push.processCallPushDeliveries();assert.equal(invites.length,before);await end(next.id);
    });
  }finally{
    t.mock.restoreAll();Object.assign(env,previous);db.query=original.query;db.connect=original.connect;
    await pool.end();await owner.query(`DROP SCHEMA ${schema} CASCADE`);await owner.end();await redis?.quit();await db.end();await rm(directory,{recursive:true,force:true});
  }
});

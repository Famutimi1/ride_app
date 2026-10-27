import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { Pool } from 'pg';

test('video consent, motion safety, signaling and audio fallback',{skip:!process.env.RAKKY_TEST_ISOLATED},async t=>{
  const schema=`video_${process.pid}_${Date.now()}`;
  const owner=new Pool({connectionString:process.env.DATABASE_URL});await owner.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
  const {db}=await import('../../shared/config/db.js'),{env}=await import('../../config/env.js');
  const original={query:db.query,connect:db.connect};db.query=pool.query.bind(pool) as typeof db.query;db.connect=pool.connect.bind(pool) as typeof db.connect;
  const previous={COMMUNICATION_VIDEO_ENABLED:env.COMMUNICATION_VIDEO_ENABLED,COMMUNICATION_AUDIO_ENABLED:env.COMMUNICATION_AUDIO_ENABLED,
    COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY:env.COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY,NODE_ENV:env.NODE_ENV};
  const {ensureRedis}=await import('../../shared/config/redis.js');const redis=await ensureRedis();
  try{
    for(const file of (await readdir('migrations')).filter(f=>/^\d+_.*\.sql$/.test(f)).sort())await pool.query(await readFile(`migrations/${file}`,'utf8'));
    Object.assign(env,{COMMUNICATION_VIDEO_ENABLED:true,COMMUNICATION_AUDIO_ENABLED:true,COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY:true,NODE_ENV:'test'});
    const users=(await pool.query<{id:string}>("INSERT INTO users(full_name) VALUES('Video Rider'),('Video Driver'),('Outsider') RETURNING id")).rows.map(u=>u.id);
    const trip=(await pool.query<{id:string}>(`INSERT INTO trips(rider_id,driver_id,status,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key)
      VALUES($1,$2,'driver_assigned','cash',6.4,3.4,'Pickup',6.5,3.5,'Destination',1000,300,100000,$3) RETURNING id`,[users[0],users[1],randomUUID()])).rows[0].id;
    const service=await import('./call.service.js'),communication=await import('./communication.service.js');
    const sessions=[randomUUID(),randomUUID(),randomUUID()],key=`driver:${users[1]}:location`;
    const safe=()=>{const now=Date.now();return {latitude:6.4,longitude:3.4,timestamp:now,sampleTimestamp:now,motionReceivedAt:now,stationarySince:now-9000,stationarySamples:3,accuracy:5,speed:0};};
    const evidence=async(patch:Record<string,unknown>={})=>redis.set(key,JSON.stringify({...safe(),...patch}),'EX',30);
    const video=async()=>{await redis.del(`call:start:${users[0]}`);return service.initiateCall(users[0],sessions[0],trip,{requestId:randomUUID(),media:'video',protocol:2});};
    const end=async(call:Awaited<ReturnType<typeof video>>)=>service.commandCall(users[0],sessions[0],call.id,'end',{version:call.version});
    await t.test('existing Redis location writes derive stationary evidence without refreshing a duplicate GPS fix',async()=>{
      const {saveDriverLocation}=await import('../location/location.service.js');
      let clock=Date.now()-8000;const mock=t.mock.method(Date,'now',()=>clock);
      try{
        for(let sample=0;sample<3;sample++){
          await saveDriverLocation({driverId:users[1],latitude:6.4,longitude:3.4,timestamp:clock,sampleTimestamp:clock,accuracy:5,speed:0});
          if(sample<2)clock+=4000;
        }
        const stored=JSON.parse((await redis.get(key))!) as {stationarySamples:number;motionReceivedAt:number;stationarySince:number};
        assert.equal(stored.stationarySamples,3);assert.equal(clock-stored.stationarySince,8000);
        await saveDriverLocation({driverId:users[1],latitude:6.4,longitude:3.4,timestamp:clock+1000,sampleTimestamp:clock,accuracy:5,speed:0});
        assert.equal(JSON.parse((await redis.get(key))!).motionReceivedAt,stored.motionReceivedAt);
        assert.equal((await communication.getCommunication(users[0],trip)).canVideoCall,true);
      }finally{mock.mock.restore();await redis.del(key);}
    });
    await t.test('unknown, stale, inaccurate, moving and insufficient evidence fail closed',async()=>{
      await assert.rejects(video(),/driver_location_unavailable/);
      for(const [patch,reason]of [[{motionReceivedAt:Date.now()-8000},'driver_location_stale'],[{accuracy:100},'driver_must_be_stationary'],[{speed:4},'driver_must_be_stationary'],[{stationarySamples:1},'driver_must_be_stationary']] as const){
        await evidence(patch);await assert.rejects(video(),new RegExp(reason));
      }
      await evidence();assert.equal((await communication.getCommunication(users[0],trip)).canVideoCall,true);
      await assert.rejects(service.initiateCall(users[2],sessions[2],trip,{requestId:randomUUID(),media:'video',protocol:2}),/trip_not_found/);
    });
    await t.test('video is not accepted by old clients and only accepted devices signal',async()=>{
      await evidence();const call=await video();assert.equal(call.media,'video');assert.ok(call.videoValidUntil>Date.now());
      await assert.rejects(service.commandCall(users[1],sessions[1],call.id,'accept',{version:call.version}),/video_client_update_required/);
      await assert.rejects(service.authorizeCallSignal(users[0],sessions[0],{callId:call.id,generation:1,kind:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'}),/call_media_unavailable/);
      const accepted=await service.commandCall(users[1],sessions[1],call.id,'accept',{version:call.version,protocol:2});
      const payload={callId:call.id,generation:accepted.generation,kind:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'};
      assert.equal((await service.authorizeCallSignal(users[0],sessions[0],payload)).targetSession,sessions[1]);
      await assert.rejects(service.authorizeCallSignal(users[0],sessions[2],payload),/call_media_unavailable/);
      await assert.rejects(service.authorizeCallSignal(users[0],sessions[0],{...payload,sdp:payload.sdp+'m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'}),/invalid_audio_sdp/);
      await evidence({speed:5});await service.expireCalls();
      const audio=await service.getCall(users[0],sessions[0],call.id);
      assert.equal(audio.media,'audio');assert.equal(audio.generation,accepted.generation+1);assert.equal(audio.endedAt,null);
      await assert.rejects(service.authorizeCallSignal(users[0],sessions[0],{...payload,generation:audio.generation}),/invalid_audio_sdp/);await end(audio);
    });
    await t.test('trip start downgrades in the same transaction and blocks new video calls',async()=>{
      await evidence();const call=await video();
      await pool.query("UPDATE trips SET status='in_progress' WHERE id=$1",[trip]);
      const audio=await service.getCall(users[0],sessions[0],call.id);assert.equal(audio.media,'audio');assert.equal(audio.videoReason,'video_before_trip_only');
      await assert.rejects(video(),/video_before_trip_only/);await end(audio);
      await pool.query("UPDATE trips SET status='driver_assigned' WHERE id=$1",[trip]);
    });
    await t.test('audio upgrades require peer consent and preserve audio on rejection or stale safety evidence',async()=>{
      await evidence();await redis.del(`call:start:${users[0]}`);
      let call=await service.initiateCall(users[0],sessions[0],trip,{requestId:randomUUID(),media:'audio',protocol:2});
      call=await service.commandCall(users[1],sessions[1],call.id,'accept',{version:call.version,protocol:2});
      await service.renewCall(users[0],sessions[0],call.id,{generation:call.generation,connected:true});
      call=await service.renewCall(users[1],sessions[1],call.id,{generation:call.generation,connected:true});
      const generation=call.generation;
      call=await service.commandCall(users[0],sessions[0],call.id,'request-video',{version:call.version,protocol:2});
      assert.equal(call.media,'audio');assert.equal(call.status,'connected');assert.equal(call.generation,generation);assert.equal(call.videoUpgrade?.requestedBy,users[0]);
      await assert.rejects(service.commandCall(users[0],sessions[0],call.id,'accept-video',{version:call.version,protocol:2}),/peer_consent_required/);
      await assert.rejects(service.commandCall(users[1],sessions[2],call.id,'accept-video',{version:call.version,protocol:2}),/owned_by_other_device/);
      await assert.rejects(service.commandCall(users[1],sessions[1],call.id,'accept-video',{version:call.version}),/client_update_required/);
      await assert.rejects(service.authorizeCallSignal(users[0],sessions[0],{callId:call.id,generation,kind:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'}),/invalid_audio_sdp/);
      call=await service.commandCall(users[1],sessions[1],call.id,'reject-video',{version:call.version,protocol:2});
      assert.equal(call.videoUpgrade,null);assert.equal(call.media,'audio');assert.equal(call.generation,generation);
      call=await service.commandCall(users[1],sessions[1],call.id,'request-video',{version:call.version,protocol:2});
      await evidence({speed:5});await assert.rejects(service.commandCall(users[0],sessions[0],call.id,'accept-video',{version:call.version,protocol:2}),/must_be_stationary/);
      await service.expireCalls();call=await service.getCall(users[0],sessions[0],call.id);
      assert.equal(call.videoUpgrade,null);assert.equal(call.media,'audio');assert.equal(call.endedAt,null);
      await evidence();call=await service.commandCall(users[0],sessions[0],call.id,'request-video',{version:call.version,protocol:2});
      call=await service.commandCall(users[1],sessions[1],call.id,'accept-video',{version:call.version,protocol:2});
      assert.equal(call.media,'video');assert.equal(call.generation,generation+1);assert.equal(call.videoUpgrade,null);assert.equal(call.endedAt,null);await end(call);
    });
    await t.test('receiver can answer audio without camera consent and disabled video remains blocked',async()=>{
      await evidence();const invitation=await video();
      const fallback=await service.commandCall(users[1],sessions[1],invitation.id,'audio',{version:invitation.version});
      assert.equal(fallback.media,'audio');assert.equal(fallback.status,'ringing');
      const answer=await service.commandCall(users[1],sessions[1],invitation.id,'accept',{version:fallback.version});assert.equal(answer.media,'audio');await end(answer);
      Object.assign(env,{COMMUNICATION_VIDEO_ENABLED:false});await assert.rejects(video(),/video_disabled/);
    });
    await redis.del(key);
  }finally{
    Object.assign(env,previous);db.query=original.query;db.connect=original.connect;
    await pool.end();await owner.query(`DROP SCHEMA ${schema} CASCADE`);await owner.end();await redis.quit();await db.end();
  }
});

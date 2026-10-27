import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID,createHmac } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

test('audio calls serialize participants, bind devices, authorize media and recover failures',{skip:!process.env.RAKKY_TEST_ISOLATED},async t=>{
  const schema=`audio_${process.pid}_${Date.now()}`;
  const owner=new Pool({connectionString:process.env.DATABASE_URL});
  await owner.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
  const {db}=await import('../../shared/config/db.js');
  const original={query:db.query,connect:db.connect};
  db.query=pool.query.bind(pool) as typeof db.query;db.connect=pool.connect.bind(pool) as typeof db.connect;
  const {env}=await import('../../config/env.js');
  const previous={COMMUNICATION_AUDIO_ENABLED:env.COMMUNICATION_AUDIO_ENABLED,TURN_URLS:env.TURN_URLS,TURN_SHARED_SECRET:env.TURN_SHARED_SECRET,STUN_URLS:env.STUN_URLS,COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY:env.COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY,NODE_ENV:env.NODE_ENV};
  const {redis,ensureRedis}=await import('../../shared/config/redis.js');
  await ensureRedis();
  try{
    for(const file of (await readdir('migrations')).filter(f=>/^\d+_.*\.sql$/.test(f)).sort())await pool.query(await readFile(`migrations/${file}`,'utf8'));
    const users=(await pool.query<{id:string}>("INSERT INTO users(full_name) VALUES('Rider'),('Driver'),('Outsider') RETURNING id")).rows.map(u=>u.id);
    const trip=(await pool.query<{id:string}>(`INSERT INTO trips(rider_id,driver_id,status,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key)
      VALUES($1,$2,'driver_assigned','cash',6.4,3.4,'Pickup',6.5,3.5,'Destination',1000,300,100000,$3) RETURNING id`,[users[0],users[1],randomUUID()])).rows[0].id;
    const service=await import('./call.service.js');
    const {processCallOutbox,callTransport}=await import('./call.outbox.js');
    const sessions=[randomUUID(),randomUUID(),randomUUID()];
    const start=async(index=0,key=randomUUID())=>{await redis!.del(`call:start:${users[index]}`);return service.initiateCall(users[index],sessions[index],trip,{requestId:key});};
    const end=async(call:Awaited<ReturnType<typeof start>>,index=0)=>service.commandCall(users[index],sessions[index],call.id,'end',{version:call.version});
    await t.test('disabled/missing relay configuration fails closed; outsiders cannot call',async()=>{
      assert.equal(service.audioCallsEnabled(),false);
      await assert.rejects(start(),/audio_calling_unavailable/);
      Object.assign(env,{COMMUNICATION_AUDIO_ENABLED:true,TURN_URLS:['turns:turn.example.test:5349?transport=tcp'],TURN_SHARED_SECRET:'test-secret-'.repeat(4),STUN_URLS:['stun:turn.example.test:3478']});
      await assert.rejects(service.initiateCall(users[2],sessions[2],trip,{requestId:randomUUID()}),/trip_not_found/);
      await assert.rejects(service.initiateCall(users[0],'',trip,{requestId:randomUUID()}),/call_session_required/);
    });
    await t.test('explicit direct-only testing needs no fake TURN credential and cannot enable production calling',async()=>{
      const configured={TURN_URLS:env.TURN_URLS,TURN_SHARED_SECRET:env.TURN_SHARED_SECRET,STUN_URLS:env.STUN_URLS,
        COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY:env.COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY,NODE_ENV:env.NODE_ENV};
      try{
        Object.assign(env,{TURN_URLS:[],TURN_SHARED_SECRET:'',STUN_URLS:[],COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY:false});
        assert.equal(service.audioCallsEnabled(),false);
        Object.assign(env,{COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY:true,NODE_ENV:'production'});
        assert.equal(service.audioCallsEnabled(),false);await assert.rejects(start(),/audio_calling_unavailable/);
        Object.assign(env,{NODE_ENV:'test'});assert.equal(service.audioConnectionMode(),'direct-only');
        const communication=await import('./communication.service.js');
        const details=await communication.getCommunication(users[0],trip);
        assert.equal(details.canAudioCall,true);assert.equal(details.audioConnectionMode,'direct-only');
        const call=await start();
        await assert.rejects(service.turnCredentials(users[0],sessions[0],call.id),/call_media_unavailable/);
        const accepted=await service.commandCall(users[1],sessions[1],call.id,'accept',{version:1});
        const direct=await service.turnCredentials(users[0],sessions[0],call.id);
        assert.equal(direct.iceTransportPolicy,'all');assert.deepEqual(direct.iceServers,[]);
        Object.assign(env,{STUN_URLS:['stun:stun.example.test:3478']});
        const discovery=await service.turnCredentials(users[0],sessions[0],call.id);
        assert.deepEqual(discovery.iceServers,[{urls:env.STUN_URLS}]);
        assert.equal(discovery.iceServers.some(server=>'credential' in server),false);
        await end(accepted);
      }finally{Object.assign(env,configured);}
      assert.equal(service.audioConnectionMode(),'direct-and-relay');
    });
    await t.test('concurrent retries create one call and exactly two reservations',async()=>{
      const key=randomUUID();await redis!.del(`call:start:${users[0]}`);
      const calls=await Promise.all(Array.from({length:5},()=>service.initiateCall(users[0],sessions[0],trip,{requestId:key})));
      assert.equal(new Set(calls.map(c=>c.id)).size,1);
      assert.equal((await pool.query('SELECT * FROM active_call_participants')).rowCount,2);
      assert.equal((await pool.query('SELECT * FROM call_outbox WHERE call_id=$1',[calls[0].id])).rowCount,1);
      await assert.rejects(service.initiateCall(users[0],sessions[2],trip,{requestId:key}),/call_rate_limited|call_request_conflict/);
      await end(calls[0]);
    });
    await t.test('opposite-direction calls cannot both win',async()=>{
      const results=await Promise.allSettled([start(0),start(1)]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      const failure=results.find(r=>r.status==='rejected') as PromiseRejectedResult;
      assert.match(failure.reason.message,/call_participant_busy/);
      const winner=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof start>>>).value;
      await end(winner,winner.callerId===users[0]?0:1);
      assert.equal((await pool.query('SELECT * FROM active_call_participants')).rowCount,0);
    });
    await t.test('first accepting session wins, versions reject stale commands and retries are safe',async()=>{
      const call=await start();
      const other=randomUUID();
      const results=await Promise.allSettled([sessions[1],other].map(session=>service.commandCall(users[1],session,call.id,'accept',{version:call.version})));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      const winningSession=results[0].status==='fulfilled'?sessions[1]:other;
      sessions[1]=winningSession;
      const accepted=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof start>>>).value;
      assert.equal(accepted.status,'connecting');
      assert.deepEqual(await service.commandCall(users[1],winningSession,call.id,'accept',{version:1}),accepted);
      await assert.rejects(end(call),/call_version_conflict/);
      await assert.rejects(service.getCall(users[2],sessions[2],call.id),/call_not_found/);
      assert.equal((await service.activeCall(users[0],sessions[2]))?.deviceRole,'observer');
      await assert.rejects(service.turnCredentials(users[0],sessions[2],call.id),/call_media_unavailable/);
      await end(accepted);
    });
    await t.test('ICE permits direct routes with separate STUN discovery and short-lived authenticated TURN fallback',async()=>{
      const call=await start();
      await assert.rejects(service.turnCredentials(users[0],sessions[0],call.id),/call_media_unavailable/);
      const accepted=await service.commandCall(users[1],sessions[1],call.id,'accept',{version:1});
      const turn=await service.turnCredentials(users[0],sessions[0],call.id);
      assert.equal(turn.iceTransportPolicy,'all');assert.ok(turn.expiresAt<=Math.floor(Date.now()/1000)+300);
      assert.deepEqual(turn.iceServers[0],{urls:env.STUN_URLS});
      const server=turn.iceServers.find(value=>'credential' in value);assert.ok(server?.username);assert.ok(server.credential);
      assert.deepEqual(server.urls,env.TURN_URLS);
      assert.equal(server.credential,createHmac('sha1',env.TURN_SHARED_SECRET).update(server.username).digest('base64'));
      assert.equal(JSON.stringify(turn).includes(env.TURN_SHARED_SECRET),false);
      const stunUrls=env.STUN_URLS;
      try{
        Object.assign(env,{STUN_URLS:[]});
        const withoutStun=await service.turnCredentials(users[0],sessions[0],call.id);
        assert.equal(withoutStun.iceTransportPolicy,'all');assert.equal(withoutStun.iceServers.length,1);
        assert.deepEqual(withoutStun.iceServers[0].urls,env.TURN_URLS);
      }finally{Object.assign(env,{STUN_URLS:stunUrls});}
      await end(accepted);
    });
    await t.test('signaling binds the peer session, restricts offer ownership and rejects video/replays',async()=>{
      const call=await start();const accepted=await service.commandCall(users[1],sessions[1],call.id,'accept',{version:1});
      const payload={callId:call.id,generation:1,kind:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'};
      const routed=await service.authorizeCallSignal(users[0],sessions[0],payload);
      assert.equal(routed.targetSession,sessions[1]);assert.equal('senderId' in routed.signal,false);
      for(const kind of ['host','srflx','relay']){
        const candidate={candidate:`candidate:1 1 udp 100 198.51.100.2 50000 typ ${kind}`,sdpMid:'0',sdpMLineIndex:0};
        const ice=await service.authorizeCallSignal(users[0],sessions[0],{callId:call.id,generation:1,kind:'ice',candidate});
        assert.equal(ice.targetSession,sessions[1]);assert.deepEqual(ice.signal.candidate,candidate);
      }
      await assert.rejects(service.authorizeCallSignal(users[1],sessions[1],payload),/call_signal_role/);
      await assert.rejects(service.authorizeCallSignal(users[0],sessions[2],payload),/call_media_unavailable/);
      await assert.rejects(service.authorizeCallSignal(users[2],sessions[2],payload),/call_not_found/);
      await assert.rejects(service.authorizeCallSignal(users[0],sessions[0],{...payload,sdp:payload.sdp+'m=video 9 RTP/AVP 96\r\n'}),/invalid_audio_sdp/);
      await assert.rejects(service.authorizeCallSignal(users[0],sessions[0],{...payload,sdp:'v=0\r\n'+'x'.repeat(12001)}),/invalid_audio_sdp/);
      const restarted=await service.commandCall(users[0],sessions[0],call.id,'restart',{version:accepted.version});
      assert.equal(restarted.generation,2);
      await assert.rejects(service.authorizeCallSignal(users[0],sessions[0],payload),/call_media_unavailable/);
      await end(restarted);
    });
    await t.test('connected requires both peers; leases cannot keep an absent peer alive',async()=>{
      const call=await start();await service.commandCall(users[1],sessions[1],call.id,'accept',{version:1});
      const first=await service.renewCall(users[0],sessions[0],call.id,{generation:1,connected:true});assert.equal(first.status,'connecting');
      const both=await service.renewCall(users[1],sessions[1],call.id,{generation:1,connected:true});assert.equal(both.status,'connected');
      assert.ok(both.connectedAt);
      await pool.query("UPDATE call_sessions SET callee_seen_at=now()-interval '31 seconds' WHERE id=$1",[call.id]);
      await service.renewCall(users[0],sessions[0],call.id,{generation:1,connected:true});
      await service.expireCalls();
      assert.equal((await service.getCall(users[0],sessions[0],call.id)).status,'failed');
      assert.equal((await pool.query('SELECT * FROM active_call_participants')).rowCount,0);
    });
    await t.test('decline/cancel and unanswered timeout release reservations',async()=>{
      const a=await start();const declined=await service.commandCall(users[1],sessions[1],a.id,'decline',{version:1});assert.equal(declined.status,'declined');
      const b=await start();const cancelled=await service.commandCall(users[0],sessions[0],b.id,'cancel',{version:1});assert.equal(cancelled.status,'cancelled');
      const c=await start();await pool.query("UPDATE call_sessions SET deadline_at=now()-interval '1 second' WHERE id=$1",[c.id]);
      await service.expireCalls();assert.equal((await service.getCall(users[0],sessions[0],c.id)).status,'missed');
      assert.equal((await service.activeCall(users[1],sessions[1])),null);
    });
    await t.test('failed call event delivery is retried; delayed ringing publishes current state',async()=>{
      t.mock.method(callTransport,'state',()=>{throw new Error('offline');});
      assert.ok((await processCallOutbox()).failed>0);
      const states:string[]=[];t.mock.method(callTransport,'state',(call:{status:string})=>{states.push(call.status);});
      await pool.query("UPDATE call_outbox SET available_at=now(),lease_until=now()-interval '1 second'");
      assert.ok((await processCallOutbox()).dispatched>0);
      assert.equal(states.includes('ringing'),false);t.mock.restoreAll();
    });
    await t.test('disabled calling terminates existing calls on reconciliation',async()=>{
      const call=await start();Object.assign(env,{COMMUNICATION_AUDIO_ENABLED:false});
      await service.expireCalls();assert.equal((await service.getCall(users[0],sessions[0],call.id)).endReason,'calling_disabled');
      Object.assign(env,{COMMUNICATION_AUDIO_ENABLED:true});
    });
    await t.test('authenticated HTTP commands and cross-instance sockets route media only to the accepting session',async()=>{
      const {callsRouter,tripCallsRouter}=await import('./call.routes.js');
      const {attachWebsocket}=await import('../../websocket/index.js');
      // Multiple mock replacements of one method are restored explicitly before
      // exercising the real Socket.IO transport in this subtest.
      callTransport.state=(await import('../../websocket/notifications.js')).emitCallState;
      const {signAccessToken}=await import('../auth/jwt.service.js');
      const ids=[...sessions,randomUUID()];
      for(let i=0;i<ids.length;i++)await pool.query("INSERT INTO refresh_tokens(user_id,session_id,token_hash,session_scope,expires_at) VALUES($1,$2,$3,'app',now()+interval '1 day')",[users[i===3?1:i],ids[i],randomUUID()]);
      const tokens=ids.map((id,i)=>signAccessToken({id:users[i===3?1:i]},'app',{id,startedAt:new Date()}));
      const app=express();app.use(express.json());app.use('/api/trips',tripCallsRouter);app.use('/api/calls',callsRouter);
      app.use((error:{status?:number;message?:string},_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.status??500).json({error:error.message}));
      const servers=[createServer(app),createServer(app)];
      const gateways=await Promise.all(servers.map(server=>attachWebsocket(server)));
      await Promise.all(servers.map(server=>new Promise<void>(done=>server.listen(0,'127.0.0.1',done))));
      const urls=servers.map(server=>`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      interface ClientSocket {once:(event:string,fn:(value?:unknown)=>void)=>void;on:(event:string,fn:(value:unknown)=>void)=>void;emit:(event:string,...args:unknown[])=>void;disconnect:()=>void;}
      const {io}=createRequire(resolve('../mobile/package.json'))('socket.io-client') as {io:(url:string,options:object)=>ClientSocket};
      const sockets=tokens.map((token,i)=>io(urls[i%2],{transports:['websocket'],auth:{token},reconnection:false}));
      const wait=(socket:ClientSocket,event:string,predicate:(value:unknown)=>boolean=()=>true)=>new Promise<unknown>((done,reject)=>{
        const timeout=setTimeout(()=>reject(new Error(`${event} timed out`)),3000);timeout.unref();
        socket.on(event,value=>{if(predicate(value)){clearTimeout(timeout);done(value);}});socket.once('connect_error',value=>{clearTimeout(timeout);reject(value);});
      });
      const request=(path:string,index:number,body?:unknown)=>fetch(urls[0]+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${tokens[index]}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
      try{
        await Promise.all(sockets.map(socket=>wait(socket,'connect')));
        assert.equal((await fetch(urls[0]+'/api/calls/active')).status,401);
        assert.equal((await request(`/trips/${trip}/calls`,2,{requestId:randomUUID()})).status,404);
        await redis!.del(`call:start:${users[0]}`);
        const ringing=await request(`/trips/${trip}/calls`,0,{requestId:randomUUID()});assert.equal(ringing.status,200);
        const call=await ringing.json() as Awaited<ReturnType<typeof start>>;
        const invited=wait(sockets[1],'call:state',value=>(value as {id?:string}).id===call.id);await processCallOutbox();assert.equal((await invited as {id:string}).id,call.id);
        const accept=await request(`/calls/${call.id}/accept`,3,{version:1});assert.equal(accept.status,200);
        const accepted=await accept.json() as typeof call;
        assert.equal((await request(`/calls/${call.id}/accept`,1,{version:1})).status,409);
        assert.equal((await request(`/calls/${call.id}`,2)).status,404);
        let observed=0;sockets[1].on('call:signal',()=>{observed++;});sockets[2].on('call:signal',()=>{observed++;});
        const offered=wait(sockets[3],'call:signal');
        const ack=await new Promise<{ok:boolean}>((done,reject)=>{
          const timeout=setTimeout(()=>reject(new Error('signal acknowledgement timed out')),3000);timeout.unref();
          sockets[0].emit('call:signal',{callId:call.id,generation:1,kind:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'},(result:{ok:boolean})=>{clearTimeout(timeout);done(result);});
        });
        assert.equal(ack.ok,true);assert.equal((await offered as {kind:string}).kind,'offer');
        await new Promise(done=>setTimeout(done,50));assert.equal(observed,0);
        const response=await request(`/calls/${call.id}/end`,0,{version:accepted.version});assert.equal(response.status,200);
        assert.equal(JSON.stringify(await response.json()).includes('session_id'),false);
      }finally{
        sockets.forEach(socket=>socket.disconnect());
        await Promise.all(gateways.map(gateway=>new Promise<void>(done=>gateway.close(()=>done()))));
      }
    });
    await t.test('trip closure ends calls and releases reservations in the same transaction',async()=>{
      const call=await start();
      await pool.query("UPDATE trips SET status='completed' WHERE id=$1",[trip]);
      const closed=await service.getCall(users[0],sessions[0],call.id);
      assert.equal(closed.status,'ended');assert.equal(closed.endReason,'trip_closed');
      assert.equal((await pool.query('SELECT * FROM active_call_participants')).rowCount,0);
      await assert.rejects(start(),/trip_calling_unavailable/);
    });
  }finally{
    Object.assign(env,previous);t.mock.restoreAll();db.query=original.query;db.connect=original.connect;
    await pool.end();await owner.query(`DROP SCHEMA ${schema} CASCADE`);await owner.end();await redis?.quit();await db.end();
  }
});

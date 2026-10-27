import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import express from 'express';
import type { TripMessage } from './communication.types';

test('trip communication persists, orders, recovers and authorizes messages and receipts', {skip:!process.env.RAKKY_TEST_ISOLATED}, async t => {
  const schema=`communication_${process.pid}_${Date.now()}`;
  const owner=new Pool({connectionString:process.env.DATABASE_URL});
  await owner.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
  const {db}=await import('../../shared/config/db.js');
  const originalQuery=db.query,originalConnect=db.connect;
  db.query=pool.query.bind(pool) as typeof db.query;
  db.connect=pool.connect.bind(pool) as typeof db.connect;
  let server:ReturnType<typeof express.application.listen>|undefined;
  try {
    const migrations=(await readdir('migrations')).filter(f=>/^\d+_.*\.sql$/.test(f)).sort();
    for(const file of migrations.filter(f=>f<'023_'))await pool.query(await readFile(resolve('migrations',file),'utf8'));
    const users=(await pool.query<{id:string}>("INSERT INTO users(full_name) VALUES('Rider'),('Driver'),('Outsider') RETURNING id")).rows;
    const createTrip=async(status='driver_assigned',driver:string|null=users[1].id,rider=users[0].id)=> (await pool.query<{id:string}>(`INSERT INTO trips(rider_id,driver_id,status,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key)
      VALUES($1,$2,$3,'cash',6.4,3.4,'Pickup',6.5,3.5,'Destination',1000,300,100000,$4) RETURNING id`,[rider,driver,status,randomUUID()])).rows[0].id;
    const trip=await createTrip();
    await pool.query("INSERT INTO trip_messages(trip_id,sender_id,sender_role,client_message_id,body) VALUES($1,$2,'rider','legacy','Before migration')",[trip,users[0].id]);
    await pool.query(await readFile(resolve('migrations/023_trip_communication.sql'),'utf8'));
    await pool.query(await readFile(resolve('migrations/024_trip_audio_calls.sql'),'utf8'));
    await pool.query(await readFile(resolve('migrations/025_native_call_delivery.sql'),'utf8'));
    const {sendMessage,messageHistory}=await import('./chat.service.js');
    const {getCommunication,recordReceipt}=await import('./communication.service.js');
    const {processCommunicationOutbox,communicationTransport}=await import('./communication.outbox.js');
    const {redis}=await import('../../shared/config/redis.js');
    const {env}=await import('../../config/env.js');
    const resetRate=async()=>{await redis?.del(...users.map(u=>`chat:rate:${u.id}`));};
    const send=(text:string,id:string=randomUUID(),index=0)=>sendMessage(users[index].id,trip,{id,text,senderId:users[2].id,senderRole:'driver'});

    await t.test('migration backfills existing history and assignment controls conversation creation',async()=>{
      const legacy=await messageHistory(users[0].id,trip,{afterSeq:'0'});
      assert.equal(legacy.messages[0].sequence,'1');assert.equal(legacy.highWaterSequence,'1');
      const searching=await createTrip('searching',null,users[2].id);
      assert.equal((await getCommunication(users[2].id,searching)).status,'unavailable');
      await assert.rejects(sendMessage(users[2].id,searching,{id:randomUUID(),text:'Too early'}),/trip_messaging_unavailable/);
      // End searching fixture so the existing active-trip invariant permits later fixtures.
      await pool.query("UPDATE trips SET status='cancelled' WHERE id=$1",[searching]);
      const detail=await getCommunication(users[0].id,trip);
      assert.equal(detail.canMessage,true);assert.equal(detail.canAudioCall,false);assert.equal(detail.canVideoCall,false);
      assert.equal(JSON.stringify(detail).includes('phone'),false);
      await assert.rejects(getCommunication(users[2].id,trip),/trip_not_found/);
    });
    await t.test('retry keys are idempotent, sender identity is derived, and SQL rollback includes outbox',async()=>{
      await resetRate();
      const id=randomUUID();
      const replies=await Promise.all(Array.from({length:8},()=>send('Same retry',id)));
      assert.equal(replies.filter(r=>r.created).length,1);
      assert.equal(new Set(replies.map(r=>r.message.recordId)).size,1);
      assert.equal(replies[0].message.senderId,users[0].id);assert.equal(replies[0].message.senderRole,'rider');
      assert.equal((await pool.query('SELECT id FROM communication_outbox WHERE message_id=$1',[replies[0].message.recordId])).rowCount,2);
      await assert.rejects(send('Changed text',id),/trip_message_conflict/);
      const key=randomUUID();
      await pool.query(`INSERT INTO communication_outbox(trip_id,kind,event_key) VALUES($1,'receipt_socket','rollback-marker')`,[trip]);
      const before=(await getCommunication(users[0].id,trip)).highWaterSequence;
      const client=await pool.connect();
      try {
        await client.query('BEGIN');await client.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE',[trip]);
        await client.query("INSERT INTO trip_messages(trip_id,sender_id,sender_role,client_message_id,body) VALUES($1,$2,'rider',$3,'Rolled back')",[trip,users[0].id,key]);
        await client.query('ROLLBACK');
      } finally {client.release();}
      assert.equal((await getCommunication(users[0].id,trip)).highWaterSequence,before);
      assert.equal((await pool.query('SELECT id FROM trip_messages WHERE client_message_id=$1',[key])).rowCount,0);
      await pool.query(`CREATE FUNCTION fail_delivery_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF EXISTS(SELECT 1 FROM trip_messages WHERE id=NEW.message_id AND body='Force outbox rollback')
        THEN RAISE EXCEPTION 'fixture_outbox_failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_delivery_fixture BEFORE INSERT ON communication_outbox FOR EACH ROW EXECUTE FUNCTION fail_delivery_fixture()`);
      try {
        const count=(await pool.query('SELECT count(*) AS n FROM communication_outbox')).rows[0].n;
        await assert.rejects(send('Force outbox rollback'),/fixture_outbox_failure/);
        assert.equal((await pool.query("SELECT id FROM trip_messages WHERE body='Force outbox rollback'")).rowCount,0);
        assert.equal((await getCommunication(users[0].id,trip)).highWaterSequence,before);
        assert.equal((await pool.query('SELECT count(*) AS n FROM communication_outbox')).rows[0].n,count);
      } finally {await pool.query('DROP TRIGGER fail_delivery_fixture ON communication_outbox; DROP FUNCTION fail_delivery_fixture()');}
    });
    await t.test('forward snapshots and legacy before cursors preserve numeric order beyond sequence 9',async()=>{
      await resetRate();
      const results=await Promise.all(Array.from({length:18},(_,i)=>send(`Concurrent ${i}`)));
      assert.equal(new Set(results.map(r=>r.message.sequence)).size,18);
      const first=await messageHistory(users[1].id,trip,{afterSeq:'0',limit:'7'});
      const snapshot=first.highWaterSequence;
      await send('After the snapshot');
      const collected=[...first.messages];let cursor=first.nextAfter;
      while(cursor){const page=await messageHistory(users[1].id,trip,{afterSeq:cursor,throughSeq:snapshot,limit:'7'});collected.push(...page.messages);cursor=page.nextAfter;}
      assert.equal(collected.length,Number(snapshot));
      assert.deepEqual(collected.map(m=>BigInt(m.sequence)),Array.from({length:Number(snapshot)},(_,i)=>BigInt(i+1)));
      const newest=await messageHistory(users[0].id,trip,{limit:'5'});
      const older=await messageHistory(users[0].id,trip,{before:newest.nextBefore!,limit:'5'});
      assert.ok(BigInt(older.messages.at(-1)!.sequence)<BigInt(newest.messages[0].sequence));
      for(const input of [{before:'1',afterSeq:'0'},{afterSeq:'999999'},{afterSeq:'-1'},{limit:'100'},{throughSeq:'1'},{afterSeq:'9223372036854775808'}]){
        await assert.rejects(messageHistory(users[0].id,trip,input));
      }
      await assert.rejects(send('x'.repeat(2001)),/invalid_trip_message/);
      await assert.rejects(send('bad\u0000text'),/invalid_trip_message/);
    });
    let receiptSequence='0';
    await t.test('read receipts require delivery and advance monotonically only for peer messages',async()=>{
      await resetRate();
      receiptSequence=(await send('Receipt evidence')).message.sequence;
      await assert.rejects(recordReceipt(users[2].id,trip,{kind:'delivered',sequence:receiptSequence}),/trip_not_found/);
      await assert.rejects(recordReceipt(users[1].id,trip,{kind:'read',sequence:receiptSequence}),/chat_receipt_not_delivered/);
      await assert.rejects(recordReceipt(users[0].id,trip,{kind:'delivered',sequence:receiptSequence}),/invalid_chat_receipt/);
      const delivered=await recordReceipt(users[1].id,trip,{kind:'delivered',sequence:receiptSequence});
      const read=await recordReceipt(users[1].id,trip,{kind:'read',sequence:receiptSequence});
      assert.ok(BigInt(read.version)>BigInt(delivered.version));
      assert.equal(read.driver.readSequence,receiptSequence);
      assert.deepEqual(await recordReceipt(users[1].id,trip,{kind:'read',sequence:'0'}),read);
      assert.equal((await messageHistory(users[0].id,trip,{afterSeq:receiptSequence})).receipts!.driver.readSequence,receiptSequence);
      await redis!.set(`chat:receipt:rate:${users[1].id}`,'240','EX',60);
      await assert.rejects(recordReceipt(users[1].id,trip,{kind:'delivered',sequence:receiptSequence}),/chat_receipt_rate_limited/);
      await redis!.del(`chat:receipt:rate:${users[1].id}`);
    });
    await t.test('failed publication remains durable and expired worker leases recover without new sends',async()=>{
      const publications:string[]=[];
      t.mock.method(communicationTransport,'message',()=>{throw new Error('simulated process/transport failure');});
      t.mock.method(communicationTransport,'receipt',()=>undefined);
      t.mock.method(console,'error',()=>undefined);
      // Keep push tasks out of this transport-failure test.
      await pool.query("UPDATE communication_outbox SET available_at=now()+interval '1 hour' WHERE kind='message_push'");
      const failed=await processCommunicationOutbox();assert.ok(failed.failed>0);
      t.mock.method(communicationTransport,'message',(message:TripMessage)=>{publications.push(message.recordId);});
      await pool.query("UPDATE communication_outbox SET available_at=now(),lease_token=$1,lease_until=now()-interval '1 second' WHERE kind='message_socket' AND dispatched_at IS NULL",[randomUUID()]);
      const recovery=await processCommunicationOutbox();assert.ok(recovery.dispatched>0);assert.equal(recovery.failed,0);
      assert.ok(publications.length>0);
      assert.equal((await processCommunicationOutbox()).dispatched,0);
      t.mock.restoreAll();
    });
    await t.test('push is private, deduplicated and suppressed after delivery or trip closure',async()=>{
      t.mock.method(communicationTransport,'message',()=>undefined);t.mock.method(communicationTransport,'receipt',()=>undefined);
      await pool.query("UPDATE communication_outbox SET available_at=now() WHERE kind='message_push'");
      await processCommunicationOutbox();
      assert.equal((await pool.query("SELECT id FROM notifications WHERE type='trip_message'")).rowCount,0);
      await resetRate();await send('Private body never put into notification');
      await pool.query("UPDATE communication_outbox SET available_at=now() WHERE kind='message_push'");
      await processCommunicationOutbox();
      const notification=(await pool.query("SELECT * FROM notifications WHERE type='trip_message'")).rows;
      assert.equal(notification.length,1);assert.equal(JSON.stringify(notification).includes('Private body'),false);
      await resetRate();await send('Another in same burst');
      await pool.query("UPDATE communication_outbox SET available_at=now() WHERE kind='message_push'");await processCommunicationOutbox();
      assert.equal((await pool.query("SELECT id FROM notifications WHERE type='trip_message'")).rowCount,1);
      t.mock.restoreAll();
    });
    await t.test('feature switch blocks new sends but preserves history, and closure is read only with retry recovery',async()=>{
      await resetRate();
      const retry=await send('Committed before closure');
      Object.assign(env,{COMMUNICATION_CHAT_ENABLED:false});
      try {await assert.rejects(send('Feature disabled'),/trip_messaging_unavailable/);assert.equal((await getCommunication(users[0].id,trip)).canMessage,false);}
      finally {Object.assign(env,{COMMUNICATION_CHAT_ENABLED:true});}
      await pool.query("UPDATE trips SET status='completed' WHERE id=$1",[trip]);
      assert.equal((await getCommunication(users[0].id,trip)).status,'closed');
      await assert.rejects(send('Closed'),/trip_messaging_unavailable/);
      assert.equal((await send('Committed before closure',retry.message.id)).created,false);
      assert.ok((await messageHistory(users[0].id,trip)).messages.length>0);
      const returned=await createTrip('returned');assert.equal((await getCommunication(users[0].id,returned)).status,'closed');
    });
    await t.test('new endpoints require authentication and do not disclose third-party trip metadata',async()=>{
      const {communicationRouter}=await import('./communication.routes.js');
      const {signAccessToken}=await import('../auth/jwt.service.js');
      const sessionId=randomUUID();
      await pool.query("INSERT INTO refresh_tokens(user_id,session_id,token_hash,session_scope,expires_at) VALUES($1,$2,$3,'app',now()+interval '1 day')",[users[2].id,sessionId,randomUUID()]);
      const token=signAccessToken(users[2],'app',{id:sessionId,startedAt:new Date()});
      const app=express();app.use(express.json());app.use('/trips',communicationRouter);
      app.use((error:{status?:number;code?:string},_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.status??500).json({error:error.code??'internal_error'}));
      server=app.listen(0,'127.0.0.1');await new Promise<void>(done=>server!.once('listening',done));
      const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      assert.equal((await fetch(`${base}/trips/${trip}/communication`)).status,401);
      assert.equal((await fetch(`${base}/trips/${trip}/communication`,{headers:{Authorization:`Bearer ${token}`}})).status,404);
      assert.equal((await fetch(`${base}/trips/${trip}/communication/receipts`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({kind:'delivered',sequence:'1'})})).status,404);
      await assert.rejects(recordReceipt(users[0].id,trip,{kind:{toString:null},sequence:'1'}),/invalid_chat_receipt/);
    });
    await t.test('an unexpected reassignment cannot expose the original conversation to a new driver',async()=>{
      await pool.query('UPDATE trips SET driver_id=$2 WHERE id=$1',[trip,users[2].id]);
      await assert.rejects(getCommunication(users[2].id,trip),/trip_not_found/);
      await assert.rejects(messageHistory(users[2].id,trip),/trip_not_found/);
      await assert.rejects(getCommunication(users[0].id,trip),/trip_not_found/);
      const events:TripMessage[]=[];
      t.mock.method(communicationTransport,'message',(message:TripMessage)=>{events.push(message);});
      t.mock.method(communicationTransport,'receipt',()=>undefined);
      await pool.query("UPDATE communication_outbox SET dispatched_at=NULL,available_at=now() WHERE kind='message_socket'");
      await processCommunicationOutbox();assert.equal(events.length,0);
      t.mock.restoreAll();
    });
  } finally {
    t.mock.restoreAll();server?.closeAllConnections();
    await new Promise<void>(done=>server?server.close(()=>done()):done());
    db.query=originalQuery;db.connect=originalConnect;
    await pool.end();await owner.query(`DROP SCHEMA ${schema} CASCADE`);await owner.end();
    const {redis}=await import('../../shared/config/redis.js');await redis?.quit();await db.end();
    const {stopCommunicationWorkers}=await import('./communicationQueue.js');await stopCommunicationWorkers();
  }
});

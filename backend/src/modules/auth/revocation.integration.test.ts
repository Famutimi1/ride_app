import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import express from 'express';
import jwt from 'jsonwebtoken';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import type { AuthUserRow } from './auth.types';
import { ApiError } from '../../shared/errors';

dotenv.config({ quiet: true });
test('refresh-credential logout persists revocation without access and dependency outages remain 503', { skip: !process.env.DATABASE_URL }, async t => {
  const schema = `revocation_test_${process.pid}_${Date.now()}`;
  const owner = new Pool({ connectionString: process.env.DATABASE_URL });
  await owner.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const { db, inTransaction } = await import('../../shared/config/db.js');
  const { issueTokenPair, rotateRefreshToken } = await import('./auth.service.js');
  const { authRouter } = await import('./auth.routes.js');
  const { requireAuth } = await import('./auth.middleware.js');
  const { hashToken, signAccessToken, verifyAccessToken } = await import('./jwt.service.js');
  const { env } = await import('../../config/env.js');
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.get('/protected', requireAuth, (_req, res) => res.json({ success: true }));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof ApiError ? error.status : 500).json({ error: error.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(done => server.once('listening', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: object, access?: string) => fetch(`${base}/auth/logout`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}),
  }, body: JSON.stringify(body) });
  try {
    for (const name of (await readdir('migrations')).filter(file => /^\d+_.*\.sql$/.test(file)).sort())
      await db.query(await readFile(resolve('migrations', name), 'utf8'));
    const a = (await db.query<AuthUserRow>("INSERT INTO users(full_name,role) VALUES('Staff fixture','admin') RETURNING *")).rows[0];
    const b = (await db.query<AuthUserRow>("INSERT INTO users(full_name) VALUES('Other fixture') RETURNING *")).rows[0];
    const other = await inTransaction(client => issueTokenPair(b, undefined, client));
    await t.test('expired access does not prevent revocation and cannot revoke another account', async () => {
      const pair = await inTransaction(client => issueTokenPair(a, undefined, client, 'staff'));
      const expired = jwt.sign({ sessionScope: 'staff' }, env.JWT_ACCESS_SECRET, { subject: a.id, expiresIn: -1 });
      assert.equal((await post({ refreshToken: pair.refreshToken, userId: b.id }, expired)).status, 200);
      assert.ok((await db.query('SELECT revoked_at FROM refresh_tokens WHERE token_hash=$1', [hashToken(pair.refreshToken)])).rows[0].revoked_at);
      assert.equal((await fetch(`${base}/protected`,{headers:{Authorization:`Bearer ${pair.accessToken}`}})).status,401,'logout rejects copied access immediately');
      await assert.rejects(inTransaction(client => rotateRefreshToken(pair.refreshToken, undefined, client)).then(result => {
        if (result.reuseDetected) throw new Error('reuse_detected');
      }), /reuse_detected/);
      assert.equal((await db.query('SELECT revoked_at FROM refresh_tokens WHERE token_hash=$1', [hashToken(other.refreshToken)])).rows[0].revoked_at, null);
    });
    await t.test('rotation preserves the family and duplicate in-flight refresh does not destroy its winner',async()=>{
      const first=await inTransaction(client=>issueTokenPair(a,undefined,client,'staff'));
      const results=await Promise.allSettled(Array.from({length:2},()=>inTransaction(client=>rotateRefreshToken(first.refreshToken,undefined,client))));
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
      const failure=results.find(result=>result.status==='rejected');
      assert.equal(failure?.status==='rejected'&&(failure.reason as ApiError).code,'refresh_already_rotated');
      const success=results.find(result=>result.status==='fulfilled');
      if(success?.status!=='fulfilled'||success.value.reuseDetected)assert.fail('No winning refresh');
      const next=success.value.tokens;
      assert.equal(verifyAccessToken(first.accessToken).sessionId,verifyAccessToken(next.accessToken).sessionId);
      assert.equal((await fetch(`${base}/protected`,{headers:{Authorization:`Bearer ${next.accessToken}`}})).status,200);
      const family=await db.query('SELECT session_id,session_started_at FROM refresh_tokens WHERE token_hash=ANY($1::text[])',[[hashToken(first.refreshToken),hashToken(next.refreshToken)]]);
      assert.equal(family.rows[0].session_started_at.getTime(),family.rows[1].session_started_at.getTime());
      await db.query("UPDATE refresh_tokens SET revoked_at=now()-interval '6 seconds' WHERE token_hash=$1",[hashToken(first.refreshToken)]);
      const reuse=await inTransaction(client=>rotateRefreshToken(first.refreshToken,undefined,client));
      assert.equal(reuse.reuseDetected,true);
      assert.equal((await fetch(`${base}/protected`,{headers:{Authorization:`Bearer ${next.accessToken}`}})).status,401);
    });
    await t.test('12-hour staff expiry is enforced by database authority and original sign-in cannot be changed',async()=>{
      const id=randomUUID();
      await db.query("INSERT INTO refresh_tokens(user_id,session_id,token_hash,session_scope,expires_at,session_started_at) VALUES($1,$2,$3,'staff',now()+interval '1 hour',now()-interval '13 hours')",[a.id,id,hashToken('b'.repeat(96))]);
      const forgedLifetime=jwt.sign({sessionScope:'staff',sessionId:id},env.JWT_ACCESS_SECRET,{subject:a.id,expiresIn:'15m'});
      assert.equal((await fetch(`${base}/protected`,{headers:{Authorization:`Bearer ${forgedLifetime}`}})).status,401);
      await assert.rejects(inTransaction(client=>rotateRefreshToken('b'.repeat(96),undefined,client)),{code:'staff_session_expired'});
      await assert.rejects(db.query('UPDATE refresh_tokens SET session_started_at=now() WHERE session_id=$1',[id]),/immutable/);
      assert.equal((await fetch(`${base}/protected`,{headers:{Authorization:`Bearer ${signAccessToken(a,'staff')}`}})).status,401,'legacy staff must sign in again');
    });
    await t.test('refresh-only and duplicate logout work; unknown credentials disclose no identity', async () => {
      const pair = await inTransaction(client => issueTokenPair(a, undefined, client, 'staff'));
      const device=(await db.query<{id:string}>("INSERT INTO push_devices(user_id,expo_push_token,platform,device_identifier) VALUES($1,'ExponentPushToken[logout-fixture]','ios','logout-device') RETURNING id",[a.id])).rows[0];
      const first = await post({ refreshToken: pair.refreshToken, deviceId:device.id });
      assert.deepEqual(await first.json(), { success: true });
      assert.equal((await db.query('SELECT enabled FROM push_devices WHERE id=$1',[device.id])).rows[0].enabled,false);
      assert.deepEqual(await (await post({ refreshToken: pair.refreshToken })).json(), { success: true });
      assert.deepEqual(await (await post({ refreshToken: 'a'.repeat(96) })).json(), { success: true });
      assert.equal((await post({ userId: randomUUID() })).status, 400);
    });
    await t.test('logout disconnects its idle socket across instances and preserves other sessions',async()=>{
      const{attachWebsocket}=await import('../../websocket/index.js');
      type SocketClient={once:(event:string,listener:(...args:unknown[])=>void)=>void;disconnect:()=>void;connected:boolean};
      const{io:client}=createRequire(resolve('../mobile/package.json'))('socket.io-client') as {io:(url:string,options:object)=>SocketClient};
      const servers=[createServer(),createServer()];
      const instances:Awaited<ReturnType<typeof attachWebsocket>>[]=[];
      const clients:SocketClient[]=[];
      try{
        for(const server of servers){instances.push(await attachWebsocket(server));await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));}
        const pairs=await Promise.all([inTransaction(client=>issueTokenPair(a,undefined,client,'staff')),inTransaction(client=>issueTokenPair(a,undefined,client,'staff'))]);
        for(let i=0;i<2;i++){
          const socket=client(`http://127.0.0.1:${(servers[i].address() as AddressInfo).port}`,{transports:['websocket'],auth:{token:pairs[i].accessToken},reconnection:false});clients.push(socket);
          await new Promise<void>((done,reject)=>{socket.once('connect',()=>done());socket.once('connect_error',reject);setTimeout(()=>reject(new Error('fixture socket connect timeout')),3000).unref();});
        }
        const room=`session:${verifyAccessToken(pairs[0].accessToken).sessionId}`;
        assert.equal((await instances[1].in(room).fetchSockets()).length,1);
        const disconnected=new Promise<void>((done,reject)=>{clients[0].once('disconnect',()=>done());setTimeout(()=>reject(new Error('cross-instance session revocation timeout')),2000).unref();});
        assert.equal((await post({refreshToken:pairs[0].refreshToken})).status,200);
        await disconnected;
        assert.equal(clients[0].connected,false);assert.equal(clients[1].connected,true);
        assert.equal((await fetch(`${base}/protected`,{headers:{Authorization:`Bearer ${pairs[0].accessToken}`}})).status,401);
        assert.equal((await fetch(`${base}/protected`,{headers:{Authorization:`Bearer ${pairs[1].accessToken}`}})).status,200);
      }finally{
        clients.forEach(socket=>socket.disconnect());
        await Promise.all(instances.map(instance=>new Promise<void>(done=>instance.close(()=>done()))));
        const{redis}=await import('../../shared/config/redis.js');redis?.disconnect();
      }
    });
    await t.test('valid credentials during a database outage return unavailable instead of 401', async () => {
      const original = db.query.bind(db);
      db.query = (async () => { throw new Error('fixture_database_offline'); }) as typeof db.query;
      try {
        const result = await fetch(`${base}/protected`, { headers: { Authorization: `Bearer ${signAccessToken(b)}` } });
        assert.equal(result.status, 503);
        assert.deepEqual(await result.json(), { error: 'authentication_service_unavailable' });
      } finally { db.query = original; }
      assert.equal((await fetch(`${base}/protected`, { headers: { Authorization: `Bearer ${signAccessToken(b)}` } })).status, 200);
    });
  } finally {
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    await db.end();
    await owner.query(`DROP SCHEMA ${schema} CASCADE`);
    await owner.end();
  }
});

import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import express from 'express';
import test from 'node:test';

test('public auth limits are atomic, bounded, and ignore untrusted forwarded identities',{skip:!process.env.REDIS_URL},async()=>{
  const{limitPublicAuth}=await import('./auth.middleware.js');
  const{env}=await import('../../config/env.js');
  const{ensureRedis}=await import('../../shared/config/redis.js');
  const original={JWT_ACCESS_SECRET:env.JWT_ACCESS_SECRET,AUTH_RATE_LIMIT_PER_MINUTE:env.AUTH_RATE_LIMIT_PER_MINUTE};
  Object.assign(env,{JWT_ACCESS_SECRET:randomBytes(32).toString('hex'),AUTH_RATE_LIMIT_PER_MINUTE:5});
  const app=express();let ip='';app.post('/login',limitPublicAuth,(req,res)=>{ip=req.ip??'';res.json({accepted:true});});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(done=>server.once('listening',done));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const redis=await ensureRedis();
  try{
    const results=await Promise.all(Array.from({length:20},(_,i)=>fetch(base+'/login',{method:'POST',headers:{'X-Forwarded-For':`198.51.100.${i}`}})));
    assert.equal(results.filter(response=>response.status===200).length,5);
    assert.equal(results.filter(response=>response.status===429).length,15);
    assert.ok(results.filter(response=>response.status===429).every(response=>Number(response.headers.get('Retry-After'))>0));
  }finally{
    await redis.del(`auth:request-rate:${createHmac('sha256',env.JWT_ACCESS_SECRET).update(ip).digest('hex')}`);
    Object.assign(env,original);await new Promise<void>(done=>server.close(()=>done()));redis.disconnect();
  }
});

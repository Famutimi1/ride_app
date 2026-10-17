import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({quiet:true});
test('atomic OTP cooldown admits one concurrent send and enforces the window', {skip:!process.env.REDIS_URL}, async () => {
  const {enforceOtpRateLimit}=await import('./otp.service.js');
  const {ensureRedis}=await import('../../shared/config/redis.js');
  const {env}=await import('../../config/env.js');
  const redis=await ensureRedis(), phone=`fixture-${randomUUID()}`;
  const cooldown=`otp:cooldown:${phone}`, rate=`otp:rate:${phone}`;
  try {
    const results=await Promise.allSettled(Array.from({length:20},()=>enforceOtpRateLimit(phone)));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(await redis.get(rate),'1');
    assert.ok(await redis.ttl(cooldown)>0);
    await redis.del(cooldown);
    await redis.set(rate,String(env.OTP_RATE_LIMIT_MAX),'EX',30);
    await assert.rejects(enforceOtpRateLimit(phone),{code:'otp_rate_limited'});
    assert.equal(await redis.exists(cooldown),0);
    await redis.del(rate);
    await enforceOtpRateLimit(phone);
    assert.equal(await redis.get(rate),'1');
  } finally {await redis.del(cooldown,rate);redis.disconnect();}
});

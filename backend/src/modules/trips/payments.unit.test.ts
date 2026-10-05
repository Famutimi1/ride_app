import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { verifyPaystackSignature } from '../payments/gateway';

test('Paystack webhook signature validates raw bytes and rejects tampering',()=>{
  const secret='test-secret';
  const raw=Buffer.from('{"event":"charge.success","data":{"reference":"tu_123"}}');
  const signature=createHmac('sha512',secret).update(raw).digest('hex');
  assert.equal(verifyPaystackSignature(raw,signature,secret),true);
  assert.equal(verifyPaystackSignature(Buffer.from(`${raw.toString()} `),signature,secret),false);
  assert.equal(verifyPaystackSignature(raw,'deadbeef',secret),false);
  assert.equal(verifyPaystackSignature(raw,undefined,secret),false);
});

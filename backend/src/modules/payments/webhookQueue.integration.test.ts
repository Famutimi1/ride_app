import assert from 'node:assert/strict';
import test from 'node:test';
import dotenv from 'dotenv';
import IORedis from 'ioredis';
import {Queue,Worker} from 'bullmq';
dotenv.config();
test('reconciliation retries a retained failed webhook instead of silently adding its existing ID',{skip:!process.env.REDIS_URL,timeout:10000},async()=>{
 const connection=new IORedis(process.env.REDIS_URL!,{maxRetriesPerRequest:null});
 const prefix=`rakky-webhook-test-${process.pid}-${Date.now()}`;
 const queue=new Queue('payments',{connection,prefix});
 let executions=0;
 const worker=new Worker('payments',async()=>{if(++executions===1) throw new Error('disposable test failure');return {ok:true};},{connection,prefix});
 const event=(name:'failed'|'completed')=>new Promise<void>(resolve=>worker.once(name,()=>resolve()));
 const key='disposable-webhook';
 try {
  const {observeWorker,queueHealth}=await import('../../shared/utils/queueHealth.js');
  observeWorker(queue,worker,connection);
  await worker.waitUntilReady();
  const failed=event('failed');
  await queue.add('webhook',{key},{jobId:`webhook-${key}`,attempts:1});
  await failed;
  assert.equal(await (await queue.getJob(`webhook-${key}`))!.getState(),'failed');
  const {queueWebhook}=await import('./paymentQueue.js');
  const completed=event('completed');await queueWebhook(queue,key);await completed;
  assert.equal(executions,2);
  const health=await queueHealth('Disposable webhook worker',queue,connection);
  assert.match(health.details,/1 fresh running worker heartbeats/);
  assert.ok(health.lastSuccessAt);
  assert.ok(health.lastFailureAt);
  assert.equal(await (await queue.getJob(`webhook-${key}`))!.getState(),'completed');
 } finally {
  await worker.close();await queue.obliterate({force:true});await queue.close();await connection.del(queue.toKey("health:workers"),queue.toKey("health:outcomes"));await connection.quit();
  const {stopPaymentWorkers}=await import('./paymentQueue.js');await stopPaymentWorkers();
 }
});

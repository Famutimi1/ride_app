import assert from 'node:assert/strict';
import test from 'node:test';
import type Redis from 'ioredis';
import type {Queue} from 'bullmq';
import {queueHealth} from '../../shared/utils/queueHealth';

test('a stuck queue observation is bounded and never reports healthy',{timeout:5000},async()=>{
  const stuck=()=>new Promise<never>(()=>undefined);
  const queue={getWorkers:stuck,getJobCounts:stuck,getJobs:stuck,isPaused:stuck,toKey:(key:string)=>key} as unknown as Queue;
  const started=Date.now();
  const client={zrangebyscore:stuck,hgetall:stuck,mget:stuck} as unknown as Redis;
  const result=await queueHealth('Test queue',queue,client);
  assert.equal(result.state,'unknown');
  assert.ok(Date.now()-started>=2900);
  assert.ok(Date.now()-started<4500);
});

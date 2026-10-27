import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceDriverMotion,type MotionSample } from './driverMotion';

const fix=(time:number,patch:Partial<MotionSample>={})=>({latitude:6.4,longitude:3.4,timestamp:time,sampleTimestamp:time,accuracy:5,speed:0,...patch});
test('stationary evidence needs distinct accurate samples; heartbeats cannot renew its freshness',()=>{
  let sample=advanceDriverMotion(null,fix(10000),10000);
  sample=advanceDriverMotion(sample,fix(14000),14000);
  sample=advanceDriverMotion(sample,fix(18000),18000);
  assert.equal(sample.stationarySince,10000);assert.equal(sample.stationarySamples,3);
  const repeated=advanceDriverMotion(sample,fix(18000,{timestamp:24000}),24000);
  assert.equal(repeated.motionReceivedAt,18000);assert.equal(repeated.stationarySamples,3);
  assert.equal(advanceDriverMotion(repeated,fix(26000),26000).stationarySamples,1);
});
test('motion, uncertain accuracy, stale/future fixes and repeated timestamps cannot certify stationary driving',()=>{
  const previous=advanceDriverMotion(null,fix(10000),10000);
  for(const patch of [{speed:5},{accuracy:100},{latitude:6.41}])assert.equal(advanceDriverMotion(previous,fix(14000,patch),14000).stationarySince,null);
  assert.equal(advanceDriverMotion(previous,fix(1000),14000).stationarySince,null);
  assert.equal(advanceDriverMotion(previous,fix(17000),14000).stationarySince,null);
  const changed=advanceDriverMotion(previous,fix(10000,{speed:4}),14000);assert.equal(changed.stationarySince,null);
});

import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import test from 'node:test';

test('Paystack transport preserves evidence, classifies outages and never invents balances',{timeout:15000},async(t)=>{
 let mode='valid';let calls=0;const paths:string[]=[];
 const transfer={reference:'wd_fixture',domain:'test',amount:50000,currency:'NGN',recipient:{recipient_code:'RCP_fixture'},transfer_code:'TRF_fixture',status:'success'};
 const server=createServer((req,res)=>{
   calls++;paths.push(req.url!);res.setHeader('Content-Type','application/json');
   if(mode==='unavailable'){res.writeHead(503);return void res.end(JSON.stringify({status:false,message:'unavailable'}));}
   if(mode==='access'){res.writeHead(400);return void res.end(JSON.stringify({status:false,message:'Starter business transfer restriction',code:'transfer_unavailable'}));}
   if(mode==='missing'){res.writeHead(400);return void res.end(JSON.stringify({status:false,message:'Transfer not found'}));}
   if(mode==='rejected'){res.writeHead(400);return void res.end(JSON.stringify({status:false,message:'Recipient not found'}));}
   if(mode==='html'){res.writeHead(502);return void res.end('<html>proxy error</html>');}
   if(mode==='empty'){return void res.end(JSON.stringify({status:true,data:null}));}
   let data:unknown;
   if(req.url==='/balance')data=mode==='no-ngn'?[{currency:'USD',balance:200}]:[{currency:'NGN',balance:123000}];
   else if(req.url?.startsWith('/transaction/verify/'))data={reference:'tu_fixture',domain:'test',status:'success',amount:100000,currency:'NGN',fees:3000,channel:'card',paid_at:'2026-10-12T10:00:00.000Z'};
   else if(req.url==='/transfer/TRF_fixture')data={...transfer,fee_charged:1234};
   else data=transfer;
   res.end(JSON.stringify({status:true,data}));
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 process.env.PAYSTACK_BASE_URL=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const {gateway}=await import('./gateway.js');
 try {
  await t.test('reads explicit NGN balance and includes charge domain',async()=>{
   assert.equal(await gateway.getBalance(),123000);assert.equal((await gateway.verifyCharge('tu_fixture')).domain,'test');
   mode='no-ngn';await assert.rejects(gateway.getBalance(),/paystack_invalid_response/);mode='valid';
  });
  await t.test('fetches documented actual transfer fee when verify omits it',async()=>{
   const result=await gateway.verifyTransfer('wd_fixture');assert.equal(result.feeKobo,1234);assert.equal(result.recipientCode,'RCP_fixture');assert.ok(paths.includes('/transfer/TRF_fixture'));
  });
  await t.test('not-found is scoped to transfer lookup; other rejections cannot authorize retry',async()=>{
   mode='missing';calls=0;await assert.rejects(gateway.verifyTransfer('wd_missing'),/paystack_not_found/);assert.equal(calls,1);
   mode='rejected';calls=0;await assert.rejects(gateway.verifyTransfer('wd_missing'),/paystack_rejected/);assert.equal(calls,1);
  });
  await t.test('provider transfer restrictions are service errors and are not retried as transient GET failures',async()=>{
   mode='access';calls=0;await assert.rejects(gateway.verifyTransfer('wd_fixture'),/paystack_access_denied/);assert.equal(calls,1);mode='valid';
  });
  await t.test('live provider writes are independently disabled before any network request',async()=>{
   const {env}=await import('../../config/env.js');const mutable=env as {PAYSTACK_SECRET_KEY:string;ENABLE_LIVE_PAYMENTS:boolean};const original=mutable.PAYSTACK_SECRET_KEY;
   try{mutable.PAYSTACK_SECRET_KEY='sk_live_disabled_fixture';mutable.ENABLE_LIVE_PAYMENTS=false;calls=0;await assert.rejects(gateway.initiateTransfer({amountKobo:50000,recipientCode:'RCP_fixture',reference:'wd_fixture',reason:'Fixture'}),/live_payments_disabled/);assert.equal(calls,0);}
   finally{mutable.PAYSTACK_SECRET_KEY=original;}
  });
  await t.test('retries only reads and sanitizes proxy/non-JSON errors',async()=>{
   mode='unavailable';calls=0;await assert.rejects(gateway.getBalance(),/paystack_unavailable/);assert.equal(calls,3);
   calls=0;await assert.rejects(gateway.initiateTransfer({amountKobo:50000,recipientCode:'RCP_fixture',reference:'wd_fixture',reason:'Fixture'}),/paystack_unavailable/);assert.equal(calls,1);
   mode='html';await assert.rejects(gateway.getBalance(),/paystack_invalid_response/);
   mode='empty';await assert.rejects(gateway.getBalance(),/paystack_invalid_response/);
  });
 }finally{await new Promise<void>(done=>server.close(()=>done()));const {redis}=await import('../../shared/config/redis.js');await redis?.quit();}
});

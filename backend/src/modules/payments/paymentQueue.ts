import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { env } from '../../config/env';

const connection=env.REDIS_URL?new IORedis(env.REDIS_URL,{maxRetriesPerRequest:null}):null;
const queue=connection?new Queue('payments',{connection}):null;
let started=false;
export async function enqueueWebhook(key:string) {
  if (!queue) throw new Error('Redis is required for payment webhook processing');
  await queue.add('webhook',{key},{jobId:`webhook-${key}`.replace(/[^a-zA-Z0-9_-]/g,'-'),attempts:5,backoff:{type:'exponential',delay:1000},removeOnComplete:1000});
}
export async function enqueuePayout(id:string) {
  if (!queue) throw new Error('Redis is required for payouts');
  await queue.add('payout',{id},{jobId:`payout-${id}-${Date.now()}`,attempts:5,backoff:{type:'exponential',delay:30000},removeOnComplete:1000});
}
export async function startPaymentWorkers() {
  if (!connection||!queue||started) return;
  started=true;
  const worker=new Worker('payments',async(job)=>{
    if (job.name==='webhook') { const {processWebhook}=await import('./webhook.service.js');await processWebhook(String(job.data.key)); }
    else if (job.name==='payout') { const {initiatePayout}=await import('./withdrawals.service.js');await initiatePayout(String(job.data.id)); }
    else {
      const checks=await import('./reconciliation.service.js');
      if (job.name==='topup-reconciler') await checks.reconcileTopups();
      if (job.name==='withdrawal-reconciler') await checks.reconcileWithdrawals();
      if (job.name==='ledger-integrity') await checks.checkLedgerIntegrity();
      if (job.name==='gateway-balance-check') await checks.checkGatewayBalance();
      if (job.name==='stuck-escrow-check') await checks.checkStuckEscrow();
      if (job.name==='daily-finance-report') await checks.dailyFinanceReport();
    }
  },{connection});
  worker.on('error',(error)=>console.error('[payments] worker error',error.message));
  for (const [name,every] of [['topup-reconciler',600000],['withdrawal-reconciler',300000],['gateway-balance-check',3600000],['stuck-escrow-check',900000]] as const)
    await queue.upsertJobScheduler(name,{every},{name});
  await queue.upsertJobScheduler('ledger-integrity',{pattern:'0 0 1 * * *',tz:'Africa/Lagos'},{name:'ledger-integrity'});
  await queue.upsertJobScheduler('daily-finance-report',{pattern:'0 30 0 * * *',tz:'Africa/Lagos'},{name:'daily-finance-report'});
}

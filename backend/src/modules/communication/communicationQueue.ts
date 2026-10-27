import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { env } from '../../config/env';
import { observeWorker, queueHealth } from '../../shared/utils/queueHealth';
import { processCommunicationOutbox } from './communication.outbox';
import { db } from '../../shared/config/db';
import { expireCalls } from './call.service';
import { processCallOutbox } from './call.outbox';
import { processCallPushDeliveries } from './callPush.service';

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;
function resources() {
  if (!env.REDIS_URL) throw new Error('Redis is required for communication delivery');
  connection??=new IORedis(env.REDIS_URL,{maxRetriesPerRequest:null});
  queue??=new Queue('communication',{connection,prefix:env.TRIP_QUEUE_PREFIX,defaultJobOptions:{removeOnComplete:100,removeOnFail:100}});
  return {connection,queue};
}
export async function requestCommunicationDispatch(): Promise<void> {
  if (process.env.RAKKY_TEST_ISOLATED==='true') return;
  const {queue}=resources();
  await queue.add('dispatch',{}, {jobId:'communication-dispatch',removeOnComplete:true,removeOnFail:true});
}
export async function startCommunicationWorkers(): Promise<void> {
  if (worker) return;
  // Refuse a seemingly ready deployment that has not applied migration 023.
  await db.query('SELECT trip_id FROM trip_communications LIMIT 0');
  await db.query('SELECT id FROM communication_outbox LIMIT 0');
  await db.query('SELECT id,media,video_policy_until,video_upgrade_by,video_upgrade_until FROM call_sessions LIMIT 0');
  await db.query('SELECT id FROM call_outbox LIMIT 0');
  await db.query('SELECT id FROM call_push_deliveries LIMIT 0');
  const {connection,queue}=resources();
  worker=new Worker('communication',async()=>{
    await expireCalls();
    await Promise.all([processCallOutbox(),processCommunicationOutbox(),processCallPushDeliveries()]);
  },{connection,prefix:env.TRIP_QUEUE_PREFIX,concurrency:3});
  worker.on('error',()=>console.error('[communication] worker unavailable'));
  observeWorker(queue,worker,connection);
  await worker.waitUntilReady();
  await queue.upsertJobScheduler('communication-recovery',{every:1000},{name:'dispatch',opts:{removeOnComplete:100,removeOnFail:100}});
  await requestCommunicationDispatch();
}
export async function stopCommunicationWorkers(): Promise<void> {
  await worker?.close();worker=null;
  await queue?.close();queue=null;
  await connection?.quit();connection=null;
}
export async function getCommunicationQueueHealth() {
  return queueHealth('Trip communication delivery',queue,connection??undefined);
}
export function communicationWorkersReady(): boolean {
  return connection?.status==='ready'&&worker!==null&&worker.isRunning()&&!worker.isPaused();
}
export async function communicationQueueAccepting(): Promise<boolean> {
  return communicationWorkersReady()&&Boolean(queue)&&!await queue!.isPaused();
}

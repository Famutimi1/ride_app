import { isServiceOfferCurrent } from '../matching/serviceEligibility';
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { env } from '../../config/env';
import { db } from '../../shared/config/db';
import { observeWorker, queueHealth } from '../../shared/utils/queueHealth';
import {notificationCategoryEnabled,type DeliveryPreferences} from './notificationPolicy';
export {notificationCategoryEnabled,type DeliveryPreferences} from './notificationPolicy';
import {processBrowserNotification} from './webPush.service';

let connection:IORedis|null=null;
let queue:Queue|null=null;
let worker:Worker|null=null;
let started=false;

function notificationQueueResources(){
  if(!env.REDIS_URL)throw new Error('Redis is required for notification delivery');
  connection??=new IORedis(env.REDIS_URL,{maxRetriesPerRequest:null});
  queue??=new Queue('notifications',{connection,prefix:env.TRIP_QUEUE_PREFIX});
  return{connection,queue};
}

interface DeliveryRow extends DeliveryPreferences {
  id:string;user_id:string;type:string;priority:'low'|'normal'|'high';title:string;body:string;data:Record<string,unknown>;deep_link:string|null;expires_at:Date|null;
}
interface ExpoTicket {status:'ok'|'error';id?:string;message?:string;details?:{error?:string}}
interface ExpoReceipt {status:'ok'|'error';message?:string;details?:{error?:string}}


export function buildExpoPushMessage(row:Pick<DeliveryRow,'type'|'category'|'priority'|'title'|'body'|'data'|'deep_link'|'sound_enabled'>,token:string,id:string,ttl?:number){const{sendPush:_sendPush,...data}=row.data;return{to:token,title:row.title,body:row.body,data:{...data,notificationId:id,type:row.type,category:row.category,priority:row.priority,deepLink:row.deep_link},priority:row.priority==='high'?'high':'default',sound:row.sound_enabled?'default':null,channelId:row.category,...(ttl===undefined?{}:{ttl})};}

async function expoPost(path:string,body:unknown){
  const response=await fetch(`https://exp.host/--/api/v2/push/${path}`,{method:'POST',headers:{Accept:'application/json','Accept-Encoding':'gzip, deflate','Content-Type':'application/json',...(env.EXPO_ACCESS_TOKEN?{Authorization:`Bearer ${env.EXPO_ACCESS_TOKEN}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error(`expo_push_http_${response.status}`);
  return response.json() as Promise<{data:unknown}>;
}

async function processNotification(id:string){
  const locked=await db.query<DeliveryRow>(`UPDATE notifications n SET delivery_status='sending',delivery_attempts=delivery_attempts+1,updated_at=now()
    FROM (SELECT n2.id FROM notifications n2 WHERE n2.id=$1 AND n2.delivery_status IN ('queued','sending','failed') FOR UPDATE SKIP LOCKED) selected
    WHERE n.id=selected.id RETURNING n.id,n.user_id,n.type,n.category,n.priority,n.title,n.body,n.data,n.deep_link,n.expires_at,
    COALESCE((SELECT push_enabled FROM notification_preferences WHERE user_id=n.user_id),true) push_enabled,
    COALESCE((SELECT trip_updates_enabled FROM notification_preferences WHERE user_id=n.user_id),true) trip_updates_enabled,
    COALESCE((SELECT driver_offers_enabled FROM notification_preferences WHERE user_id=n.user_id),true) driver_offers_enabled,
    COALESCE((SELECT scheduled_reminders_enabled FROM notification_preferences WHERE user_id=n.user_id),true) scheduled_reminders_enabled,
    COALESCE((SELECT wallet_updates_enabled FROM notification_preferences WHERE user_id=n.user_id),true) wallet_updates_enabled,
    COALESCE((SELECT promotions_enabled FROM notification_preferences WHERE user_id=n.user_id),false) promotions_enabled,
    COALESCE((SELECT sound_enabled FROM notification_preferences WHERE user_id=n.user_id),true) sound_enabled,
    COALESCE((SELECT vibration_enabled FROM notification_preferences WHERE user_id=n.user_id),true) vibration_enabled`,[id]);
  const row=locked.rows[0];if(!row)return;
  if(row.type==='ride_offer'){
    const current=typeof row.data.tripId==='string'&&/^[0-9a-f-]{36}$/i.test(row.data.tripId)&&await isServiceOfferCurrent(row.user_id,row.data.tripId);
    if(!current){await db.query("UPDATE notifications SET delivery_status='skipped',last_delivery_error='offer_no_longer_eligible',updated_at=now() WHERE id=$1",[id]);return;}
  }
  if((row.expires_at&&row.expires_at.getTime()<=Date.now())||!notificationCategoryEnabled(row)){
    await db.query("UPDATE notifications SET delivery_status='skipped',last_delivery_error=$2,updated_at=now() WHERE id=$1",[id,row.expires_at&&row.expires_at.getTime()<=Date.now()?'notification_expired':'disabled_by_preferences']);return;
  }
  const devices=await db.query<{expo_push_token:string}>(`SELECT d.expo_push_token FROM push_devices d JOIN notifications n ON n.user_id=d.user_id WHERE n.id=$1 AND d.enabled=true AND d.revoked_at IS NULL`,[id]);
  if(!devices.rowCount){await db.query("UPDATE notifications SET delivery_status='skipped',last_delivery_error='no_registered_devices',updated_at=now() WHERE id=$1",[id]);return;}
  const ttl=row.expires_at?Math.max(0,Math.floor((row.expires_at.getTime()-Date.now())/1000)):undefined;
  const messages=devices.rows.map(device=>buildExpoPushMessage(row,device.expo_push_token,id,ttl));
  const stored:{id:string|null;token:string;status:'ok'|'error';error:string|null}[]=[];
  for(let offset=0;offset<messages.length;offset+=100){
    const response=await expoPost('send',messages.slice(offset,offset+100));
    const tickets=(Array.isArray(response.data)?response.data:[response.data]) as ExpoTicket[];
    for(const [index,ticket] of tickets.entries())stored.push({id:ticket.id??null,token:devices.rows[offset+index]?.expo_push_token??'',status:ticket.status,error:ticket.details?.error??ticket.message??null});
  }
  for(const ticket of stored)if(ticket.error==='DeviceNotRegistered')await db.query("UPDATE push_devices SET enabled=false,revoked_at=now(),revocation_reason='device_not_registered',updated_at=now() WHERE expo_push_token=$1",[ticket.token]);
  const ticketIds=stored.filter(ticket=>ticket.id).map(ticket=>({id:ticket.id,token:ticket.token}));
  const accepted=stored.some(ticket=>ticket.status==='ok');
  await db.query('UPDATE notifications SET delivery_status=$2,push_ticket_ids=$3,last_delivery_error=$4,updated_at=now() WHERE id=$1',[id,accepted?'sent':'failed',JSON.stringify(ticketIds),accepted?null:stored.map(item=>item.error).filter(Boolean).join(',').slice(0,240)||'expo_rejected']);
  if(!accepted)throw new Error('expo_rejected_notification');
}

export async function processNotificationReceipts(){
  const {rows}=await db.query<{id:string;push_ticket_ids:Array<{id:string;token:string}>}>(`SELECT id,push_ticket_ids FROM notifications WHERE delivery_status='sent' AND jsonb_array_length(push_ticket_ids)>0 AND updated_at<now()-interval '30 seconds' ORDER BY updated_at LIMIT 100`);
  for(const notification of rows){
    const response=await expoPost('getReceipts',{ids:notification.push_ticket_ids.map(item=>item.id)});const receipts=response.data as Record<string,ExpoReceipt>;
    let delivered=false;
    const errors=new Set<string>();
    for(const ticket of notification.push_ticket_ids){
      const receipt=receipts[ticket.id];
      if(!receipt)continue;
      if(receipt.status==='ok'){
        delivered=true;
      }else{
        errors.add(receipt.details?.error??'expo_receipt_error');
        if(receipt.details?.error==='DeviceNotRegistered')await db.query("UPDATE push_devices SET enabled=false,revoked_at=now(),revocation_reason='device_not_registered',updated_at=now() WHERE expo_push_token=$1",[ticket.token]);
      }
    }
    if(delivered||errors.size){
      // The status column is varchar, while CASE comparisons otherwise infer text
      // for the same parameter. Give both uses one explicit PostgreSQL type.
      await db.query(`UPDATE notifications SET delivery_status=$2::text,
        delivered_at=CASE WHEN $2::text='delivered' THEN COALESCE(delivered_at,now()) ELSE delivered_at END,
        last_delivery_error=$3,updated_at=now() WHERE id=$1`,
      [notification.id,delivered?'delivered':'failed',delivered?null:[...errors].join(',').slice(0,240)]);
    }
  }
}

async function recoverQueued(){
  const {rows}=await db.query<{id:string}>(`SELECT id FROM notifications WHERE (delivery_status='queued' AND updated_at<now()-interval '15 seconds') OR (delivery_status='sending' AND updated_at<now()-interval '2 minutes') OR (delivery_status='failed' AND delivery_attempts<5 AND updated_at<now()-interval '5 minutes') ORDER BY updated_at LIMIT 500`);
  await Promise.all(rows.map(row=>enqueueNotification(row.id)));
}

export async function enqueueNotification(id:string){if(process.env.RAKKY_TEST_ISOLATED==='true')return;const resources=notificationQueueResources();await resources.queue.add('deliver-web',{id},{jobId:`web-notification-${id}`,attempts:5,backoff:{type:'exponential',delay:2000},removeOnComplete:1000,removeOnFail:1000});const jobId=`notification-${id}`;const existing=await resources.queue.getJob(jobId);if(existing){const state=await existing.getState();if(state==='failed'){await existing.retry('failed');return;}if(state!=='completed')return;await existing.remove();}await resources.queue.add('deliver',{id},{jobId,attempts:5,backoff:{type:'exponential',delay:2000},removeOnComplete:1000,removeOnFail:1000});}
export async function startNotificationWorkers(){if(started)return;const resources=notificationQueueResources();started=true;worker=new Worker('notifications',async job=>{if(job.name==='deliver-web')await processBrowserNotification(String(job.data.id));else if(job.name==='deliver')await processNotification(String(job.data.id));else if(job.name==='receipts')await processNotificationReceipts();else if(job.name==='recovery')await recoverQueued();},{connection:resources.connection,prefix:env.TRIP_QUEUE_PREFIX});observeWorker(resources.queue,worker,resources.connection);worker.on('error',error=>console.error('[notifications] worker error',error.message));await worker.waitUntilReady();await resources.queue.upsertJobScheduler('notification-receipts',{every:60_000},{name:'receipts'});await resources.queue.upsertJobScheduler('notification-recovery',{every:60_000},{name:'recovery'});await recoverQueued();}
export async function stopNotificationWorkers(){await worker?.close();worker=null;await queue?.close();queue=null;await connection?.quit();connection=null;started=false;}
export function notificationWorkersReady(){return started&&connection?.status==='ready'&&worker!==null&&worker.isRunning()&&!worker.isPaused();}
export async function notificationQueueAccepting(){return notificationWorkersReady()&&Boolean(queue)&&!await queue!.isPaused();}
export async function getNotificationQueueHealth(){return [await queueHealth('Notification delivery worker',queue,connection??undefined)];}
export async function getNotificationDeliveryHealth(){
  const observedAt=new Date().toISOString();
  try{
    const delivery=(await db.query<{created:string;delivered:string;failed:string;queued:string;opened:string;average_attempts:string|null;offer_latency_ms:string|null}>(`SELECT
      COUNT(*)::text created,COUNT(*) FILTER(WHERE delivery_status='delivered')::text delivered,
      COUNT(*) FILTER(WHERE delivery_status='failed')::text failed,COUNT(*) FILTER(WHERE delivery_status IN ('queued','sending'))::text queued,
      COUNT(*) FILTER(WHERE opened_at IS NOT NULL)::text opened,AVG(delivery_attempts)::text average_attempts,
      AVG(EXTRACT(EPOCH FROM(delivered_at-created_at))*1000) FILTER(WHERE category='driver_offers' AND delivered_at IS NOT NULL)::text offer_latency_ms
      FROM notifications WHERE created_at>=now()-interval '24 hours'`)).rows[0];
    const invalid=Number((await db.query<{count:string}>("SELECT COUNT(*)::text count FROM push_devices WHERE revocation_reason='device_not_registered' AND revoked_at>=now()-interval '24 hours'")).rows[0].count);
    const failed=Number(delivery.failed),queued=Number(delivery.queued),created=Number(delivery.created),opened=Number(delivery.opened);
    return{name:'Notification delivery (24h)',state:failed||queued?'degraded':'reachable',observedAt,latencyMs:null,details:`${created} created · ${delivery.delivered} delivered · ${failed} failed · ${queued} queued/sending · ${invalid} invalid tokens · ${created?Math.round(opened/created*100):0}% opened · ${Math.round(Number(delivery.offer_latency_ms??0))}ms average offer delivery · ${Number(delivery.average_attempts??0).toFixed(2)} average attempts`};
  }catch{return{name:'Notification delivery (24h)',state:'unknown',observedAt,latencyMs:null,details:'Notification delivery metrics are unavailable'};}
}

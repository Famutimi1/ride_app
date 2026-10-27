import {createHash,createECDH,ECDH} from 'node:crypto';
import webpush from 'web-push';
import {db,inTransaction} from '../../shared/config/db';
import {env} from '../../config/env';
import {ApiError} from '../../shared/errors';
import {ensureRedis} from '../../shared/config/redis';
import {notificationCategoryEnabled,type DeliveryPreferences} from './notificationPolicy';
import {isServiceOfferCurrent} from '../matching/serviceEligibility';
import {notificationAudience} from './notificationAudience';
import {chatPushEligible} from '../communication/communication.policy';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function webPushConfiguration(){
  try{
    if(!/^[A-Za-z0-9_-]+$/.test(env.WEB_PUSH_PUBLIC_KEY)||!env.WEB_PUSH_PRIVATE_KEY)throw new Error('missing');
    const publicKey=Buffer.from(env.WEB_PUSH_PUBLIC_KEY,'base64url'),privateKey=Buffer.from(env.WEB_PUSH_PRIVATE_KEY,'base64url');
    const curve=createECDH('prime256v1');curve.setPrivateKey(privateKey);
    if(publicKey.length!==65||privateKey.length!==32||!curve.getPublicKey().equals(publicKey)||!(/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(env.WEB_PUSH_SUBJECT)))throw new Error('invalid');
    return {configured:true,publicKey:env.WEB_PUSH_PUBLIC_KEY};
  }catch{return {configured:false,publicKey:null};}
}
export function browserEndpoint(value:unknown){
  if(typeof value!=='string'||value.length>2048)throw new ApiError(400,'invalid_browser_subscription');
  try{const url=new URL(value);if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!['fcm.googleapis.com','android.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname))throw new Error('blocked');return url.toString();}catch{throw new ApiError(400,'invalid_browser_subscription');}
}
const hash=(endpoint:string)=>createHash('sha256').update(endpoint).digest('hex');
export async function registerBrowser(userId:string,sessionId:string|undefined,input:unknown){
  if(!webPushConfiguration().configured)throw new ApiError(503,'browser_push_not_configured');
  if(!sessionId)throw new ApiError(403,'browser_push_session_required');
  const value=input as {endpoint?:unknown;keys?:{p256dh?:unknown;auth?:unknown}}|null;
  const endpoint=browserEndpoint(value?.endpoint),p256dh=value?.keys?.p256dh,auth=value?.keys?.auth;
  if(typeof p256dh!=='string'||typeof auth!=='string'||!/^[A-Za-z0-9_-]{86,88}$/.test(p256dh)||!/^[A-Za-z0-9_-]{22,24}$/.test(auth))throw new ApiError(400,'invalid_browser_subscription');
  try{if(Buffer.from(p256dh,'base64url').length!==65||Buffer.from(auth,'base64url').length!==16)throw new Error('invalid');ECDH.convertKey(Buffer.from(p256dh,'base64url'),'prime256v1');}catch{throw new ApiError(400,'invalid_browser_subscription');}
  const redis=await ensureRedis(),count=Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],3600) end; return n",1,`web-push:register:${userId}`));
  if(count>30)throw new ApiError(429,'browser_push_rate_limited');
  return inTransaction(async client=>{
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    if(!(await client.query("SELECT 1 FROM refresh_tokens WHERE user_id=$1 AND session_id=$2 AND session_scope='app' AND revoked_at IS NULL AND expires_at>now()",[userId,sessionId])).rowCount)throw new ApiError(401,'invalid_or_expired_token');
    const total=(await client.query<{count:number}>('SELECT count(*)::int AS count FROM web_push_subscriptions WHERE user_id=$1 AND enabled=true AND endpoint_hash<>$2',[userId,hash(endpoint)])).rows[0].count;
    if(total>=20)throw new ApiError(429,'browser_push_device_limit');
    const {rows}=await client.query<{id:string}>(`INSERT INTO web_push_subscriptions(user_id,session_id,endpoint_hash,endpoint,p256dh,auth) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(endpoint_hash) DO UPDATE SET user_id=EXCLUDED.user_id,session_id=EXCLUDED.session_id,endpoint=EXCLUDED.endpoint,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,enabled=true,last_error=NULL,updated_at=now() RETURNING id`,[userId,sessionId,hash(endpoint),endpoint,p256dh,auth]);
    return {id:rows[0].id,enabled:true};
  });
}
export async function browserStatus(userId:string,sessionId:string|undefined,endpointValue:unknown){
  const endpoint=browserEndpoint(endpointValue);
  const row=(await db.query<{id:string;enabled:boolean}>('SELECT id,enabled FROM web_push_subscriptions WHERE user_id=$1 AND session_id=$2 AND endpoint_hash=$3',[userId,sessionId??null,hash(endpoint)])).rows[0];
  return row??{id:null,enabled:false};
}
export async function revokeBrowser(userId:string,id:string){
  if(!uuid.test(id))throw new ApiError(404,'browser_subscription_not_found');
  await db.query('UPDATE web_push_subscriptions SET enabled=false,updated_at=now() WHERE id=$1 AND user_id=$2',[id,userId]);
  return {success:true};
}
interface BrowserNotification extends DeliveryPreferences {id:string;user_id:string;type:string;title:string;data:Record<string,unknown>;event_key:string;deep_link:string|null;expires_at:Date|null;web_push_results:Record<string,{status:string;attempts:number}>}
interface Subscription {id:string;endpoint:string;p256dh:string;auth:string}
export function browserDestination(row:Pick<BrowserNotification,'data'|'category'|'type'|'event_key'|'deep_link'>){
  const driver=notificationAudience({...row,type:row.type,eventKey:row.event_key,deepLink:row.deep_link})==='driver',prefix=driver?'/drive':'/ride';
  if(typeof row.data.tripId==='string'&&uuid.test(row.data.tripId))return `${prefix}/trips/${row.data.tripId}`;
  if(row.category==='wallet_updates')return driver?'/drive/earnings':'/ride/wallet';
  if(row.category==='support')return `${prefix}/help`;
  return `${prefix}/notifications`;
}
export const browserPushProvider={send:(subscription:webpush.PushSubscription,payload:string,ttl:number,topic:string)=>webpush.sendNotification(subscription,payload,{vapidDetails:{subject:env.WEB_PUSH_SUBJECT,publicKey:env.WEB_PUSH_PUBLIC_KEY,privateKey:env.WEB_PUSH_PRIVATE_KEY},TTL:ttl,topic,timeout:10000,urgency:'normal'})};
export async function processBrowserNotification(id:string){
  if(!webPushConfiguration().configured)return;
  const row=(await db.query<BrowserNotification>(`SELECT n.*,COALESCE(p.push_enabled,true) push_enabled,COALESCE(p.trip_updates_enabled,true) trip_updates_enabled,COALESCE(p.driver_offers_enabled,true) driver_offers_enabled,COALESCE(p.scheduled_reminders_enabled,true) scheduled_reminders_enabled,COALESCE(p.wallet_updates_enabled,true) wallet_updates_enabled,COALESCE(p.promotions_enabled,false) promotions_enabled,COALESCE(p.sound_enabled,true) sound_enabled,COALESCE(p.vibration_enabled,true) vibration_enabled FROM notifications n LEFT JOIN notification_preferences p ON p.user_id=n.user_id WHERE n.id=$1`,[id])).rows[0];
  if(!row||row.data?.sendPush===false||!notificationCategoryEnabled(row)||row.expires_at&&row.expires_at.getTime()<=Date.now())return;
  if(row.type==='trip_message'&&!await chatPushEligible(db,row.user_id,row.data))return;
  if(row.type==='ride_offer'&&!(typeof row.data.tripId==='string'&&uuid.test(row.data.tripId)&&await isServiceOfferCurrent(row.user_id,row.data.tripId)))return;
  const subscriptions=(await db.query<Subscription>(`SELECT s.id,s.endpoint,s.p256dh,s.auth FROM web_push_subscriptions s JOIN users u ON u.id=s.user_id WHERE s.user_id=$1 AND s.enabled=true AND u.is_active=true AND EXISTS(SELECT 1 FROM refresh_tokens r WHERE r.user_id=s.user_id AND r.session_id=s.session_id AND r.session_scope='app' AND r.revoked_at IS NULL AND r.expires_at>now()) ORDER BY s.created_at LIMIT 20`,[row.user_id])).rows;
  let retry=false;
  for(const subscription of subscriptions){
    const previous=row.web_push_results?.[subscription.id];if(previous?.status==='sent'||previous?.status==='gone'||(previous?.attempts??0)>=5)continue;
    let status='sent',error:string|null=null;
    try{
      browserEndpoint(subscription.endpoint);
      // Recheck revocation just before each outbound transmission.
      if(!(await db.query(`SELECT 1 FROM web_push_subscriptions s WHERE s.id=$1 AND s.user_id=$2 AND s.enabled=true AND EXISTS(SELECT 1 FROM refresh_tokens r WHERE r.user_id=s.user_id AND r.session_id=s.session_id AND r.revoked_at IS NULL AND r.expires_at>now())`,[subscription.id,row.user_id])).rowCount)continue;
      const payload=JSON.stringify({title:'Rakky Ride',body:'You have a new Rakky Ride update.',notificationId:id,url:browserDestination(row),tag:`rakky-${id}`,silent:!row.sound_enabled});
      const ttl=Math.max(0,Math.min(3600,row.expires_at?Math.floor((row.expires_at.getTime()-Date.now())/1000):3600));
      await browserPushProvider.send({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},payload,ttl,createHash('sha256').update(id).digest('base64url').slice(0,32));
      await db.query('UPDATE web_push_subscriptions SET last_delivered_at=now(),last_error=NULL WHERE id=$1',[subscription.id]);
    }catch(failure){
      const code=(failure as {statusCode?:number;code?:string}).statusCode;
      status=code===404||code===410?'gone':'failed';error=typeof code==='number'?`push_http_${code}`:'push_delivery_failed';
      if(status==='gone')await db.query('UPDATE web_push_subscriptions SET enabled=false,last_error=$2,updated_at=now() WHERE id=$1',[subscription.id,error]);
      else{retry=true;await db.query('UPDATE web_push_subscriptions SET last_error=$2 WHERE id=$1',[subscription.id,error]);}
    }
    await db.query(`UPDATE notifications SET web_push_results=web_push_results||$2::jsonb WHERE id=$1`,[id,JSON.stringify({[subscription.id]:{status,attempts:(previous?.attempts??0)+1,at:new Date().toISOString(),error}})]);
  }
  if(retry)throw new Error('browser_push_delivery_retry');
}

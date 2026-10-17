import type { PoolClient } from 'pg';
import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { emitUserNotification } from '../../websocket/notifications';
import { enqueueNotification } from './notificationQueue';
import { queueActivityEmail } from './email.service';
import type { CreateNotificationInput, CreatedNotification, NotificationCategory, NotificationDbClient, NotificationPreferences, NotificationRecord } from './notifications.types';

interface NotificationRow {
  id: string; user_id: string; type: string; category: NotificationCategory; priority: 'low'|'normal'|'high'; event_key: string;
  title: string; body: string; data: Record<string, unknown>; deep_link: string|null; expires_at: Date|null; read_at: Date|null; opened_at:Date|null;delivered_at:Date|null;
  delivery_status: 'queued'|'sending'|'sent'|'delivered'|'skipped'|'failed'; created_at: Date;
}
interface CreatedNotificationRow extends NotificationRow { is_new: boolean }

const preferenceColumns = `push_enabled AS "pushEnabled",trip_updates_enabled AS "tripUpdatesEnabled",
driver_offers_enabled AS "driverOffersEnabled",scheduled_reminders_enabled AS "scheduledRemindersEnabled",
wallet_updates_enabled AS "walletUpdatesEnabled",promotions_enabled AS "promotionsEnabled",
sound_enabled AS "soundEnabled",vibration_enabled AS "vibrationEnabled"`;

function present(row: NotificationRow): NotificationRecord {
  const { sendPush: _sendPush, ...data } = row.data ?? {};
  return { id: row.id, userId: row.user_id, type: row.type, category: row.category, priority: row.priority,
    eventKey: row.event_key, title: row.title, body: row.body, data, deepLink: row.deep_link,
    expiresAt: row.expires_at?.toISOString() ?? null, readAt: row.read_at?.toISOString() ?? null,
    openedAt:row.opened_at?.toISOString()??null,deliveredAt:row.delivered_at?.toISOString()??null,
    deliveryStatus: row.delivery_status, createdAt: row.created_at.toISOString() };
}

function cleanData(value: Record<string, unknown> | undefined, sendPush: boolean) {
  const entries = Object.entries(value ?? {}).filter(([, item]) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null);
  return { ...Object.fromEntries(entries), sendPush };
}

export async function createNotificationRecord(client: NotificationDbClient, input: CreateNotificationInput): Promise<CreatedNotification> {
  if (!input.eventKey || input.eventKey.length > 180 || !input.title.trim() || !input.body.trim()) throw new Error('invalid_notification_input');
  const sendPush = input.sendPush !== false;
  const { rows } = await client.query<CreatedNotificationRow>(
    `WITH inserted AS (
       INSERT INTO notifications(user_id,type,category,priority,event_key,title,body,data,deep_link,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(user_id,event_key) DO NOTHING
       RETURNING *,true AS is_new
     )
     SELECT * FROM inserted
     UNION ALL
     SELECT existing.*,false AS is_new FROM notifications existing
      WHERE existing.user_id=$1 AND existing.event_key=$5 AND NOT EXISTS(SELECT 1 FROM inserted)
     LIMIT 1`,
    [input.userId,input.type,input.category,input.priority??'normal',input.eventKey,input.title.trim().slice(0,120),input.body.trim().slice(0,240),cleanData(input.data,sendPush),input.deepLink??null,input.expiresAt??null],
  );
  if (!rows[0]) throw new Error('notification_creation_failed');
  if(rows[0].is_new)await queueActivityEmail(client,input);
  return { record: present(rows[0]), sendPush, isNew: rows[0].is_new };
}

export async function publishNotification(created: CreatedNotification) {
  if (!created.isNew) return;
  emitUserNotification(created.record.userId, created.record);
  if (created.sendPush) await enqueueNotification(created.record.id);
  else await db.query("UPDATE notifications SET delivery_status='skipped',updated_at=now() WHERE id=$1 AND delivery_status='queued'",[created.record.id]);
}

export async function publishNotifications(created: CreatedNotification[]) {
  await Promise.all(created.map((item)=>publishNotification(item)));
}

export async function publishQueuedTripNotifications(tripId:string){
  const {rows}=await db.query<NotificationRow>(`SELECT * FROM notifications WHERE data->>'tripId'=$1 AND delivery_status='queued' ORDER BY created_at`,[tripId]);
  await publishNotifications(rows.map(row=>({record:present(row),sendPush:row.data?.sendPush!==false,isNew:true})));
}

export async function notifyUser(input: CreateNotificationInput) {
  const created = await inTransaction(client=>createNotificationRecord(client,input));
  await publishNotification(created);
  return created.record;
}

/** A notification must never roll back or turn a completed business operation into an API failure. */
export async function notifyUserSafely(input: CreateNotificationInput) {
  try {
    return await notifyUser(input);
  } catch (error) {
    console.error('[notifications] unable to publish notification', {
      eventKey: input.eventKey,
      userId: input.userId,
      error: error instanceof Error ? error.message : 'unknown_error',
    });
    return null;
  }
}

export async function getPreferences(userId: string): Promise<NotificationPreferences> {
  const { rows } = await db.query<NotificationPreferences>(
    `INSERT INTO notification_preferences(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING ${preferenceColumns}`,[userId]);
  return rows[0];
}

const preferenceKeys: Record<keyof NotificationPreferences, string> = {
  pushEnabled:'push_enabled',tripUpdatesEnabled:'trip_updates_enabled',driverOffersEnabled:'driver_offers_enabled',
  scheduledRemindersEnabled:'scheduled_reminders_enabled',walletUpdatesEnabled:'wallet_updates_enabled',promotionsEnabled:'promotions_enabled',
  soundEnabled:'sound_enabled',vibrationEnabled:'vibration_enabled',
};

export async function updatePreferences(userId: string, input: unknown): Promise<NotificationPreferences> {
  const value = input as Partial<Record<keyof NotificationPreferences, unknown>> | null;
  const entries = Object.entries(preferenceKeys).filter(([key]) => value?.[key as keyof NotificationPreferences] !== undefined);
  if (!entries.length || entries.some(([key]) => typeof value?.[key as keyof NotificationPreferences] !== 'boolean')) throw new ApiError(400,'invalid_notification_preferences');
  await db.query('INSERT INTO notification_preferences(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',[userId]);
  const assignments = entries.map(([,column],index)=>`${column}=$${index+2}`).join(',');
  const values = entries.map(([key])=>value![key as keyof NotificationPreferences]);
  const { rows } = await db.query<NotificationPreferences>(`UPDATE notification_preferences SET ${assignments},updated_at=now() WHERE user_id=$1 RETURNING ${preferenceColumns}`,[userId,...values]);
  return rows[0];
}

export async function registerDevice(userId:string,input:unknown) {
  const value=input as {expoPushToken?:unknown;platform?:unknown;deviceIdentifier?:unknown;appVersion?:unknown}|null;
  const token=String(value?.expoPushToken??'').trim(),platform=value?.platform,device=String(value?.deviceIdentifier??'').trim(),version=String(value?.appVersion??'').trim();
  if(!/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token)||!['ios','android'].includes(String(platform))||device.length<3||device.length>160||version.length>40)throw new ApiError(400,'invalid_push_device');
  return inTransaction(async(client)=>{
    // One physical installation belongs to the currently signed-in account. Remove
    // its obsolete token row first, then atomically transfer a rotated/shared Expo token.
    await client.query('DELETE FROM push_devices WHERE user_id=$1 AND device_identifier=$2 AND expo_push_token<>$3',[userId,device,token]);
    const {rows}=await client.query<{id:string}>(`INSERT INTO push_devices(user_id,expo_push_token,platform,device_identifier,app_version)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(expo_push_token) DO UPDATE SET user_id=EXCLUDED.user_id,device_identifier=EXCLUDED.device_identifier,
      platform=EXCLUDED.platform,app_version=EXCLUDED.app_version,enabled=true,revoked_at=NULL,revocation_reason=NULL,last_seen_at=now(),updated_at=now() RETURNING id`,[userId,token,platform,device,version||null]);
    return{deviceId:rows[0].id};
  });
}

export async function revokeDevice(userId:string,id:string){const result=await db.query(`UPDATE push_devices SET enabled=false,revoked_at=now(),revocation_reason='user_revoked',updated_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,[id,userId]);if(!result.rowCount)throw new ApiError(404,'push_device_not_found');return{success:true};}

export async function revokeDeviceToken(userId:string,token:string){await db.query(`UPDATE push_devices SET enabled=false,revoked_at=now(),revocation_reason='token_revoked',updated_at=now() WHERE user_id=$1 AND expo_push_token=$2`,[userId,token]);}
export async function revokeDeviceIfPresent(client:NotificationDbClient,userId:string,id:unknown){if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return;await client.query(`UPDATE push_devices SET enabled=false,revoked_at=COALESCE(revoked_at,now()),revocation_reason=COALESCE(revocation_reason,'session_logout'),updated_at=now() WHERE id=$1 AND user_id=$2`,[id,userId]);}
export async function revokeAllDevices(client:NotificationDbClient,userId:string,reason='account_deactivated'){await client.query(`UPDATE push_devices SET enabled=false,revoked_at=COALESCE(revoked_at,now()),revocation_reason=COALESCE(revocation_reason,$2),updated_at=now() WHERE user_id=$1 AND enabled=true`,[userId,reason]);}

export async function listNotifications(userId:string,cursor?:string,limitValue?:number){const limit=Math.min(50,Math.max(1,Number(limitValue)||20));let before:Date|null=null,beforeId:string|null=null;if(cursor){const separator=cursor.lastIndexOf('|'),dateValue=separator<0?cursor:cursor.slice(0,separator);before=new Date(dateValue);beforeId=separator<0?null:cursor.slice(separator+1);if(!Number.isFinite(before.getTime())||(beforeId!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(beforeId)))throw new ApiError(400,'invalid_notification_cursor');}
  const {rows}=await db.query<NotificationRow>(`SELECT * FROM notifications WHERE user_id=$1 AND ($2::timestamptz IS NULL OR ($3::uuid IS NULL AND created_at<$2) OR ($3::uuid IS NOT NULL AND (created_at,id)<($2,$3::uuid))) ORDER BY created_at DESC,id DESC LIMIT $4`,[userId,before,beforeId,limit+1]);
  const hasMore=rows.length>limit,items=rows.slice(0,limit),last=items.at(-1);return{notifications:items.map(present),nextCursor:hasMore&&last?`${last.created_at.toISOString()}|${last.id}`:null};}

export async function unreadCount(userId:string){const row=(await db.query<{count:string}>('SELECT COUNT(*)::text count FROM notifications WHERE user_id=$1 AND read_at IS NULL',[userId])).rows[0];return{count:Number(row.count)};}
export async function markRead(userId:string,id:string){const {rows}=await db.query<NotificationRow>('UPDATE notifications SET read_at=COALESCE(read_at,now()),updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *',[id,userId]);if(!rows[0])throw new ApiError(404,'notification_not_found');return present(rows[0]);}
export async function markOpened(userId:string,id:string){const {rows}=await db.query<NotificationRow>('UPDATE notifications SET opened_at=COALESCE(opened_at,now()),read_at=COALESCE(read_at,now()),updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *',[id,userId]);if(!rows[0])throw new ApiError(404,'notification_not_found');return present(rows[0]);}
export async function markAllRead(userId:string){const result=await db.query('UPDATE notifications SET read_at=COALESCE(read_at,now()),updated_at=now() WHERE user_id=$1 AND read_at IS NULL',[userId]);return{updated:result.rowCount??0};}

export async function createTripNotifications(client: PoolClient, inputs: CreateNotificationInput[]) {return Promise.all(inputs.map(input=>createNotificationRecord(client,input)));}

import { createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import { db,inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { ensureRedis } from '../../shared/config/redis';
import { env } from '../../config/env';
import { authorizedTrip,conversationRow,messagingWindowOpen } from './communication.policy';
import { deviceRole,presentCall,type CallRow } from './call.types';
import { videoPolicy } from './video.policy';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function audioConnectionMode():'disabled'|'direct-only'|'direct-and-relay'{
  if(!env.COMMUNICATION_AUDIO_ENABLED)return 'disabled';
  if(env.TURN_URLS.length>0&&env.TURN_SHARED_SECRET)return 'direct-and-relay';
  if(env.COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY&&['development','test'].includes(env.NODE_ENV))return 'direct-only';
  return 'disabled';
}
export function audioCallsEnabled(){return audioConnectionMode()!=='disabled';}
function requireEnabled(){if(!audioCallsEnabled())throw new ApiError(503,'audio_calling_unavailable');}
export function callSession(sessionId?:string):string {if(!sessionId||!uuid.test(sessionId))throw new ApiError(401,'call_session_required');return sessionId;}
async function rateLimit(userId:string,kind:string,limit:number,seconds:number){
  const redis=await ensureRedis();
  const count=Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",1,`call:${kind}:${userId}`,seconds));
  if(count>limit)throw new ApiError(429,'call_rate_limited');
}
export async function lockCallUsers(client:PoolClient,ids:string[]) {
  for(const id of [...new Set(ids)].sort())await client.query("SELECT pg_advisory_xact_lock(hashtextextended('audio-call:'||$1::text,0))",[id]);
}
async function selectCall(client:Pick<PoolClient,'query'>,userId:string,id:string) {
  if(!uuid.test(id))throw new ApiError(404,'call_not_found');
  const row=(await client.query<CallRow>('SELECT * FROM call_sessions WHERE id=$1 AND (caller_id=$2 OR callee_id=$2)',[id,userId])).rows[0];
  if(!row)throw new ApiError(404,'call_not_found');
  return row;
}
async function lockedCall(client:PoolClient,userId:string,id:string) {
  const snapshot=await selectCall(client,userId,id);
  await client.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE',[snapshot.trip_id]);
  await conversationRow(client,snapshot.trip_id,true);
  await lockCallUsers(client,[snapshot.caller_id,snapshot.callee_id]);
  return (await client.query<CallRow>('SELECT * FROM call_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
}
function view(row:CallRow,userId:string,sessionId:string) {return {...presentCall(row),deviceRole:deviceRole(row,userId,sessionId)};}
async function downgradeVideo(client:PoolClient,row:CallRow,reason:string) {
  return (await client.query<CallRow>(`UPDATE call_sessions SET media='audio',video_reason=$2,video_policy_until=NULL,
    generation=generation+1,version=version+1,caller_ready=false,callee_ready=false,
    status=CASE WHEN status='ringing' THEN 'ringing' ELSE 'connecting' END,
    deadline_at=LEAST(deadline_at,now()+interval '30 seconds') WHERE id=$1 RETURNING *`,[row.id,reason])).rows[0];
}
async function checkVideo(client:PoolClient,row:CallRow) {
  if(row.media!=='video'||row.ended_at)return row;
  const trip=(await client.query<{driver_id:string|null;status:string}>('SELECT driver_id,status FROM trips WHERE id=$1',[row.trip_id])).rows[0];
  const policy=await videoPolicy(trip);
  if(!policy.allowed)return downgradeVideo(client,row,policy.reason!);
  return (await client.query<CallRow>('UPDATE call_sessions SET video_policy_until=to_timestamp($2/1000.0) WHERE id=$1 RETURNING *',[row.id,policy.validUntil])).rows[0];
}
export async function getCall(userId:string,sessionId:string,id:string) {
  const row=await selectCall(db,userId,id);
  if(row.media==='video'&&!row.ended_at)return inTransaction(async client=>view(await checkVideo(client,await lockedCall(client,userId,id)),userId,sessionId));
  return view(row,userId,sessionId);
}
export async function activeCall(userId:string,sessionId:string) {
  const row=(await db.query<CallRow>('SELECT c.* FROM active_call_participants a JOIN call_sessions c ON c.id=a.call_id WHERE a.user_id=$1',[userId])).rows[0];
  return row?row.media==='video'?getCall(userId,sessionId,row.id):view(row,userId,sessionId):null;
}
export async function initiateCall(userId:string,sessionId:string,tripId:string,input:unknown) {
  callSession(sessionId);
  const value=input as {requestId?:unknown;media?:unknown;protocol?:unknown}|null;
  if(!value||typeof value.requestId!=='string'||!uuid.test(value.requestId))throw new ApiError(400,'invalid_call_request');
  const media=value.media??'audio';
  if(!['audio','video'].includes(String(media))||(media==='video'&&value.protocol!==2))throw new ApiError(400,'invalid_call_media');
  await rateLimit(userId,'start',6,60);
  return inTransaction(async client=>{
    const trip=await authorizedTrip(client,userId,tripId,'write');
    const conversation=await conversationRow(client,tripId,true);
    const peerId=trip.rider_id===userId?trip.driver_id:trip.rider_id;
    if(!peerId)throw new ApiError(409,'trip_calling_unavailable');
    await lockCallUsers(client,[userId,peerId]);
    const existing=(await client.query<CallRow>('SELECT * FROM call_sessions WHERE caller_id=$1 AND request_id=$2',[userId,value.requestId])).rows[0];
    if(existing){
      if(existing.trip_id!==tripId||existing.caller_session_id!==sessionId||(existing.requested_media??'audio')!==media)throw new ApiError(409,'call_request_conflict');
      return view(existing,userId,sessionId);
    }
    requireEnabled();
    if(!messagingWindowOpen(trip)||conversation?.status!=='open')throw new ApiError(409,'trip_calling_unavailable');
    const policy=media==='video'?await videoPolicy(trip):null;
    if(policy&&!policy.allowed)throw new ApiError(409,policy.reason!);
    const busy=await client.query('SELECT user_id FROM active_call_participants WHERE user_id=ANY($1::uuid[])',[[userId,peerId]]);
    if(busy.rowCount)throw new ApiError(409,'call_participant_busy');
    const row=(await client.query<CallRow>(`INSERT INTO call_sessions(trip_id,caller_id,callee_id,caller_session_id,request_id,media,requested_media,video_policy_until)
      VALUES($1,$2,$3,$4,$5,$6,$6,to_timestamp($7/1000.0)) RETURNING *`,[tripId,userId,peerId,sessionId,value.requestId,media,policy?.validUntil??null])).rows[0];
    await client.query('INSERT INTO active_call_participants(user_id,call_id) VALUES($1,$3),($2,$3)',[userId,peerId,row.id]);
    return view(row,userId,sessionId);
  });
}
export type CallAction='accept'|'decline'|'cancel'|'end'|'restart'|'audio'|'request-video'|'accept-video'|'reject-video';
export async function commandCall(userId:string,sessionId:string,id:string,action:CallAction,input:unknown) {
  callSession(sessionId);
  const value=input as {version?:unknown;protocol?:unknown}|null;
  if(!value||!Number.isSafeInteger(value.version)||Number(value.version)<1)throw new ApiError(400,'invalid_call_version');
  if(action==='restart')await rateLimit(userId,'restart',3,60);
  if(action==='request-video')await rateLimit(userId,'video-upgrade',4,60);
  return inTransaction(async client=>{
    let row=await lockedCall(client,userId,id);
    const role=deviceRole(row,userId,sessionId);
    if(role==='observer')throw new ApiError(409,'call_owned_by_other_device');
    // A repeated terminal command or accept is safe after a lost response.
    if(row.ended_at)return view(row,userId,sessionId);
    if(action==='accept'&&row.callee_session_id===sessionId&&row.callee_id===userId)return view(row,userId,sessionId);
    if(row.version!==value.version)throw new ApiError(409,'call_version_conflict');
    if(row.deadline_at.getTime()<=Date.now())throw new ApiError(409,'call_expired');
    if(['request-video','accept-video','reject-video'].includes(action)){
      requireEnabled();
      if(row.media!=='audio'||row.status!=='connected')throw new ApiError(409,'invalid_call_transition');
      if(action==='reject-video'){
        if(!row.video_upgrade_by)return view(row,userId,sessionId);
        row=(await client.query<CallRow>('UPDATE call_sessions SET video_upgrade_by=NULL,video_upgrade_until=NULL,version=version+1 WHERE id=$1 RETURNING *',[id])).rows[0];
      }else{
        if(value.protocol!==2)throw new ApiError(409,'video_client_update_required');
        const trip=(await client.query<{driver_id:string|null;status:string}>('SELECT driver_id,status FROM trips WHERE id=$1',[row.trip_id])).rows[0];
        const policy=await videoPolicy(trip);
        if(!policy.allowed)throw new ApiError(409,policy.reason!);
        if(action==='request-video'){
          if(row.video_upgrade_by&&row.video_upgrade_until&&row.video_upgrade_until.getTime()>Date.now())throw new ApiError(409,'video_upgrade_pending');
          row=(await client.query<CallRow>(`UPDATE call_sessions SET video_upgrade_by=$2,video_upgrade_until=now()+interval '30 seconds',version=version+1 WHERE id=$1 RETURNING *`,[id,userId])).rows[0];
        }else{
          if(!row.video_upgrade_by||!row.video_upgrade_until||row.video_upgrade_until.getTime()<=Date.now())throw new ApiError(409,'video_upgrade_expired');
          if(row.video_upgrade_by===userId)throw new ApiError(409,'video_upgrade_peer_consent_required');
          row=(await client.query<CallRow>(`UPDATE call_sessions SET media='video',video_reason=NULL,video_policy_until=to_timestamp($2/1000.0),
            video_upgrade_by=NULL,video_upgrade_until=NULL,generation=generation+1,version=version+1,
            caller_ready=false,callee_ready=false,status='connecting',deadline_at=now()+interval '30 seconds' WHERE id=$1 RETURNING *`,[id,policy.validUntil])).rows[0];
        }
      }
      return view(row,userId,sessionId);
    }
    if(action==='audio')return view(row.media==='video'?await downgradeVideo(client,row,'video_stopped'):row,userId,sessionId);
    if(action==='accept'){
      requireEnabled();
      if(role!=='receiver'||row.status!=='ringing')throw new ApiError(409,'invalid_call_transition');
      if(row.media==='video'&&value.protocol!==2)throw new ApiError(409,'video_client_update_required');
      row=await checkVideo(client,row);
      row=(await client.query<CallRow>(`UPDATE call_sessions SET status='connecting',callee_session_id=$2,callee_seen_at=now(),
        deadline_at=now()+interval '30 seconds',version=version+1 WHERE id=$1 RETURNING *`,[id,sessionId])).rows[0];
    }else if(action==='restart'){
      requireEnabled();
      if(role!=='caller'||!['connected','connecting'].includes(row.status))throw new ApiError(409,'invalid_call_transition');
      row=await checkVideo(client,row);
      row=(await client.query<CallRow>(`UPDATE call_sessions SET status='connecting',generation=generation+1,version=version+1,video_upgrade_by=NULL,video_upgrade_until=NULL,
        caller_ready=false,callee_ready=false,deadline_at=now()+interval '20 seconds' WHERE id=$1 RETURNING *`,[id])).rows[0];
    }else{
      if((action==='decline'&&(role!=='receiver'||row.status!=='ringing'))||(action==='cancel'&&(role!=='caller'||row.status!=='ringing')))
        throw new ApiError(409,'invalid_call_transition');
      const status=action==='decline'?'declined':action==='cancel'?'cancelled':'ended';
      row=(await client.query<CallRow>(`UPDATE call_sessions SET status=$2,ended_at=now(),end_reason=$3,version=version+1,
        callee_session_id=CASE WHEN callee_id=$4 THEN COALESCE(callee_session_id,$5) ELSE callee_session_id END WHERE id=$1 RETURNING *`,[id,status,action,userId,sessionId])).rows[0];
    }
    return view(row,userId,sessionId);
  });
}
export async function renewCall(userId:string,sessionId:string,id:string,input:unknown) {
  const value=input as {generation?:unknown;connected?:unknown}|null;
  if(!value||!Number.isSafeInteger(value.generation)||typeof value.connected!=='boolean')throw new ApiError(400,'invalid_call_lease');
  return inTransaction(async client=>{
    let row=await lockedCall(client,userId,id);
    if(row.ended_at)return view(row,userId,sessionId);
    requireEnabled();
    const role=deviceRole(row,userId,sessionId);
    if(role==='observer'||(role==='receiver'&&!row.callee_session_id))throw new ApiError(409,'call_owned_by_other_device');
    if(row.generation!==value.generation||row.deadline_at.getTime()<=Date.now())throw new ApiError(409,'call_expired');
    row=await checkVideo(client,row);
    if(row.generation!==value.generation)return view(row,userId,sessionId);
    const sql=role==='caller'
      ?'UPDATE call_sessions SET caller_seen_at=now(),caller_ready=$2 WHERE id=$1 RETURNING *'
      :'UPDATE call_sessions SET callee_seen_at=now(),callee_ready=$2 WHERE id=$1 RETURNING *';
    row=(await client.query<CallRow>(sql,[id,value.connected])).rows[0];
    if(row.status==='connecting'&&row.caller_ready&&row.callee_ready){
      row=(await client.query<CallRow>(`UPDATE call_sessions SET status='connected',connected_at=COALESCE(connected_at,now()),
        deadline_at=LEAST(caller_seen_at,callee_seen_at)+interval '30 seconds',version=version+1 WHERE id=$1 RETURNING *`,[id])).rows[0];
    }else if(row.status==='connected'){
      row=(await client.query<CallRow>(`UPDATE call_sessions SET deadline_at=LEAST(caller_seen_at,callee_seen_at)+interval '30 seconds' WHERE id=$1 RETURNING *`,[id])).rows[0];
    }
    return view(row,userId,sessionId);
  });
}
export async function turnCredentials(userId:string,sessionId:string,id:string) {
  requireEnabled();await rateLimit(userId,'turn',20,60);
  return inTransaction(async client=>{
    const row=await checkVideo(client,await lockedCall(client,userId,id));
    const role=deviceRole(row,userId,sessionId);
    if(row.ended_at||row.deadline_at.getTime()<=Date.now()||!['connecting','connected'].includes(row.status)||role==='observer')throw new ApiError(409,'call_media_unavailable');
    const expiresAt=Math.floor(Date.now()/1000)+300;
    const username=`${expiresAt}:${id}:${userId}`;
    const relay=audioConnectionMode()==='direct-and-relay';
    // ICE prioritizes direct candidates while keeping authenticated relays ready
    // for networks where peer-to-peer connectivity is unavailable.
    return {media:row.media,videoValidUntil:row.video_policy_until?.getTime()??0,iceTransportPolicy:'all' as const,expiresAt,iceServers:[
      ...(env.STUN_URLS.length?[{urls:env.STUN_URLS}]:[]),
      ...(relay?[{urls:env.TURN_URLS,username,credential:createHmac('sha1',env.TURN_SHARED_SECRET).update(username).digest('base64')}]:[]),
    ]};
  });
}
export interface CallSignal {callId:string;generation:number;kind:'offer'|'answer'|'ice';sdp?:string;candidate?:{candidate:string;sdpMid:string|null;sdpMLineIndex:number|null};}
export async function authorizeCallSignal(userId:string,sessionId:string,input:unknown) {
  requireEnabled();
  const value=input as CallSignal|null;
  if(!value||typeof value.callId!=='string'||!Number.isSafeInteger(value.generation)||!['offer','answer','ice'].includes(value.kind))throw new ApiError(400,'invalid_call_signal');
  if(value.kind==='ice'){
    const c=value.candidate;
    if(!c||typeof c.candidate!=='string'||c.candidate.length>2048||(c.sdpMid!==null&&(typeof c.sdpMid!=='string'||c.sdpMid.length>32))
      ||(c.sdpMLineIndex!==null&&(!Number.isInteger(c.sdpMLineIndex)||c.sdpMLineIndex<0||c.sdpMLineIndex>8)))throw new ApiError(400,'invalid_call_signal');
  }else if(typeof value.sdp!=='string'||value.sdp.length>24000||!value.sdp.startsWith('v=0\r\n')||!/^m=audio /m.test(value.sdp)||/^m=application /m.test(value.sdp))throw new ApiError(400,'invalid_audio_sdp');
  await rateLimit(userId,'signal',160,10);
  return inTransaction(async client=>{
    const row=await checkVideo(client,await lockedCall(client,userId,value.callId));
    const role=deviceRole(row,userId,sessionId);
    if(row.ended_at||row.deadline_at.getTime()<=Date.now()||!['connecting','connected'].includes(row.status)||row.generation!==value.generation||role==='observer')throw new ApiError(409,'call_media_unavailable');
    if((value.kind==='offer'&&role!=='caller')||(value.kind==='answer'&&role!=='receiver'))throw new ApiError(403,'call_signal_role');
    if(value.kind!=='ice'){
      const mediaLines=value.sdp!.split(/\r?\n/).filter(line=>line.startsWith('m='));
      if(mediaLines.some(line=>!/^m=(audio|video) /.test(line))||mediaLines.filter(line=>line.startsWith('m=audio ')).length!==1
        ||mediaLines.filter(line=>line.startsWith('m=video ')).length>(row.media==='video'?1:0)
        ||(row.media==='audio'&&value.sdp!.length>12000))throw new ApiError(400,'invalid_audio_sdp');
    }
    const targetSession=role==='caller'?row.callee_session_id:row.caller_session_id;
    const signal:CallSignal=value.kind==='ice'?{callId:row.id,generation:row.generation,kind:'ice',candidate:value.candidate}
      :{callId:row.id,generation:row.generation,kind:value.kind,sdp:value.sdp};
    return {targetSession:targetSession!,signal};
  });
}
export async function expireCalls() {
  const upgrades=(await db.query<CallRow>("SELECT * FROM call_sessions WHERE video_upgrade_by IS NOT NULL AND ended_at IS NULL ORDER BY video_upgrade_until LIMIT 100")).rows;
  for(const candidate of upgrades)await inTransaction(async client=>{
    const row=await lockedCall(client,candidate.caller_id,candidate.id);
    if(!row.video_upgrade_by||row.ended_at)return;
    const trip=(await client.query<{driver_id:string|null;status:string}>('SELECT driver_id,status FROM trips WHERE id=$1',[row.trip_id])).rows[0];
    if(row.media!=='audio'||row.status!=='connected'||!row.video_upgrade_until||row.video_upgrade_until.getTime()<=Date.now()||!(await videoPolicy(trip)).allowed)
      await client.query('UPDATE call_sessions SET video_upgrade_by=NULL,video_upgrade_until=NULL,version=version+1 WHERE id=$1',[row.id]);
  });
  const videos=(await db.query<CallRow>("SELECT * FROM call_sessions WHERE media='video' AND ended_at IS NULL ORDER BY video_policy_until NULLS FIRST LIMIT 100")).rows;
  for(const candidate of videos)await inTransaction(async client=>checkVideo(client,await lockedCall(client,candidate.caller_id,candidate.id)));
  const rows=(await db.query<CallRow>('SELECT * FROM call_sessions WHERE ended_at IS NULL AND (deadline_at<=now() OR $1=false) ORDER BY deadline_at LIMIT 50',[audioCallsEnabled()])).rows;
  for(const candidate of rows)await inTransaction(async client=>{
    const row=await lockedCall(client,candidate.caller_id,candidate.id);
    if(row.ended_at||(audioCallsEnabled()&&row.deadline_at.getTime()>Date.now()))return;
    await client.query(`UPDATE call_sessions SET status=$2,end_reason=$3,ended_at=now(),version=version+1 WHERE id=$1`,
      [row.id,row.status==='ringing'?'missed':'failed',audioCallsEnabled()?(row.status==='ringing'?'no_answer':'connection_timeout'):'calling_disabled']);
  });
  return rows.length;
}

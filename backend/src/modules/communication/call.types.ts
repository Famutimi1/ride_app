export type CallStatus='ringing'|'connecting'|'connected'|'ended'|'declined'|'cancelled'|'missed'|'failed';
export interface CallRow {
  id:string; trip_id:string; caller_id:string; callee_id:string;
  caller_session_id:string; callee_session_id:string|null; request_id:string;
  status:CallStatus; version:number; generation:number;
  media:'audio'|'video'; requested_media:'audio'|'video'; video_reason:string|null; video_policy_until:Date|null;
  video_upgrade_by:string|null; video_upgrade_until:Date|null;
  caller_seen_at:Date; callee_seen_at:Date|null; caller_ready:boolean; callee_ready:boolean;
  deadline_at:Date; connected_at:Date|null; ended_at:Date|null; end_reason:string|null; created_at:Date;
}
export function presentCall(row:CallRow) {
  return {id:row.id,tripId:row.trip_id,callerId:row.caller_id,calleeId:row.callee_id,
    status:row.status,version:row.version,generation:row.generation,media:row.media??'audio',
    requestedMedia:row.requested_media??'audio',videoReason:row.video_reason??null,videoValidUntil:row.video_policy_until?.getTime()??0,
    videoUpgrade:!row.ended_at&&row.media==='audio'&&row.status==='connected'&&row.video_upgrade_by&&row.video_upgrade_until
      ?{requestedBy:row.video_upgrade_by,expiresAt:row.video_upgrade_until.getTime()}:null,
    deadlineAt:row.deadline_at.toISOString(),connectedAt:row.connected_at?.toISOString()??null,
    endedAt:row.ended_at?.toISOString()??null,endReason:row.end_reason,createdAt:row.created_at.toISOString()};
}
export function deviceRole(row:CallRow,userId:string,sessionId:string) {
  return row.caller_id===userId&&row.caller_session_id===sessionId ? 'caller' as const
    :row.callee_id===userId&&(row.callee_session_id===sessionId||row.status==='ringing') ? 'receiver' as const : 'observer' as const;
}

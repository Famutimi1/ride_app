export type CallMedia = 'audio'|'video';
export interface VideoStream {id:string;toURL?:()=>string;}
export interface VideoFrames {local:VideoStream|null;remote:VideoStream|null;localMirrored?:boolean;unavailable?:boolean;}
export interface AudioCall {
  id:string;tripId:string;callerId:string;calleeId:string;media:CallMedia;
  requestedMedia?:CallMedia;videoReason?:string|null;videoValidUntil?:number;
  videoUpgrade?:{requestedBy:string;expiresAt:number}|null;
  status:'ringing'|'connecting'|'connected'|'ended'|'declined'|'cancelled'|'missed'|'failed';
  version:number;generation:number;deviceRole:'caller'|'receiver'|'observer';
  deadlineAt:string;connectedAt:string|null;endedAt:string|null;endReason:string|null;createdAt:string;
}
export interface CallSignal {callId:string;generation:number;kind:'offer'|'answer'|'ice';sdp?:string;candidate?:{candidate:string;sdpMid:string|null;sdpMLineIndex:number|null};}
export interface TurnConfiguration {media?:CallMedia;videoValidUntil?:number;iceTransportPolicy:'all'|'relay';expiresAt:number;iceServers:{urls:string[];username?:string;credential?:string}[];}
export interface AudioMedia {
  connect:(configuration:TurnConfiguration,signal:(value:Omit<CallSignal,'callId'|'generation'>)=>void,state:(connected:boolean,failed:boolean)=>void,playbackBlocked?:(blocked:boolean)=>void)=>void;
  offer:()=>Promise<void>;
  receive:(signal:CallSignal)=>Promise<void>;
  mute:(muted:boolean)=>void;
  speaker:(enabled:boolean)=>void;
  hold?:(held:boolean)=>void;
  prepareVideo?:(video:(frames:VideoFrames)=>void)=>Promise<void>;
  stopVideo?:()=>void;
  flipCamera?:()=>Promise<void>;
  resumePlayback?:()=>Promise<void>;
  close:()=>void;
}
export interface CallSnapshot {call:AudioCall|null;busy:boolean;muted:boolean;speaker:boolean;connected:boolean;error:string|null;playbackBlocked?:boolean;localVideo?:VideoStream|null;remoteVideo?:VideoStream|null;videoStopped?:boolean;localVideoMirrored?:boolean;}
export interface CallApi {
  active:()=>Promise<AudioCall|null>;
  get:(id:string)=>Promise<AudioCall>;
  start:(tripId:string,requestId:string,media?:CallMedia)=>Promise<AudioCall>;
  command:(id:string,action:'accept'|'decline'|'cancel'|'end'|'restart'|'audio'|'request-video'|'accept-video'|'reject-video',version:number)=>Promise<AudioCall>;
  lease:(id:string,generation:number,connected:boolean)=>Promise<AudioCall>;
  turn:(id:string)=>Promise<TurnConfiguration>;
}

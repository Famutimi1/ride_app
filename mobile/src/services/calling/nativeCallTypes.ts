import type { AudioCall } from './callTypes';
export interface NativeCallEvent {action:'incoming'|'answer'|'end'|'expired'|'failed'|'pulse'|'mute'|'hold'|'resume'|'interruption'|'token'|'tokenInvalidated';callId?:string;value?:boolean;createdAt?:number;}
export interface NativeCallBridge {
  report:(call:AudioCall|null)=>Promise<void>;
  pending:()=>Promise<NativeCallEvent[]>;
  acknowledge:(id:string,action:string)=>Promise<void>;
  dismiss:(id:string)=>Promise<void>;
  subscribe:(handler:(event:NativeCallEvent)=>void)=>()=>void;
  refreshToken:()=>Promise<void>;
  dispose:()=>Promise<void>;
}

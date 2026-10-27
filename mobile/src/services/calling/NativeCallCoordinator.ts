import type { AudioCall } from './callTypes';
import type { NativeCallBridge,NativeCallEvent } from './nativeCallTypes';
interface Actions {
  recoverIncoming:(id:string)=>Promise<void>;answerFromNative:(id:string)=>Promise<void>;endFromNative:(id:string)=>Promise<void>;
  pulse:()=>Promise<void>;setMuted:(id:string,value:boolean)=>void;hold:(id:string,value:boolean)=>void;
}
/** Queues OS actions until authenticated call state is available. Action errors
 * retain the native pending event for bounded reconciliation on the next tick. */
export class NativeCallCoordinator {
  private running=new Set<string>();
  private disposed=false;
  private reports:Promise<void>=Promise.resolve();
  private holdCall:string|null=null;
  private manualHold=false;
  private interrupted=false;
  private stop:()=>void;
  constructor(private bridge:NativeCallBridge,private controller:Actions,private current:()=>AudioCall|null){
    this.stop=bridge.subscribe(event=>{void this.handle(event);});
  }
  async handle(event:NativeCallEvent){
    if(this.disposed)return;
    const id=event.callId?.toLowerCase()??this.current()?.id;
    if(event.action==='pulse'){await this.controller.pulse();return;}
    if(!id||!/^[0-9a-f-]{36}$/i.test(id))return;
    const key=`${id}:${event.action}`;
    if(this.running.has(key))return;
    this.running.add(key);
    try{
      if(event.createdAt&&Date.now()-event.createdAt>120000){await this.bridge.acknowledge(id,event.action);return;}
      if(event.action==='answer')await this.controller.answerFromNative(id);
      else if(['end','expired','failed'].includes(event.action))await this.controller.endFromNative(id);
      else if(event.action==='incoming')await this.controller.recoverIncoming(id);
      else if(event.action==='mute')this.controller.setMuted(id,event.value===true);
      else if(['hold','resume','interruption'].includes(event.action)){
        if(this.holdCall!==id){this.holdCall=id;this.manualHold=false;this.interrupted=false;}
        if(event.action==='hold')this.manualHold=event.value!==false;
        else this.interrupted=event.action==='interruption'&&event.value===true;
        this.controller.hold(id,this.manualHold||this.interrupted);
      }
      if(['incoming','answer'].includes(event.action)&&this.current()?.id!==id)await this.bridge.dismiss(id);
      if(!this.disposed&&['incoming','answer','end','expired','failed'].includes(event.action))await this.bridge.acknowledge(id,event.action);
    }catch{/* Retry from the native queue after authentication/network recovery. */}
    finally{this.running.delete(key);}
  }
  async reconcile(){
    if(this.disposed)return;
    for(const event of await this.bridge.pending())await this.handle(event);
    await this.bridge.refreshToken();
  }
  async report(call:AudioCall|null){
    if(this.disposed)return;
    this.reports=this.reports.then(async()=>{if(!this.disposed)await this.bridge.report(call);})
      .catch(async()=>{if(call&&!call.endedAt&&!this.disposed)await this.controller.endFromNative(call.id);});
    await this.reports;
  }
  async dispose(){if(this.disposed)return;this.disposed=true;this.stop();await this.reports.catch(()=>undefined);await this.bridge.dispose();}
}

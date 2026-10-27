import { Router,type Request,type Response,type NextFunction } from 'express';
import { requireAuth,limitPublicAuth } from '../auth/auth.middleware';
import { inviteStatus,declineNativeInvite } from './callPush.service';
import { nativeCallConfiguration,registerCallDevice,revokeCallDevice } from './callDevices.service';
import { ApiError } from '../../shared/errors';
import { activeCall,callSession,commandCall,getCall,initiateCall,renewCall,turnCredentials,type CallAction } from './call.service';

const handle=(work:(req:Request)=>Promise<unknown>)=>async(req:Request,res:Response,next:NextFunction)=>{
  try{callSession(req.sessionId);res.json(await work(req));}catch(error){next(error);}
};
export const callsRouter=Router();
// The signed, expiring ticket grants a status read and unanswered decline. It is
// sent in a POST body so access logs never record the ticket in a URL.
callsRouter.post('/invite-status',limitPublicAuth,async(req,res,next)=>{
  try{res.set('Cache-Control','no-store');res.json(await inviteStatus(req.body));}catch(error){next(error);}
});
callsRouter.post('/native-decline',limitPublicAuth,async(req,res,next)=>{
  try{res.set('Cache-Control','no-store');res.json(await declineNativeInvite(req.body));}catch(error){next(error);}
});
callsRouter.use(requireAuth);
callsRouter.get('/config',handle(async()=>nativeCallConfiguration()));
callsRouter.post('/devices',handle(req=>{
  if(req.sessionScope!=='app')throw new ApiError(403,'app_session_required');
  return registerCallDevice(req.userId!,req.sessionId!,req.body);
}));
callsRouter.delete('/devices/:id',handle(req=>revokeCallDevice(req.userId!,req.sessionId!,String(req.params.id))));
callsRouter.get('/active',handle(req=>activeCall(req.userId!,req.sessionId!)));
callsRouter.get('/:id',handle(req=>getCall(req.userId!,req.sessionId!,String(req.params.id))));
for(const action of ['accept','decline','cancel','end','restart','audio','request-video','accept-video','reject-video'] as CallAction[]){
  callsRouter.post(`/:id/${action}`,handle(req=>commandCall(req.userId!,req.sessionId!,String(req.params.id),action,req.body)));
}
callsRouter.post('/:id/lease',handle(req=>renewCall(req.userId!,req.sessionId!,String(req.params.id),req.body)));
callsRouter.post('/:id/turn-credentials',handle(req=>turnCredentials(req.userId!,req.sessionId!,String(req.params.id))));
export const tripCallsRouter=Router();
tripCallsRouter.post('/:id/calls',requireAuth,handle(req=>initiateCall(req.userId!,req.sessionId!,String(req.params.id),req.body)));

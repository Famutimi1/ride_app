import type {Request,Response,NextFunction} from 'express';
import * as service from './webPush.service';
const run=(fn:(req:Request)=>Promise<unknown>|unknown)=>async(req:Request,res:Response,next:NextFunction)=>{try{res.json(await fn(req));}catch(error){next(error);}};
export const config=run(()=>service.webPushConfiguration());
export const status=run(req=>service.browserStatus(req.userId!,req.sessionId,req.body?.endpoint));
export const register=run(req=>service.registerBrowser(req.userId!,req.sessionId,req.body));
export const revoke=run(req=>service.revokeBrowser(req.userId!,String(req.params.id)));

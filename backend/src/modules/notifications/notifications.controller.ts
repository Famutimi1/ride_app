import type { NextFunction, Request, Response } from 'express';
import * as service from './notifications.service';

const run=(fn:(req:Request)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req).then(value=>res.json(value)).catch(next);};
export const registerDevice=run(req=>service.registerDevice(req.userId!,req.body));
export const revokeDevice=run(req=>service.revokeDevice(req.userId!,String(req.params.id)));
export const preferences=run(req=>service.getPreferences(req.userId!));
export const savePreferences=run(req=>service.updatePreferences(req.userId!,req.body));
export const list=run(req=>service.listNotifications(req.userId!,typeof req.query.cursor==='string'?req.query.cursor:undefined,Number(req.query.limit)));
export const unread=run(req=>service.unreadCount(req.userId!));
export const read=run(req=>service.markRead(req.userId!,String(req.params.id)));
export const opened=run(req=>service.markOpened(req.userId!,String(req.params.id)));
export const readAll=run(req=>service.markAllRead(req.userId!));

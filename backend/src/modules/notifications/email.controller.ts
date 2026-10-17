import type { Request, Response, NextFunction } from 'express';
import { adminId } from '../../shared/utils/adminQuery';
import * as emails from './emailAdmin.service';
import { emailSettingsView, saveEmailSettings } from './emailSettings.service';

const run=(handler:(req:Request)=>Promise<unknown>)=>async(req:Request,res:Response,next:NextFunction)=>{try{res.json(await handler(req));}catch(error){next(error);}};
export const listEmails=run(req=>emails.listAdminEmails(req.query));
export const emailConfiguration=run(()=>emails.emailAdminConfiguration());
export const emailTemplates=run(async()=>emails.emailTemplateCatalogue());
export const emailDetail=run(req=>emails.adminEmailDetail(req.userId!,adminId(req.params.id)));
export const retryEmail=run(req=>emails.retryAdminEmail(req.userId!,adminId(req.params.id),req.body??{}));
export const testEmail=run(req=>emails.testAdminEmail(req.userId!,req.body??{}));
export const emailPreferences=run(()=>emailSettingsView());
export const saveEmailPreferences=run(req=>saveEmailSettings(req.userId!,req.body??{}));

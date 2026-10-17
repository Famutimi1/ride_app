import { Router } from 'express';
import { requireAuth, requireStaffRole } from '../auth/auth.middleware';
import * as controller from './email.controller';

export const emailAdminRouter=Router();
emailAdminRouter.use(requireAuth,requireStaffRole('admin','super_admin'));
emailAdminRouter.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
emailAdminRouter.get('/',controller.listEmails);
emailAdminRouter.get('/configuration',controller.emailConfiguration);
emailAdminRouter.get('/templates',controller.emailTemplates);
emailAdminRouter.get('/preferences',controller.emailPreferences);
emailAdminRouter.patch('/preferences',requireStaffRole('super_admin'),controller.saveEmailPreferences);
emailAdminRouter.post('/test',requireStaffRole('super_admin'),controller.testEmail);
emailAdminRouter.get('/:id',controller.emailDetail);
emailAdminRouter.post('/:id/retry',controller.retryEmail);

import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import * as controller from './notifications.controller';

export const notificationsRouter=Router();
notificationsRouter.use(requireAuth);
notificationsRouter.post('/devices',controller.registerDevice);
notificationsRouter.delete('/devices/:id',controller.revokeDevice);
notificationsRouter.get('/preferences',controller.preferences);
notificationsRouter.patch('/preferences',controller.savePreferences);
notificationsRouter.get('/',controller.list);
notificationsRouter.get('/unread-count',controller.unread);
notificationsRouter.post('/read-all',controller.readAll);
notificationsRouter.post('/:id/opened',controller.opened);
notificationsRouter.post('/:id/read',controller.read);

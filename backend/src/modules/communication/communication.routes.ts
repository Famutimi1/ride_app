import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { detail, receipt } from './communication.controller';

export const communicationRouter = Router();
communicationRouter.get('/:id/communication',requireAuth,detail);
communicationRouter.post('/:id/communication/receipts',requireAuth,receipt);

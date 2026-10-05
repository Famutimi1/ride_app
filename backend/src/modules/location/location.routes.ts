import { Router } from 'express';
import { nearby } from './location.controller';
import { requireAuth } from '../auth/auth.middleware';

export const locationRouter = Router();
locationRouter.use(requireAuth);
locationRouter.get('/nearby', nearby);

import { Router } from 'express';
import { estimate, route } from './trips.controller';

export const tripsRouter = Router();
tripsRouter.post('/route', route);
tripsRouter.post('/estimate', estimate);

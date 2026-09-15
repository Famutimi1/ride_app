import { Router } from 'express';
import { nearby } from './location.controller';

export const locationRouter = Router();
locationRouter.get('/nearby', nearby);

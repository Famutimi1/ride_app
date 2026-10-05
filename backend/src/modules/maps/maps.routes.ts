import { Router } from 'express';
import { autocomplete, details, reverse } from './maps.controller';
import { requireAuth } from '../auth/auth.middleware';

export const mapsRouter = Router();
mapsRouter.post('/places/autocomplete', requireAuth, autocomplete);
mapsRouter.post('/places/details', requireAuth, details);
mapsRouter.post('/geocode/reverse', requireAuth, reverse);

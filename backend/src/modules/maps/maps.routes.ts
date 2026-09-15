import { Router } from 'express';
import { autocomplete, details, reverse } from './maps.controller';

export const mapsRouter = Router();
mapsRouter.post('/places/autocomplete', autocomplete);
mapsRouter.post('/places/details', details);
mapsRouter.post('/geocode/reverse', reverse);

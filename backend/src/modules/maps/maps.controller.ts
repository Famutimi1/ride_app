import type { NextFunction, Request, Response } from 'express';
import { autocompletePlaces, getPlaceDetails, reverseGeocode } from './maps.service';

const coordinate = (value: unknown) => {
  const source = value as { latitude?: unknown; longitude?: unknown };
  const latitude = Number(source?.latitude);
  const longitude = Number(source?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : undefined;
};

export async function autocomplete(req: Request, res: Response, next: NextFunction) {
  try {
    const input = String(req.body.input ?? '').trim();
    if (input.length < 2) return void res.status(400).json({ error: 'Enter at least two characters' });
    res.json({ predictions: await autocompletePlaces(input, coordinate(req.body.location)) });
  } catch (error) { next(error); }
}

export async function details(req: Request, res: Response, next: NextFunction) {
  try {
    const placeId = String(req.body.placeId ?? '').trim();
    if (!placeId) return void res.status(400).json({ error: 'placeId is required' });
    res.json(await getPlaceDetails(placeId));
  } catch (error) { next(error); }
}

export async function reverse(req: Request, res: Response, next: NextFunction) {
  try {
    const location = coordinate(req.body);
    if (!location) return void res.status(400).json({ error: 'Valid latitude and longitude are required' });
    res.json({ location: await reverseGeocode(location) });
  } catch (error) { next(error); }
}

import type { NextFunction, Request, Response } from 'express';
import { findNearbyDrivers } from './location.service';

export async function nearby(req: Request, res: Response, next: NextFunction) {
  try {
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    const radiusKm = Math.min(Math.max(Number(req.query.radiusKm) || 5, 1), 25);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return void res.status(400).json({ error: 'Valid latitude and longitude are required' });
    }
    res.json({ drivers: await findNearbyDrivers(latitude, longitude, radiusKm) });
  } catch (error) { next(error); }
}

import type { NextFunction, Request, Response } from 'express';
import { getEstimate, getRoute, type Coordinate } from '../maps/maps.service';

function endpoints(body: unknown): { pickup: Coordinate; dropoff: Coordinate } | null {
  const value = body as { pickup?: Coordinate; dropoff?: Coordinate };
  const valid = (point?: Coordinate) => point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
  return valid(value.pickup) && valid(value.dropoff) ? { pickup: value.pickup!, dropoff: value.dropoff! } : null;
}

export async function route(req: Request, res: Response, next: NextFunction) {
  try {
    const points = endpoints(req.body);
    if (!points) return void res.status(400).json({ error: 'Valid pickup and dropoff are required' });
    res.json(await getRoute(points.pickup, points.dropoff));
  } catch (error) { next(error); }
}

export async function estimate(req: Request, res: Response, next: NextFunction) {
  try {
    const points = endpoints(req.body);
    if (!points) return void res.status(400).json({ error: 'Valid pickup and dropoff are required' });
    res.json(await getEstimate(points.pickup, points.dropoff));
  } catch (error) { next(error); }
}

import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../shared/errors';
import { getRoute, type Coordinate } from '../maps/maps.service';
import { enqueueDispatch, enqueueSearchExpiry, removeTripJobs } from './tripQueue';
import * as trips from './trips.service';

const run = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
  try { const result = await handler(req, res); if (!res.headersSent) res.json(result); } catch (error) { next(error); }
};
const tripId = (req: Request) => String(req.params.id);

function endpoints(body: unknown): { pickup: Coordinate; dropoff: Coordinate } | null {
  const value = body as { pickup?: Coordinate; dropoff?: Coordinate };
  const valid = (point?: Coordinate) => point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
  return valid(value.pickup) && valid(value.dropoff) ? { pickup: value.pickup!, dropoff: value.dropoff! } : null;
}

export const route = run(async (req) => { const points=endpoints(req.body);if(!points)throw new ApiError(400,'invalid_points');return getRoute(points.pickup,points.dropoff); });
export const estimate = run((req) => trips.estimateTrip(req.body));
export const create = run(async(req,res)=>{const result=await trips.createTrip(req.userId!,req.body,String(req.get('Idempotency-Key')??''));if(result.created){await Promise.all([enqueueDispatch(result.trip.id as string),enqueueSearchExpiry(result.trip.id as string)]);res.status(201);}return result;});
export const active = run((req) => trips.getActiveTrip(req.userId!, req.authUser!.active_role));
export const detail = run((req) => trips.getTripForParticipant(req.userId!, tripId(req)));
export const accept = run(async(req)=>{const id=tripId(req),value=await trips.acceptTrip(req.userId!,id);await removeTripJobs(id,req.userId!);return value;});
export const decline = run(async(req)=>{const id=tripId(req),value=await trips.declineTrip(req.userId!,id);await removeTripJobs(id,req.userId!);await enqueueDispatch(id);return value;});
export const arrived = run((req) => trips.markDriverArrived(req.userId!, tripId(req)));
export const start = run((req) => trips.startTrip(req.userId!, tripId(req)));
export const complete = run((req) => trips.completeTrip(req.userId!, tripId(req)));
export const cancel = run(async(req)=>{const id=tripId(req),value=await trips.cancelTrip(req.userId!,id,req.body.reason);await removeTripJobs(id);return value;});
export const rating = run((req) => trips.rateTrip(req.userId!, tripId(req), req.body.rating, req.body.comment));
export const history = run((req) => trips.tripHistory(req.userId!, req.authUser!.active_role, req.query.cursor, req.query.limit));

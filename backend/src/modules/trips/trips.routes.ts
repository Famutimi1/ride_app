import { Router, type NextFunction, type Request, type Response } from 'express';
import { env } from '../../config/env';
import { ensureRedis } from '../../shared/config/redis';
import { requireApprovedDriver, requireAuth } from '../auth/auth.middleware';
import * as controller from './trips.controller';

export const tripsRouter = Router();
tripsRouter.use(requireAuth);

function tripRateLimit(limit:number){return async(req:Request,res:Response,next:NextFunction)=>{try{const redis=await ensureRedis();const minute=Math.floor(Date.now()/60000),key=`rate:trip:${req.userId}:${req.path}:${minute}`,count=await redis.incr(key);if(count===1)await redis.expire(key,61);if(count>limit)return void res.status(429).json({error:'trip_rate_limit_exceeded'});next();}catch(error){next(error);}};}
function requireRiderMode(req:Request,res:Response,next:NextFunction){if(req.authUser?.active_role!=='rider')return void res.status(403).json({error:'switch_to_rider_mode'});next();}

tripsRouter.post('/route',tripRateLimit(env.TRIP_ESTIMATE_RATE_LIMIT_PER_MIN),controller.route);
tripsRouter.post('/estimate',requireRiderMode,tripRateLimit(env.TRIP_ESTIMATE_RATE_LIMIT_PER_MIN),controller.estimate);
tripsRouter.post('/',requireRiderMode,tripRateLimit(10),controller.create);
tripsRouter.get('/active',controller.active);
tripsRouter.get('/history',controller.history);
tripsRouter.get('/:id',controller.detail);
tripsRouter.post('/:id/cancel',controller.cancel);
tripsRouter.post('/:id/accept',requireApprovedDriver,controller.accept);
tripsRouter.post('/:id/decline',requireApprovedDriver,controller.decline);
tripsRouter.post('/:id/arrived',requireApprovedDriver,controller.arrived);
tripsRouter.post('/:id/start',requireApprovedDriver,controller.start);
tripsRouter.post('/:id/complete',requireApprovedDriver,controller.complete);
tripsRouter.post('/:id/rating',controller.rating);

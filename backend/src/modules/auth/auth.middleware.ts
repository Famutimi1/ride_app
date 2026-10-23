import type { NextFunction, Request, Response } from 'express';
import { db } from '../../shared/config/db';
import { verifyAccessToken } from './jwt.service';
import { ApiError } from '../../shared/errors';
import { authenticatedSessionUser } from './auth.service';
import {createHmac} from 'node:crypto';
import {ensureRedis} from '../../shared/config/redis';
import {env} from '../../config/env';

export async function limitPublicAuth(req:Request,res:Response,next:NextFunction) {
  const identity=createHmac('sha256',env.JWT_ACCESS_SECRET).update(req.ip??req.socket.remoteAddress??'unknown').digest('hex');
  try{
    const redis=await ensureRedis();
    const[count,ttl]=await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return {n,redis.call('TTL',KEYS[1])}",1,`auth:request-rate:${identity}`) as [number,number];
    if(count>env.AUTH_RATE_LIMIT_PER_MINUTE){const retryAfterSeconds=Math.max(1,ttl);res.set('Retry-After',String(retryAfterSeconds));return void res.status(429).json({error:'authentication_rate_limited',retryAfterSeconds});}
    next();
  }catch{next(new ApiError(503,'authentication_service_unavailable'));}
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return void res.status(401).json({ error: 'missing_token' });
  let payload: ReturnType<typeof verifyAccessToken>;
  try { payload = verifyAccessToken(header.slice(7)); }
  catch { return void res.status(401).json({ error: 'invalid_or_expired_token' }); }
  try {
    const user = await authenticatedSessionUser(payload);
    if (!user) return void res.status(401).json({ error: 'invalid_or_expired_token' });
    req.userId = user.id; req.authUser = user; req.sessionScope = payload.sessionScope; req.sessionId=payload.sessionId; next();
  } catch { next(new ApiError(503, 'authentication_service_unavailable')); }
}

export async function requireApprovedDriver(req: Request, res: Response, next: NextFunction) {
  const { rows } = await db.query('SELECT status FROM driver_profiles WHERE user_id=$1', [req.userId]);
  if (rows[0]?.status !== 'approved') {
    const tripId = typeof req.params.id === 'string' ? req.params.id : null;
    const active = tripId ? (await db.query(
      `SELECT 1 FROM trips WHERE id=$1 AND driver_id=$2 AND status IN ('driver_assigned','driver_arrived','in_progress','returning')`,
      [tripId, req.userId],
    )).rows[0] : null;
    if (!active) return void res.status(403).json({ error: 'driver_not_approved', driverStatus: rows[0]?.status ?? 'none' });
  }
  next();
}

export function requireStaffRole(...roles: Array<'admin' | 'super_admin'>) {
  return (req: Request, res: Response, next: NextFunction) => req.sessionScope === 'staff' && req.authUser && roles.includes(req.authUser.role as 'admin' | 'super_admin') ? next() : void res.status(403).json({ error: 'insufficient_permissions' });
}

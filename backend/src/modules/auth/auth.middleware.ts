import type { NextFunction, Request, Response } from 'express';
import { db } from '../../shared/config/db';
import { verifyAccessToken } from './jwt.service';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return void res.status(401).json({ error: 'missing_token' });
  try {
    const payload = verifyAccessToken(header.slice(7));
    const { rows } = await db.query('SELECT * FROM users WHERE id=$1 AND is_active=true', [payload.sub]);
    if (!rows[0]) return void res.status(401).json({ error: 'invalid_or_expired_token' });
    req.userId = rows[0].id; req.authUser = rows[0]; next();
  } catch { res.status(401).json({ error: 'invalid_or_expired_token' }); }
}

export async function requireApprovedDriver(req: Request, res: Response, next: NextFunction) {
  const { rows } = await db.query('SELECT status FROM driver_profiles WHERE user_id=$1', [req.userId]);
  if (rows[0]?.status !== 'approved') {
    const tripId = typeof req.params.id === 'string' ? req.params.id : null;
    const active = tripId ? (await db.query(
      `SELECT 1 FROM trips WHERE id=$1 AND driver_id=$2 AND status IN ('driver_assigned','driver_arrived','in_progress')`,
      [tripId, req.userId],
    )).rows[0] : null;
    if (!active) return void res.status(403).json({ error: 'driver_not_approved', driverStatus: rows[0]?.status ?? 'none' });
  }
  next();
}

export function requireStaffRole(...roles: Array<'admin' | 'super_admin'>) {
  return (req: Request, res: Response, next: NextFunction) => req.authUser && roles.includes(req.authUser.role as 'admin' | 'super_admin') ? next() : void res.status(403).json({ error: 'insufficient_permissions' });
}

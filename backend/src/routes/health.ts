import { Router, Request, Response } from 'express';
import { serverReady } from '../modules/auth/admin.service';

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
healthRouter.get('/live', (_req, res) => { res.set('Cache-Control', 'no-store').json({ status: 'alive' }); });
healthRouter.get('/ready', async (_req, res, next) => {
  try { const ready = await serverReady(); res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' }); }
  catch (error) { next(error); }
});

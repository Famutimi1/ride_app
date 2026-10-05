import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { healthRouter } from './routes/health';
import { mapsRouter } from './modules/maps/maps.routes';
import { tripsRouter } from './modules/trips/trips.routes';
import { locationRouter } from './modules/location/location.routes';
import { authRouter } from './modules/auth/auth.routes';
import { driverRouter } from './modules/driver/driver.routes';
import { ApiError } from './shared/errors';
import { walletRouter, paymentsRouter, payoutAccountsRouter, withdrawalsRouter, driverEarningsRouter } from './modules/payments/payments.routes';
import { receivePaystackWebhook } from './modules/payments/webhook.service';
import { paymentAdminRouter } from './modules/payments/admin.routes';

/**
 * Build and configure the Express application.
 * Kept separate from the server bootstrap so it can be imported in tests.
 */
export function createApp(): Express {
  const app = express();

  // Security & parsing middleware
  app.use(helmet());
  app.use(cors());
  app.post('/webhooks/paystack',express.raw({type:'application/json'}),(req,res,next)=>{void receivePaystackWebhook(req,res).catch(next);});
  app.use(express.json());
  app.use(morgan('dev'));

  // Routes
  app.get('/', (_req: Request, res: Response) => {
    res.json({ name: 'ride-app-backend', status: 'running' });
  });
  app.use('/api/health', healthRouter);
  app.use('/api', mapsRouter);
  app.use('/api/trips', tripsRouter);
  app.use('/api/location', locationRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/driver', driverRouter);
  app.use('/api/wallet',walletRouter);
  app.use('/api/payments',paymentsRouter);
  app.use('/api/payout-accounts',payoutAccountsRouter);
  app.use('/api/withdrawals',withdrawalsRouter);
  app.use('/api/driver/earnings',driverEarningsRouter);
  app.use('/api/admin/payments',paymentAdminRouter);

  app.use((error: Error, _req: Request, res: Response, _next: unknown) => {
    if (error instanceof ApiError) return void res.status(error.status).json({ error: error.code, ...error.details });
    console.error(error.message);
    res.status(error.name === 'TimeoutError' ? 504 : 500).json({ error: 'internal_server_error' });
  });

  // 404 fallback
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  return app;
}

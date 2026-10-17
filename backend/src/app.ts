import { careAdminRouter, careCustomerRouter } from './modules/care/care.routes';
import { locationAdminRouter } from './modules/location/admin.routes';
import { driverAdminRouter } from './modules/driver/admin.routes';
import { tripAdminRouter } from './modules/trips/admin.routes';
import { peopleAdminRouter } from './modules/auth/admin.routes';
import { financeDashboardRouter } from './modules/payments/dashboard.routes';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import {randomUUID} from 'node:crypto';
import {env} from './config/env';
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
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { receiveEmailWebhook } from './modules/notifications/emailWebhook';
import { emailAdminRouter } from './modules/notifications/email.routes';

/**
 * Build and configure the Express application.
 * Kept separate from the server bootstrap so it can be imported in tests.
 */
export function createApp(): Express {
  const app = express();
  if(env.TRUSTED_PROXY_CIDRS.length)app.set('trust proxy',env.TRUSTED_PROXY_CIDRS);
  app.use((_req,res,next)=>{res.set('X-Request-Id',randomUUID());next();});

  // Security & parsing middleware
  app.use(helmet());
  app.use(cors());
  app.post('/webhooks/resend',express.raw({type:'application/json',limit:'64kb'}),(req,res,next)=>{void receiveEmailWebhook(req,res).catch(next);});
  app.post('/webhooks/paystack',express.raw({type:'application/json'}),(req,res,next)=>{void receivePaystackWebhook(req,res).catch(next);});
  app.use(express.json({limit:'16kb'}));
  morgan.token('request-id',(_req,res)=>String(res.getHeader('X-Request-Id')??''));
  morgan.token('route',(req)=>{const value=req as Request;return typeof value.route?.path==='string'?`${value.baseUrl}${value.route.path}`:'unmatched';});
  app.use(morgan(env.NODE_ENV==='production'?':request-id :method :route :status :response-time ms':'dev'));

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
  app.use('/api/admin',careAdminRouter);
  app.use('/api/care',careCustomerRouter);
  app.use('/api/admin',tripAdminRouter);
  app.use('/api/admin',peopleAdminRouter);
  app.use('/api/admin',driverAdminRouter);
  app.use('/api/admin',locationAdminRouter);
  app.use('/api/admin',financeDashboardRouter);
  app.use('/api/notifications',notificationsRouter);
  app.use('/api/admin/emails',emailAdminRouter);

  app.use((error: Error, _req: Request, res: Response, _next: unknown) => {
    if (error instanceof ApiError) return void res.status(error.status).json({ error: error.code, ...error.details });
    const inputError=error as Error & {type?:string};
    if(inputError.type==='entity.too.large')return void res.status(413).json({error:'request_too_large'});
    if(inputError.type==='entity.parse.failed')return void res.status(400).json({error:'invalid_json'});
    console.error(error.message);
    res.status(error.name === 'TimeoutError' ? 504 : 500).json({ error: 'internal_server_error' });
  });

  // 404 fallback
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  return app;
}

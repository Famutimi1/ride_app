import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { healthRouter } from './routes/health';
import { mapsRouter } from './modules/maps/maps.routes';
import { tripsRouter } from './modules/trips/trips.routes';
import { locationRouter } from './modules/location/location.routes';

/**
 * Build and configure the Express application.
 * Kept separate from the server bootstrap so it can be imported in tests.
 */
export function createApp(): Express {
  const app = express();

  // Security & parsing middleware
  app.use(helmet());
  app.use(cors());
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

  app.use((error: Error, _req: Request, res: Response, _next: unknown) => {
    console.error(error.message);
    res.status(error.name === 'TimeoutError' ? 504 : 502).json({ error: error.message });
  });

  // 404 fallback
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  return app;
}

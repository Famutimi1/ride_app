import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { attachWebsocket } from './websocket';
import { registerTripSocketServer } from './modules/trips/tripSocket';
import { startTripWorkers } from './modules/trips/tripQueue';
import { startPaymentWorkers } from './modules/payments/paymentQueue';

const app = createApp();
const server = createServer(app);
const io = attachWebsocket(server);
registerTripSocketServer(io);
void startTripWorkers().catch((error) => console.error('[trips] workers failed to start', error));
void startPaymentWorkers().catch((error) => console.error('[payments] workers failed to start', error));
server.listen(env.PORT, () => {
  console.log(
    `🚗 Ride app backend running in ${env.NODE_ENV} mode on http://localhost:${env.PORT}`,
  );
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `❌ Port ${env.PORT} is already in use. Set a different PORT in backend/.env`,
    );
  } else {
    console.error('❌ Server error:', err);
  }
  process.exit(1);
});

import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { attachWebsocket } from './websocket';

const app = createApp();
const server = createServer(app);
attachWebsocket(server);
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

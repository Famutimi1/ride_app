import { createApp } from './app';
import { env } from './config/env';

const app = createApp();

const server = app.listen(env.PORT, () => {
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


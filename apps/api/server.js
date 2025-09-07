import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import 'dotenv/config';

import scansRouter, { setupWebSocket, shutdownScans } from './routes/scans.js';

if (!process.env.API_TOKEN) {
  console.error('API_TOKEN required');
  process.exit(1);
}

const app = express();
app.use(morgan(process.env.LOG_FORMAT || 'combined'));

const RETRY_AFTER_SECONDS = 60;
const rateLimitWindowMs = RETRY_AFTER_SECONDS * 1000;
app.use(
  rateLimit({
    windowMs: rateLimitWindowMs,
    max: 30,
    handler: (req, res) => {
      res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
      res.status(429).json({ error: 'too many requests' });
    },
  })
);
app.use(helmet());
app.use(compression());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'no token' });
  if (token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: 'invalid token' });
  }
  next();
});

app.use('/api/scans', scansRouter);

const port = process.env.PORT || 4000;
let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(port, () =>
    console.log('API on http://localhost:' + port)
  );

  setupWebSocket(server);

  const shutdown = async () => {
    await shutdownScans();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default app;
export { server };

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from project root (3 levels up from apps/api/src)
const envPath = resolve(__dirname, '..', '..', '..', '.env');
dotenvConfig({ path: envPath });

import express from 'express';
import cors from 'cors';
import { safeLog, getConfigOptional } from '@scaffold/shared';
import { ApiDatabase } from './db.js';
import { createChatRouter } from './routes/chat.js';
import { createRunsRouter } from './routes/runs.js';
import { authMiddleware, isAuthEnabled } from './middleware/auth.js';

const config = getConfigOptional();
const PORT = config.apiPort;

const app = express();
const db = new ApiDatabase();

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:4180'],
  credentials: true,
}));
app.use(express.json({ limit: '50mb' })); // Large limit for base64 images

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api', auth: isAuthEnabled() ? 'enabled' : 'disabled' });
});

// Apply auth middleware to protected routes
app.use(authMiddleware);

// Routes (protected by auth middleware when AUTH_ENABLED=true)
app.use('/api/chat', createChatRouter(db));
app.use('/api/runs', createRunsRouter(db));

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    safeLog('error', 'unhandled_error', {
      errorType: err.name,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
);

// Start server
app.listen(PORT, () => {
  safeLog('info', 'server_start', { model: 'api' });
  console.info(`API server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  safeLog('info', 'server_shutdown');
  db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  safeLog('info', 'server_shutdown');
  db.close();
  process.exit(0);
});
